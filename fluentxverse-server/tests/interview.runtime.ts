import Elysia from 'elysia';
import { cors } from '@elysiajs/cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { initRedis } from '../src/db/redis';
import { signAuthToken } from '../src/utils/jwt';
import { authMiddleware } from '../src/socket/middleware/auth.middleware';
import { interviewHandler } from '../src/socket/handlers/interview.handler';
import Interview from '../src/routes/interview.route';

if (process.env.INTERVIEW_TEST_URI !== 'bolt://127.0.0.1:17698') throw Error('Use the isolated interview graph on port 17698.');
if (process.env.DATABASE_URL !== 'postgresql://fixture:fixture@127.0.0.1:15498/unused') throw Error('Use isolated logging storage.');
process.env.TURN_PROVIDER = process.env.INTERVIEW_TEST_RELAY === 'true' ? 'cloudflare' : 'none';
process.env.JWT_SECRET = 'interview-fixture-secret-never-used-in-production';
process.env.SEAWEED_FILER_URL = 'http://127.0.0.1:18898';
await initDriver(process.env.INTERVIEW_TEST_URI, '', '', 1); await initRedis();
const session = getDriver().session();
if ((await session.run('MATCH (n) RETURN count(n) AS total')).records[0]!.get('total').toNumber() !== 0) throw Error('Interview fixture requires an empty graph.');
await session.run(`CREATE (:User {id:'interview-tutor',firstName:'Candidate',lastName:'Fixture'}),
  (:User {id:'other-tutor',firstName:'Other',lastName:'Fixture'}),
  (:Admin {id:'interview-admin',role:'admin',permissions:['operations'],username:'fixture'}),
  (:Admin {id:'support-admin',role:'admin',permissions:['support']}),
  (:InterviewSlot {id:'audit-fixture',tutorId:'interview-tutor',status:'booked',date:'2026-10-12',time:'3:00 PM'})`);
await session.close();
const files = new Map<string, { body: Uint8Array; type: string }>();
const storage = Bun.serve({ hostname: '127.0.0.1', port: 18898, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (request.method === 'PUT') { files.set(path, { body: new Uint8Array(await request.arrayBuffer()), type: request.headers.get('content-type')! }); return new Response('saved'); }
  const file = files.get(path);
  return file ? new Response(file.body, { headers: { 'Content-Type': file.type } }) : new Response('missing', { status: 404 });
} });
const tokens = {
  admin: await signAuthToken({ userId:'interview-admin', email:'admin@example.test', role:'admin' }),
  tutor: await signAuthToken({ userId:'interview-tutor', email:'candidate@example.test', role:'tutor' }),
  other: await signAuthToken({ userId:'other-tutor', email:'other@example.test', role:'tutor' }),
  support: await signAuthToken({ userId:'support-admin', email:'support@example.test', role:'admin' }),
};
const api = new Elysia().use(cors({ origin: true, credentials: true }))
  .get('/fixture/tokens', () => tokens)
  .get('/fixture/storage', () => ({ files: files.size, bytes: [...files.values()].reduce((sum, file) => sum + file.body.byteLength, 0) }))
  .get('/admin/me', () => ({ success:true,user:{userId:'interview-admin',email:'admin@example.test',username:'fixture',role:'admin'} }))
  .get('/admin/socket-token', () => ({ success:true,token:tokens.admin }))
  .get('/tutor/me', () => ({ success:true,user:{userId:'interview-tutor',email:'candidate@example.test',firstName:'Candidate',lastName:'Fixture',role:'tutor'} }))
  .get('/tutor/socket-token', () => ({ success:true,token:tokens.tutor }))
  .post('/tutor/refresh', () => ({ success:true }))
  .use(Interview).listen({ hostname:'127.0.0.1',port:18765,maxRequestBodySize:100*1024*1024 });
const http = createServer();
const io = new Server(http, { cors:{origin:true,credentials:true} });
io.use(authMiddleware);
io.on('connection', socket => interviewHandler(io as any, socket as any));
http.listen(18767,'127.0.0.1');
console.log('READY: isolated interview API 18765, signaling 18767, private storage 18898');
process.on('SIGINT', () => { api.stop(); storage.stop(); io.close(); void closeDriver().then(() => process.exit(0)); });
