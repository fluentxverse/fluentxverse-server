import { afterEach, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { createLessonPassRoutes } from '../src/routes/lessonPasses.route';
const savedEnv = { ...process.env };
afterEach(()=>{ for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
const app=new Elysia().use(createLessonPassRoutes()), id=`0x${'a'.repeat(64)}`;
const post=(path:string,data:unknown={},origin='https://student.fluentxverse.com')=>app.handle(new Request(`http://localhost/lesson-passes/${path}`,
  {method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)}));
test('explicit legacy mode, unconfigured private mode fails closed, authentication and finance origins',async()=>{
  process.env.LESSON_BOOKING_MODE='paid'; process.env.PRIVACY_INFRA_MODE='legacy_contracts';
  process.env.LESSON_PASSES_ENABLED='false';
  const legacy=await app.handle(new Request('http://localhost/lesson-passes/mode'));
  expect((await legacy.json() as any).data.mode).toBe('legacy_erc1155');
  expect(legacy.headers.get('cache-control')).toBe('no-store');
  process.env.LESSON_PASSES_ENABLED='true';
  expect((await app.handle(new Request('http://localhost/lesson-passes/mode'))).status).toBe(503);
  expect((await post('reservations',{id,passId:'test',refundCommitment:'123'})).status).toBe(401);
  expect((await post('reservations',{id,passId:'test',refundCommitment:'123'},'https://untrusted.test')).status).toBe(403);
  for(const action of ['submit','finalize','reconcile']) expect((await post(`admin/reservations/${id}/${action}`,{},'https://dashboard.fluentxverse.com')).status).toBe(401);
  expect((await post(`admin/orders/${id}/approve`,{paymentReference:'settled-payment',paidCents:600},'https://untrusted.test')).status).toBe(403);
});
test('trial launch is explicit, no-store and independent of private pass contract configuration', async()=>{
  process.env.LESSON_BOOKING_MODE='trial'; process.env.LESSON_PASSES_ENABLED='true';
  process.env.TRIAL_LESSON_LIMIT='1';
  const response=await app.handle(new Request('http://localhost/lesson-passes/mode'));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json() as any).data).toEqual({mode:'trial',trialLessonLimit:1});
  process.env.LESSON_BOOKING_MODE='typo';
  expect((await app.handle(new Request('http://localhost/lesson-passes/mode'))).status).toBe(503);
});
test('never accepts witness keys, strips no fields, bounds payloads without Content-Length',async()=>{
  const proof={merkleTreeDepth:8,merkleTreeRoot:'1',nullifier:'2',message:'3',scope:'4',points:Array(8).fill('0'),privateKey:'secret-test-key'};
  const extra=await post(`reservations/${id}/proof`,proof);
  expect(extra.status).toBe(400); expect(await extra.text()).not.toContain('secret-test-key');
  expect((await post('orders',{unexpected:'x'.repeat(310000)})).status).toBe(413);
});
