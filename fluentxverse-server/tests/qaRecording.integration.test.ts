import {expect,test} from 'bun:test';
import Elysia from 'elysia';
import {db} from '../src/db/postgres';
import {QaRecordingService,QA_NOTICE_VERSION} from '../src/services/qaRecording.service';
import {QaRecordingStorage} from '../src/services/qaRecordingStorage';
import {RealtimeKitClient,opaqueMediaId,type ProviderRecording} from '../src/services/realtimekit.client';
import {PostgresMediaRoomStore,type MediaRoom} from '../src/services/classroomMedia.service';
import {qaRecordingRoute} from '../src/routes/qaRecording.route';
import {signAuthToken} from '../src/utils/jwt';

const run=process.env.RUN_QA_RECORDING_DB_TEST==='1';
test.skipIf(!run)('durable recording consent, serialized start, cancellation stop, archive verification and retention',async()=>{
  const booking='qa-test-'+crypto.randomUUID(),meeting=crypto.randomUUID(),id=crypto.randomUUID();
  let records:ProviderRecording[]=[],starts=0,stops=0,deleted=0,cancelled=false,live=true;
  const client=new RealtimeKitClient(()=>({CLOUDFLARE_ACCOUNT_ID:'test',CLOUDFLARE_RTK_APP_ID:'test',CLOUDFLARE_RTK_API_TOKEN:'secret'}),async(url,init)=>{
    if(url.includes('/recordings?'))return Response.json({success:true,data:records});
    if(url.endsWith('/active-session'))return Response.json({success:true,data:{id:meeting,status:'LIVE'}});
    if(url.includes('/sessions/'))return Response.json({success:true,data:{participants:live?['student','tutor'].map(role=>({custom_participant_id:opaqueMediaId(`${meeting}:${role}:${role}`),joined_at:new Date().toISOString()})):[]}});
    if(url.endsWith('/recordings')&&init.method==='POST'){
      starts++;records=[{id,status:'INVOKED',invoked_time:new Date().toISOString(),meeting:{id:meeting}}];return Response.json({success:true,data:records[0]});
    }
    if(init.method==='PUT'){stops++;records[0]!.status='UPLOADING';return Response.json({success:true,data:{id}});}
    return Response.json({success:true,data:records[0]});
  });
  class Storage extends QaRecordingStorage{
    override async archive(){return {size:100,sha256:'verified'};}
    override async remove(){deleted++;}
  }
  const service=new QaRecordingService(client,new Storage(),async(_booking,user,role)=>cancelled||user!==role?null:{startsAt:Date.now()-60000,endsAt:Date.now()+600000});
  await service.ensureTable();
  const store=new PostgresMediaRoomStore();await store.pin(booking,'realtimekit',Date.now()+780000,'student','student');
  await db`UPDATE classroom_media_rooms SET meeting_id=${meeting} WHERE booking_id=${booking}`;
  const room=(await db`SELECT * FROM classroom_media_rooms WHERE booking_id=${booking}`)[0] as MediaRoom;
  try{
    await expect(service.acknowledge(booking,'outsider','student',true,true,QA_NOTICE_VERSION)).rejects.toThrow();
    await expect(service.acknowledge(booking,'student','student',true,false,QA_NOTICE_VERSION)).rejects.toThrow();
    await service.acknowledge(booking,'student','student',true,true,QA_NOTICE_VERSION);
    await service.controlRoom(room);expect(starts).toBe(0);
    await service.acknowledge(booking,'tutor','tutor',true,true,QA_NOTICE_VERSION);
    live=false;await service.controlRoom(room);expect(starts).toBe(0);
    live=true;await Promise.all([service.controlRoom(room),service.controlRoom(room)]);expect(starts).toBe(1);
    await service.controlRoom(room);expect(starts).toBe(1);
    cancelled=true;await service.controlRoom(room);expect(stops).toBe(1);
    records[0]!.status='UPLOADED';records[0]!.download_url='https://bucket.r2.cloudflarestorage.com/private';records[0]!.download_url_expiry=new Date(Date.now()+86400000).toISOString();
    await service.archiveRecord(id);
    expect((await db`SELECT local_status FROM qa_recordings WHERE id=${id}`)[0].local_status).toBe('stored');
    await db`UPDATE qa_recordings SET expires_at=NOW()-INTERVAL '1 second' WHERE id=${id}`;
    expect((await service.playback('admin',id,null)).status).toBe(404);
    await service.archiveRecord(id);expect(deleted).toBe(1);
    expect((await db`SELECT local_status FROM qa_recordings WHERE id=${id}`)[0].local_status).toBe('deleted');
    await service.archiveRecord(id);expect(deleted).toBe(1);
  }finally{
    await db`DELETE FROM qa_recording_access_log WHERE recording_id=${id}`;
    await db`DELETE FROM qa_recordings WHERE booking_id=${booking}`;
    await db`DELETE FROM qa_recording_consents WHERE booking_id=${booking}`;
    await db`DELETE FROM qa_recording_control WHERE booking_id=${booking}`;
    await db`DELETE FROM classroom_media_rooms WHERE booking_id=${booking}`;
  }
});
test('recording APIs reject anonymous, student, tutor and role-less tokens',async()=>{
  const app=new Elysia().use(qaRecordingRoute);
  for(const role of [null,'student','tutor','']){
    const token=role===null?null:await signAuthToken({userId:'qa-security-test',email:'test@example.com',...(role?{role}:{})},300);
    const response=await app.handle(new Request('http://localhost/admin/recordings/',{headers:token?{cookie:`adminAuth=${token}`}:{}}));
    expect(response.status).toBe(403);expect(await response.text()).not.toContain('download_url');
  }
});
