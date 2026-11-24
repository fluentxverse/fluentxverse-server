import {strict as assert} from 'node:assert';
import {initDriver,getDriver,closeDriver} from '../src/db/memgraph';
import {AttendanceRecoveryService} from '../src/services/schedule.services/attendanceRecovery.service';
import {ScheduleService} from '../src/services/schedule.services/schedule.service';
import {assertTrialAllowance} from '../src/services/schedule.services/trialPolicy';
import {CancellationRefundService} from '../src/services/ticket.services/cancellationRefund.service';

if(process.env.TEST_MEMGRAPH_URI!=='bolt://127.0.0.1:7721') throw Error('Use only disposable recovery DB on 7721');
await initDriver(process.env.TEST_MEMGRAPH_URI,'','',12,500);
const db=getDriver().session(), service=new AttendanceRecoveryService();
const start=Math.ceil((Date.now()+30*60000)/60000)*60000;
const pht=new Date(start+8*3600000).toISOString(),date=pht.slice(0,10),time=pht.slice(11,16);
const at=(minutes:number)=>new Date(start-minutes*60000);
async function seed(id:string,opt=true,attendance:string|null=null,version:number|null=1){
  await db.run(`CREATE(t:User {id:$tutor,tier:0,languages:['English']}), (student:Student {id:$id,autoReplaceTutor:$opt})
    CREATE(s:TimeSlot {slotId:$id,tutorId:$tutor,slotDate:$date,slotTime:$time,status:'booked',durationMinutes:25})
    CREATE(b:Booking {bookingId:$id,tutorId:$tutor,studentId:$id,slotId:$id,paymentMethod:'trial',
      status:'confirmed',slotDateTime:datetime($start),durationMinutes:25,attendanceRecoveryVersion:$version,attendanceTutor:$attendance})
    CREATE(b)-[:BOOKS]->(s) CREATE(b)-[:BOOKED_BY]->(student)`,
    {id,tutor:'old-'+id,opt,date,time,start:new Date(start).toISOString(),attendance,version});
}
async function replacement(id:string,status='open',attendance='present'){
  await db.run(`CREATE(t:User {id:$id,tier:0,languages:['English'],writtenExamPassed:true,speakingExamPassed:true,
    interviewPassed:true,profileStatus:'approved'})
    CREATE(s:TimeSlot {slotId:$id,tutorId:$id,slotDate:$date,slotTime:$time,status:$status,attendanceMarked:$attendance,durationMinutes:25})`,
    {id,date,time,status,attendance});
}
const booking=async(id:string)=>(await db.run('MATCH(b:Booking {bookingId:$id}) RETURN b',{id})).records[0]!.get('b').properties;
try{
  assert.equal(Number((await db.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n')),0);
  await seed('transfer');await replacement('replacement');await replacement('unconfirmed','open','');await replacement('pending','pending');
  assert.equal(await service.recover('transfer',at(10.01)),false);
  assert.equal(await service.recover('transfer',at(10)),true);
  const original=await booking('transfer');assert.equal(original.penaltyCode,'301');assert.equal(original.refundStatus,'transferred');
  const next=await booking(original.replacementBookingId);assert.equal(next.tutorId,'replacement');assert.equal(next.paymentMethod,'trial');
  assert.equal(next.attendanceTutor,'present');assert.equal(next.replacementFor,'transfer');assert.equal(next.refundApprovedBy,undefined);
  assert.equal(await service.recover('transfer',at(9)),false);
  await assert.rejects(()=>db.executeWrite(tx=>assertTrialAllowance(tx,'transfer',1)),/already been used/);
  await assert.rejects(()=>new CancellationRefundService().process('transfer'),/refund requires/);
  assert.equal(await new ScheduleService().getClassroomSchedule('transfer','old-transfer','tutor'),null);
  assert.equal(await new ScheduleService().markTutorRoomEntry('transfer','old-transfer',at(-1)),false);
  await seed('off',false);await service.recover('off',at(10));
  assert.equal((await booking('off')).refundApprovedBy,'system');assert.equal((await booking('off')).replacementBookingId,undefined);
  await seed('no-match');await service.recover('no-match',at(10));assert.equal((await booking('no-match')).refundStatus,'pending');
  await seed('present',true,'present');assert.equal(await service.recover('present',at(10)),false);
  await seed('legacy',true,null,null);assert.equal(await service.recover('legacy',at(10)),false);
  await replacement('late-replacement');await seed('too-late',true,'absent');await service.recover('too-late',at(4));
  assert.equal((await booking('too-late')).replacementBookingId,undefined);
  await seed('declared',true,'absent');await service.recover('declared',at(20));assert.equal((await booking('declared')).attendanceRecoveryOutcome,'transferred');
  await replacement('one-slot');await seed('race-a');await seed('race-b');
  await Promise.allSettled([service.recover('race-a',at(10)),service.recover('race-b',at(10))]);
  await service.recover('race-a',at(10));await service.recover('race-b',at(10));
  const racers=[await booking('race-a'),await booking('race-b')];
  assert.equal(racers.filter(b=>b.attendanceRecoveryOutcome==='transferred').length,1);
  assert.equal(racers.filter(b=>b.attendanceRecoveryOutcome==='refund_pending').length,1);
  const counts=await db.run(`MATCH(b:Booking {tutorId:'one-slot',status:'confirmed'}) RETURN count(b) AS n`);
  assert.equal(Number(counts.records[0]!.get('n')),1);
  await seed('paid');await replacement('paid-replacement');
  const wallet='0x'+'1'.repeat(40);
  await db.run(`MATCH(b:Booking {bookingId:'paid'}),(s:Student {id:'paid'})
    SET b.paymentMethod='erc1155',b.ticketTransferTxHash='mock-ticket-paid',s.externalWalletAddress=$wallet
    CREATE(:TicketTransaction {id:'paid-debit',bookingId:'paid',studentId:'paid',studentWallet:$wallet,
      transferTxId:'mock-ticket-paid',tokenId:'1',tier:'basic',quantity:1,type:'booking',status:'completed'})
    CREATE(:MockTicketTransfer {transactionHash:'mock-ticket-paid',bookingId:'paid',studentId:'paid',walletAddress:$wallet,
      status:'used',tier:'basic',quantity:1})
    CREATE(:MockTicketBalance {walletAddress:$wallet,basic:0,premium:0,trial:0})`,{wallet});
  await service.recover('paid',at(10));const paidNext=(await booking('paid')).replacementBookingId;
  assert(paidNext);
  process.env.ALLOW_MOCK_TICKET_PURCHASES='true';
  await assert.rejects(()=>new CancellationRefundService().process('paid'),/refund requires/);
  await db.run(`MATCH(b:Booking {bookingId:$id}) SET b.status='cancelled',b.cancelledAt=datetime(),
    b.cancelledBy='system',b.refundApprovedBy='system',b.cancellationRefundVersion=1`,{id:paidNext});
  await new CancellationRefundService().process(paidNext);await new CancellationRefundService().process(paidNext);
  assert.equal((await booking(paidNext)).refunded,true);
  assert.equal(Number((await db.run('MATCH(b:MockTicketBalance {walletAddress:$wallet}) RETURN b.basic AS n',{wallet})).records[0]!.get('n')),1);
  const {default:Elysia}=await import('elysia');
  const {default:Student}=await import('../src/routes/student.route');
  const {signAuthToken}=await import('../src/utils/jwt');
  const app=new Elysia().use(Student);
  const studentToken=await signAuthToken({userId:'off',role:'student',email:'test@example.invalid'});
  const tutorToken=await signAuthToken({userId:'off',role:'tutor',email:'test@example.invalid'});
  const request=(method:string,token?:string,body?:unknown)=>app.handle(new Request('http://localhost/student/replacement-preference',{
    method,headers:{...(token?{cookie:`studentAuth=${token}`} : {}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
  assert.equal((await request('GET')).status,401);
  assert.equal((await request('PUT',tutorToken,{enabled:true})).status,401);
  assert.equal((await request('PUT',studentToken,{enabled:'true'})).status,422);
  assert.equal((await request('PUT',studentToken,{enabled:true})).status,200);
  assert.equal((await (await request('GET',studentToken)).json() as any).data.enabled,true);
  assert.equal((await booking('off')).studentId,'off');
  await new CancellationRefundService().process('off');await new CancellationRefundService().process('off');
  assert.equal((await booking('off')).trialRefunded,true);
  await db.executeWrite(tx=>assertTrialAllowance(tx,'off',1));
  console.log('PASS deadline boundary, Present-only replacement, retry, no-match, opt-out, late cutoff, declared absence, legacy exclusion, classroom denial');
}finally{await db.close();await closeDriver();}
process.exit(0);
