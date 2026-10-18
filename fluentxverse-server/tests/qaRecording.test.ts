import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { bothRecordingConsents, QA_NOTICE_VERSION } from '../src/services/qaRecording.service';
import { encryptRecordingChunk, decryptRecordingChunk, recordingKey, recordingRange, recordingDownloadUrl, QaRecordingStorage, QA_CHUNK_BYTES } from '../src/services/qaRecordingStorage';
import { RealtimeKitClient } from '../src/services/realtimekit.client';

const id='a5fda17a-7206-489e-8207-f7499bc3ed23';
test('recordings need both current acknowledgements and guardian/self authority',()=>{
  const accepted={userId:'student',accepted:true,authority:true,version:QA_NOTICE_VERSION};
  expect(bothRecordingConsents([accepted])).toBe(false);
  expect(bothRecordingConsents([accepted,{...accepted,userId:'tutor'}])).toBe(true);
  for(const changed of [{accepted:false},{authority:false},{version:'old'}])expect(bothRecordingConsents([accepted,{...accepted,...changed}])).toBe(false);
});
test('AES-GCM chunks authenticate their content, recording identity, position and key',()=>{
  const root=randomBytes(32),key=recordingKey(id,root),plain=Buffer.from('confidential lesson media');
  const cipher=encryptRecordingChunk(plain,id,0,key);
  expect(cipher.includes(plain)).toBe(false);
  expect(decryptRecordingChunk(cipher,id,0,key)).toEqual(plain);
  expect(()=>decryptRecordingChunk(cipher,id,1,key)).toThrow();
  expect(()=>decryptRecordingChunk(cipher,'another',0,key)).toThrow();
  expect(()=>decryptRecordingChunk(cipher,id,0,randomBytes(32))).toThrow();
  cipher[cipher.length-1]=cipher[cipher.length-1]!^1;expect(()=>decryptRecordingChunk(cipher,id,0,key)).toThrow();
});
test('playback ranges support seeking and fail closed on invalid/multiple ranges',()=>{
  expect(recordingRange(null,100)).toEqual({start:0,end:99,partial:false});
  expect(recordingRange('bytes=10-19',100)).toEqual({start:10,end:19,partial:true});
  expect(recordingRange('bytes=-10',100)).toEqual({start:90,end:99,partial:true});
  expect(recordingRange('bytes=90-',100)).toEqual({start:90,end:99,partial:true});
  for(const range of ['bytes=100-','bytes=9-1','bytes=0-1,3-4','bytes=-0','garbage'])expect(()=>recordingRange(range,100)).toThrow();
});
test('downloads cannot target localhost, arbitrary sites, redirects or non-HTTPS endpoints',()=>{
  expect(recordingDownloadUrl('https://recordings.bucket.r2.cloudflarestorage.com/file?signature=private')).toContain('https://');
  for(const url of ['http://localhost:8888','https://127.0.0.1','https://evil.com','https://r2.cloudflarestorage.com.evil.com','https://user:password@bucket.r2.cloudflarestorage.com'])expect(()=>recordingDownloadUrl(url)).toThrow();
});
test('archive streams encrypted bytes, verifies stored content and permits cross-chunk seeks',async()=>{
  const previous=process.env.QA_RECORDING_ENCRYPTION_KEY;
  process.env.QA_RECORDING_ENCRYPTION_KEY=randomBytes(32).toString('hex');
  const plain=randomBytes(QA_CHUNK_BYTES+200);let stored:Uint8Array|null=null;
  const storage=new QaRecordingStorage(()=> 'http://test-filer',async(input,init)=>{
    if(String(input).startsWith('https:'))return new Response(plain);
    if(init?.method==='POST'){const file=(init.body as FormData).get('file') as Blob;stored=new Uint8Array(await file.arrayBuffer());return new Response('{}');}
    if(init?.method==='HEAD')return new Response(null,{headers:{'content-length':String(stored!.length)}});
    if(init?.method==='DELETE'){stored=null;return new Response('{}');}
    const range=recordingRange(new Headers(init?.headers).get('range'),stored!.length);
    return new Response(stored!.slice(range.start,range.end+1),{status:206});
  });
  try{
    const result=await storage.archive(id,'https://bucket.r2.cloudflarestorage.com/test',plain.length);
    expect(result.size).toBe(plain.length);expect(result.sha256).toHaveLength(64);
    expect(stored!.length).toBe(plain.length+56);
    const partial=await new Response(storage.playback(id,plain.length,QA_CHUNK_BYTES-10,QA_CHUNK_BYTES+10)).arrayBuffer();
    expect(Buffer.from(partial)).toEqual(plain.subarray(QA_CHUNK_BYTES-10,QA_CHUNK_BYTES+11));
    await expect(storage.archive(id,'https://bucket.r2.cloudflarestorage.com/test',plain.length+1)).rejects.toThrow();
    expect(stored).toBeNull();
  }finally{if(previous===undefined)delete process.env.QA_RECORDING_ENCRYPTION_KEY;else process.env.QA_RECORDING_ENCRYPTION_KEY=previous;}
});
test('server recording APIs use default provider storage, bounded duration and no client record privileges',async()=>{
  const calls:Array<{url:string;init:RequestInit}>=[];
  const client=new RealtimeKitClient(()=>({CLOUDFLARE_ACCOUNT_ID:'a',CLOUDFLARE_RTK_APP_ID:'b',CLOUDFLARE_RTK_API_TOKEN:'secret'}),async(url,init)=>{
    calls.push({url,init});return Response.json({success:true,data:{id,status:'INVOKED',invoked_time:new Date().toISOString()}});
  });
  await client.startRecording('meeting',7200);await client.stopRecording(id);
  const body=JSON.parse(String(calls[0]!.init.body));expect(body.max_seconds).toBe(3600);expect(body.realtimekit_bucket_config.enabled).toBe(true);expect(body.allow_multiple_recordings).toBe(false);
  expect(calls[1]!.init.method).toBe('PUT');expect(JSON.parse(String(calls[1]!.init.body))).toEqual({action:'stop'});
});
