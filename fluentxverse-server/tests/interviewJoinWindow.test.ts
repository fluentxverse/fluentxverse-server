import { test, expect, spyOn } from 'bun:test';
import * as graph from '../src/db/memgraph';
import { interviewJoinDenial, canJoinInterview } from '../src/socket/handlers/interview.handler';
test('interview join explains time boundaries without bypassing ownership, permissions or closure', async () => {
  const old = process.env.TUTOR_IDENTITY_ENABLED; process.env.TUTOR_IDENTITY_ENABLED='true';
  let status='booked',closed:string|null=null,banned=false,admin=true,owner=true;
  const start=Date.parse('2026-11-02T23:30:00+08:00');
  const clock=spyOn(Date,'now').mockReturnValue(start-16*60000);
  const record=(value:Record<string,unknown>)=>({get:(key:string)=>value[key]});
  const driver=spyOn(graph,'getDriver').mockReturnValue({session:()=>({close:async()=>{},run:async(q:string)=>({records:q.includes('a:Admin')?(admin?[record({a:{properties:{role:'superadmin'}}})]:[]):q.includes('identityBanned')?[record({banned})]:owner?[record({id:'slot',date:'2026-11-02',time:'11:30 PM',status,closed})]:[]})})} as any);
  try {
    expect(await interviewJoinDenial('interview-slot','admin','admin')).toContain('11:15 PM');
    expect(await canJoinInterview('interview-slot','tutor','tutor')).toBe(false);
    clock.mockReturnValue(start-15*60000);expect(await canJoinInterview('interview-slot','tutor','tutor')).toBe(true);
    clock.mockReturnValue(start+30*60000-1);expect(await canJoinInterview('interview-slot','admin','admin')).toBe(true);
    clock.mockReturnValue(start+30*60000);expect(await interviewJoinDenial('interview-slot','tutor','tutor')).toContain('has ended');
    clock.mockReturnValue(start);closed='closed';expect(await interviewJoinDenial('interview-slot','admin','admin')).toContain('closed or cancelled');
    closed=null;status='cancelled';expect(await canJoinInterview('interview-slot','admin','admin')).toBe(false);
    status='booked';banned=true;expect(await canJoinInterview('interview-slot','tutor','tutor')).toBe(false);
    banned=false;owner=false;expect(await interviewJoinDenial('interview-slot','tutor','other')).toBe('You do not have access to this interview.');
    owner=true;admin=false;expect(await canJoinInterview('interview-slot','admin','other')).toBe(false);
    expect(await canJoinInterview('interview-default','admin','admin')).toBe(false);
  } finally {clock.mockRestore();driver.mockRestore();if(old===undefined)delete process.env.TUTOR_IDENTITY_ENABLED;else process.env.TUTOR_IDENTITY_ENABLED=old;}
});
