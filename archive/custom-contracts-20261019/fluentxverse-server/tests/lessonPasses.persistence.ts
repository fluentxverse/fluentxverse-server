import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Identity } from '@semaphore-protocol/identity';
import { initDriver, closeDriver, getDriver } from '../src/db/memgraph';
import { LessonPassRepository } from '../src/services/lessonPasses/repository';
import { LessonPassChain } from '../src/services/lessonPasses/chain';
import { LessonPassService, lessonPassService } from '../src/services/lessonPasses/service';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import { ticketService } from '../src/services/ticket.services/ticket.service';
import { encryptPassVault, emptyPassVault } from '../../fluentxverse-student-solid-prototype/student/utils/lessonPassVault';
import Elysia from 'elysia';
import { createLessonPassRoutes } from '../src/routes/lessonPasses.route';
import { signAuthToken } from '../src/utils/jwt';
import { cancellationRefundService } from '../src/services/ticket.services/cancellationRefund.service';
import { AdminOperationsService } from '../src/services/admin.services/operations.service';

// Dedicated, disposable database only. No live API, Engine, RPC or funds involved.
await initDriver('bolt://127.0.0.1:7710', '', '', 5, 1000);
Object.assign(process.env, { LESSON_BOOKING_MODE: 'paid', PRIVACY_INFRA_MODE: 'legacy_contracts', LESSON_PASSES_ENABLED: 'true', LESSON_PASSES_CONTRACT: `0x${'1'.repeat(40)}`, LESSON_PASSES_ISSUER: `0x${'2'.repeat(40)}`,
  LESSON_PASSES_DOMAIN_ID: '175', LESSON_PASSES_RPC_URL: 'http://127.0.0.1:1', LESSON_PASSES_BRIDGE: '0x3098A6974649478f0133046e44105AA84e868C21',
  LESSON_PASSES_VK_HASH: '0x6cdfb2dc51747e922a72bad7aa81b21b67cb053774ee0ee6cbc4b173dddabb76',
  LESSON_PASSES_VK_SHA256: 'c41e4922816f0d12ece1cfe25e2d159fc1b515f3fbea0acae97a24eecc7b41dd',
  LESSON_PASSES_WASM_SHA256: '4edc07444a1d48d09014c963e315d3351b6e12838d83fcb1962071614b1c94b9',
  LESSON_PASSES_ZKEY_SHA256: 'd02521afe7133a97421244374d4bc005c1ebd7d7cf7c51e88b7e99fdaf183146' });
const repo = new LessonPassRepository(), chain = new LessonPassChain(), service = new LessonPassService(repo, chain);
chain.check = async () => ({} as any);
let active = false, ledgerState = 0, receiptFinal = false, recoveryAllowed = false;
chain.activeBatch = async () => active; chain.state = async () => ledgerState;
chain.verifiedReceipt = async () => receiptFinal; chain.expiredUnspent = async () => recoveryAllowed;
chain.write = async () => ({ id: 'isolated-engine-operation', status: 'queued' });
chain.reserve = async () => ({ id: 'isolated-reserve-operation', status: 'queued' });
chain.submit = async () => ({ txHash: `0x${'d'.repeat(64)}`, submissionId: 'isolated-proof-operation' });
const id = (n: number) => `0x${n.toString(16).padStart(64,'0')}`;
try {
  assert.equal(Number((await repo.read('MATCH (n) RETURN count(n) AS count')).records[0]!.get('count')), 0, 'Requires empty disposable database');
  await repo.read("CREATE (:Student {id:'pass-student'}) CREATE (:Student {id:'other-student'}) CREATE (:User {id:'pass-tutor',writtenExamPassed:true,speakingExamPassed:true,profileStatus:'approved'})");
  await repo.read("CREATE (:Admin {id:'pass-finance',role:'admin',permissions:['finance']}) CREATE (:Admin {id:'pass-support',role:'admin',permissions:['support']})");
  const app = new Elysia().use(createLessonPassRoutes(service));
  const adminCall = async (actor: string, origin='https://dashboard.fluentxverse.com') => app.handle(new Request('http://localhost/lesson-passes/admin/queue',{
    headers:{origin,cookie:`adminAuth=${await signAuthToken({userId:actor,email:'test@example.test',role:'admin'})}`}}));
  assert.equal((await adminCall('pass-support')).status,403);
  assert.equal((await adminCall('pass-finance','https://student.fluentxverse.com')).status,403);
  assert.equal((await adminCall('pass-finance')).status,200);
  const envelope = await encryptPassVault(emptyPassVault(), 'synthetic-test-passphrase', 'pass-student');
  await service.saveVault('pass-student', 0, envelope); await service.saveVault('pass-student', 0, envelope);
  await assert.rejects(service.saveVault('pass-student', 0, await encryptPassVault(emptyPassVault(),'synthetic-test-passphrase','pass-student')), /changed on another device/);
  const identities = Array.from({ length:8 }, (_,i) => new Identity(`lesson-pass-test-only-${i}`));
  for (let i=0;i<8;i++) {
    const order = id(i+1), commitment = identities[i]!.commitment.toString();
    await service.order('pass-student',order,'basic-1',[commitment]);
    await service.order('pass-student',order,'basic-1',[commitment]);
    await assert.rejects(service.order('other-student',order,'basic-1',[commitment]),/reference already used/);
    await assert.rejects(service.approve(order,`settled-payment-${i}`,599,'finance'),/amount/);
    await service.approve(order,`settled-payment-${i}`,600,'finance'); await service.approve(order,`settled-payment-${i}`,600,'finance');
    if (i) await assert.rejects(service.approve(order,'settled-payment-0',600,'finance'),/already credited/);
  }
  assert.equal((await service.mine('pass-student')).passes.length,8); assert.equal((await service.mine('other-student')).passes.length,0);
  const batchId = id(100), passIds = (await repo.account('pass-student')).passes.map(p => p.id);
  await service.seal(batchId,passIds); await service.seal(batchId,passIds);
  await assert.rejects(service.seal(batchId,passIds.slice(1)),/immutable/);
  await service.register(batchId); await assert.rejects(service.register(batchId),/reconciliation/);
  active = true; await service.register(batchId);
  const passId = `${id(1)}:${identities[0]!.commitment}`;
  const reservationId = `0x${'a'.repeat(64)}`, refundCommitment = new Identity('lesson-pass-test-refund').commitment.toString();
  await assert.rejects(service.prepare('other-student',passId,reservationId,refundCommitment),/not found/);
  const authorization = await service.prepare('pass-student',passId,reservationId,refundCommitment);
  assert.deepEqual(await service.prepare('pass-student',passId,reservationId,refundCommitment),authorization);
  const fixture = JSON.parse(execFileSync('node',[new URL('../../contracts/lesson-passes/fixture.mjs',import.meta.url).pathname,process.env.LESSON_PASSES_CONTRACT!,String(authorization.deadline)],{encoding:'utf8',timeout:180000}));
  assert.equal(authorization.root,fixture.proof.merkleTreeRoot);
  await assert.rejects(service.proof('pass-student',reservationId,fixture.secondProof),/does not match/);
  for (const changed of [{...fixture.proof,scope:'123'}, {...fixture.proof,merkleTreeRoot:'123'}, {...fixture.proof,points:Array(8).fill('0')}])
    await assert.rejects(service.proof('pass-student',reservationId,changed),/does not match/);
  await assert.rejects(service.proof('other-student',reservationId,fixture.proof),/not found/);
  await service.proof('pass-student',reservationId,fixture.proof); await service.proof('pass-student',reservationId,fixture.proof);
  assert.equal((await repo.reservation(reservationId))!.status,'proof_ready');
  await service.submit(reservationId); await service.submit(reservationId);
  const receipt = { aggregationId:'7',merklePath:[],leafCount:'1',index:'0' };
  await assert.rejects(service.certify(reservationId,receipt),/not finalized/);
  await assert.rejects(service.readyForBooking('pass-student',reservationId),/finalized/);
  receiptFinal = true; await service.certify(reservationId,receipt);
  await assert.rejects(service.certify(reservationId,receipt),/reconciliation/);
  ledgerState=1; await service.reconcile(reservationId); assert.equal((await repo.reservation(reservationId))!.status,'ready');
  await assert.rejects(repo.saveReceipt(reservationId,JSON.stringify({...receipt,aggregationId:'8'})),/immutable/);

  // Joint booking transaction: no ERC-1155 calls, even without a student wallet.
  lessonPassService.chain.state = async () => 1;
  ticketService.verifyTicketTransfer = async () => { throw new Error('Private booking must not verify legacy tokens'); };
  ticketService.recordTicketDeduction = async () => { throw new Error('Private booking must not debit legacy tokens'); };
  ticketService.getBookingTransaction = async () => { throw new Error('Private cancellation must not look up legacy tokens'); };
  const schedule = new ScheduleService();
  for (let i=0;i<2;i++) {
    const date = new Date(Date.now()+(180+i*60)*60000+8*3600000).toISOString();
    await repo.read(`MATCH (t:User {id:'pass-tutor'}) CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId:$id,tutorId:'pass-tutor',slotDate:$date,slotTime:$time,status:'open',durationMinutes:25,attendanceMarked:'present'})`,
      {id:`pass-slot-${i}`,date:date.slice(0,10),time:date.slice(11,16)});
  }
  const holds = [];
  for(let i=0;i<2;i++) holds.push(await schedule.reserveSlotForCheckout('pass-student',`pass-slot-${i}`));
  // A failed slot update must roll back the pass claim.
  await repo.read("MATCH (s:TimeSlot {slotId:'pass-slot-0'}) SET s.pendingUntil=datetime($expired)",{expired:new Date(Date.now()-1000).toISOString()});
  await assert.rejects(schedule.bookSlot({studentId:'pass-student',slotId:'pass-slot-0',reservationId:holds[0]!.reservationId,privatePassReservationId:reservationId}),/expired/);
  assert.equal((await repo.reservation(reservationId))!.status,'ready');
  holds[0]=await schedule.reserveSlotForCheckout('pass-student','pass-slot-0');
  const outcomes = await Promise.allSettled(holds.map((hold,i)=>schedule.bookSlot({studentId:'pass-student',slotId:`pass-slot-${i}`,reservationId:hold.reservationId,privatePassReservationId:reservationId})));
  assert.equal(outcomes.filter(n=>n.status==='fulfilled').length,1,JSON.stringify(outcomes));
  assert.equal(outcomes.filter(n=>n.status==='rejected').length,1);
  const booking = (outcomes.find(n=>n.status==='fulfilled') as PromiseFulfilledResult<any>).value;
  const usedSlot = Number(booking.slotId.slice(-1));
  assert.equal((await schedule.bookSlot({studentId:'pass-student',slotId:booking.slotId,reservationId:holds[usedSlot]!.reservationId,privatePassReservationId:reservationId})).bookingId,booking.bookingId);
  await assert.rejects(service.returnUnused('pass-student',reservationId),/Only an unused/);
  await assert.rejects(service.finalize(reservationId),/Only finalized payable/);
  assert.equal((await repo.reservation(reservationId))!.status,'booked','Failed eligibility check leaves state unchanged');
  const cancelled = await schedule.cancelBooking({bookingId:booking.bookingId,cancelledBy:'pass-student'});
  assert(!cancelled.refunded); assert.match(cancelled.message,/pending finalization/);
  await service.finalize(reservationId); assert.equal((await repo.reservation(reservationId))!.finalAction,'return');
  await assert.rejects(new AdminOperationsService().refund(booking.bookingId,'pass-finance','Synthetic support refund'),/already finalizing/);
  await assert.rejects(service.finalize(reservationId),/pending/);
  ledgerState=3; await service.reconcile(reservationId); await service.reconcile(reservationId);
  const refunds = (await repo.account('pass-student')).passes.filter(p=>p.origin==='refund');
  assert.equal(refunds.length,1); assert.equal(refunds[0]!.commitment,refundCommitment);
  assert.equal((await repo.pass(passId))!.status,'spent');
  assert.equal((await repo.booking(booking.bookingId)).refundStatus,'pass_issued');
  await cancellationRefundService.process(booking.bookingId);
  assert.equal((await repo.booking(booking.bookingId)).refundStatus,'pass_issued','Legacy refund processing cannot overwrite a private pass return');

  const secondPass = `${id(2)}:${identities[1]!.commitment}`, expiredId=id(900);
  await service.prepare('pass-student',secondPass,expiredId,new Identity('recovery-refund-only').commitment.toString());
  await repo.saveProof(expiredId,JSON.stringify(fixture.otherProof),fixture.otherProof.nullifier);
  await assert.rejects(service.recoverUnused('pass-student',expiredId),/finalized authorization expiry/);
  recoveryAllowed=true; await service.recoverUnused('pass-student',expiredId);
  assert.equal((await repo.pass(secondPass))!.status,'available');
  const nextId=id(901);
  await service.prepare('pass-student',secondPass,nextId,new Identity('recovery-next-refund-only').commitment.toString());
  await repo.saveProof(nextId,JSON.stringify({...fixture.otherProof,message:'123'}),fixture.otherProof.nullifier);
  const rebound=(await repo.read('MATCH (n:LessonPassNullifier {id:$id}) RETURN n.reservationId AS reservation',{id:fixture.otherProof.nullifier})).records[0]!.get('reservation');
  assert.equal(rebound,nextId,'Only a finalized-unused expiry allows rebinding the same pass nullifier');
  await repo.read("MATCH (a:Admin {id:'pass-finance'}) SET a.permissions=['support']");
  assert.equal((await adminCall('pass-finance')).status,403,'Permission revocation is enforced on every request');
  const restarted = new LessonPassRepository(); assert.equal((await restarted.reservation(reservationId))!.status,'returned');
  assert.equal((await restarted.account('pass-student')).vault!.envelope,envelope);
  console.log('PASS: disposable Memgraph issuance, payment replay protection, vault CAS, real proof intake, finality gate, booking race/idempotency, cancellation replacement once, recovery and restart persistence. Chain actions mocked.');
} finally { await closeDriver(); }
