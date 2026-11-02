import { expect, test } from 'bun:test';
import Elysia from 'elysia';
import { createBookingSettingsRoutes } from '../src/routes/bookingSettings.route';
import { BookingSettingsError, validateBookingPolicy } from '../src/services/bookingSettings.policy';
import { publicPassMode } from '../src/services/lessonPasses/policy';

test('booking settings validate modes and bounded integer allowances', () => {
  for (const n of [0,-1,1.2,1000,NaN]) expect(() => validateBookingPolicy({ mode:'trial',trialLessonLimit:n })).toThrow();
  expect(() => validateBookingPolicy({mode:'unknown' as any,trialLessonLimit:1})).toThrow();
  expect(validateBookingPolicy({mode:'trial',trialLessonLimit:1})).toEqual({mode:'trial',trialLessonLimit:1});
});
test('settings endpoints require superadmin, trusted mutation origin, valid payload and current revision', async () => {
  let settings={mode:'paid' as 'trial'|'paid',trialLessonLimit:1,revision:0,updatedAt:null as string|null};
  const calls:any[]=[];
  const service={get:async()=>settings,update:async(value:any,revision:number,actor:string)=>{
    if(revision!==settings.revision)throw new BookingSettingsError('Reload before saving.',409);
    calls.push({value,actor});return settings={...value,revision:revision+1,updatedAt:new Date().toISOString()};
  }};
  const app=new Elysia({prefix:'/admin'}).use(createBookingSettingsRoutes(service,async(cookie,set)=>{
    const role=cookie.testRole?.value;if(!role){set.status=401;return null;}return {userId:'admin-fixture',role};
  }));
  const request=(method='GET',role='',origin='https://dashboard.fluentxverse.com',data:any={mode:'trial',trialLessonLimit:1,revision:0})=>app.handle(new Request('http://localhost/admin/booking-settings',{
    method,headers:{cookie:role?`testRole=${role}`:'',origin,'content-type':'application/json'},...(method==='PUT'?{body:JSON.stringify(data)}:{})
  }));
  expect((await request()).status).toBe(401);
  expect((await request('GET','admin')).status).toBe(403);
  expect((await request('PUT','superadmin','https://evil.invalid')).status).toBe(403);
  expect((await request('PUT','admin')).status).toBe(403);expect(calls).toHaveLength(0);
  const initial=await request('GET','superadmin');expect(initial.headers.get('cache-control')).toBe('no-store');
  expect((await initial.json() as any).data.mode).toBe('paid');
  for(const value of [0,1000,1.5])expect((await request('PUT','superadmin',undefined,{mode:'trial',trialLessonLimit:value,revision:0})).status).toBe(422);
  const saved=await request('PUT','superadmin');expect(saved.status).toBe(200);expect(calls[0].actor).toBe('admin-fixture');
  expect((await request('PUT','superadmin')).status).toBe(409);
  expect(await publicPassMode(await service.get())).toEqual({mode:'trial',trialLessonLimit:1});
  expect((await request('PUT','superadmin',undefined,{mode:'paid',trialLessonLimit:2,revision:1})).status).toBe(200);
  expect(await publicPassMode(await service.get())).toEqual({mode:'legacy_erc1155'});
});
