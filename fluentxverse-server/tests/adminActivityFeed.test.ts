import {test,expect} from 'bun:test';
import {activityLimit,additionalActivities,mergeActivities} from '../src/services/admin.services/activityFeed';
test('bounds activity reads and merges stable event IDs across sources',()=>{
 for(const value of [NaN,Infinity,-1,0,1.5])expect(activityLimit(value)).toBe(25);
 expect(activityLimit(100000)).toBe(250);
 const event={id:'report:1',type:'lesson_report',message:'Report submitted',timestamp:'2026-11-03T01:00:00.000Z'};
 expect(mergeActivities([event,{...event},{...event,id:'review:1',timestamp:'2026-11-03T02:00:00.000Z'}],25).map(r=>r.id)).toEqual(['review:1','report:1']);
});
test('activity sources include identity, interviews, lessons, finance, materials and support without private payloads',async()=>{
 const queries:string[]=[];
 const session={run:async(text:string)=>{
  queries.push(text);
  const values:any={id:'fixture',subject:'tutor-1',timestamp:'2026-11-03T00:00:00Z',title:'Activity',firstName:'Test',lastName:'Tutor',tutorId:'tutor-1',secret:'PRIVATE-WITNESS',description:'PRIVATE-ISSUE'};
  return {records:[{get:(key:string)=>values[key]}]};
 }};
 const read:any=async(text:string)=>({rows:text.includes('lesson_trouble_reports')?[{id:'report',booking_id:'lesson',source:'student',created_at:new Date('2026-11-03T01:00:00Z'),reviewed_at:new Date('2026-11-03T02:00:00Z'),review_status:'resolved',details:'PRIVATE-ISSUE'}]:[]});
 const rows=await additionalActivities(session,25,read);
 for(const type of ['identity_submitted','identity_reviewed','identity_nft','interview_booked','interview_reviewed','exam_completed','lesson_booked','lesson_cancelled','penalty_issued','admin_action','material_created','payment','lesson_report','report_review'])
  expect(rows.some(row=>row.type===type)).toBe(true);
 expect(rows.find(r=>r.type==='lesson_report')?.href).toBe('/lesson-operations/lesson');
 expect(rows.find(r=>r.type==='report_review')?.timestamp).toBe('2026-11-03T02:00:00.000Z');
 expect(JSON.stringify(rows)).not.toContain('PRIVATE-');
 expect(queries.join(' ')).not.toContain('issuanceJson');
 expect(queries.join(' ')).not.toContain('RETURN n ');
});
test('legacy activity without a subject ID links to the section instead of a null lesson URL',async()=>{
 const session={run:async()=>({records:[{get:(key:string)=>({id:'legacy',timestamp:'2026-11-03T00:00:00Z',title:'Activity'} as any)[key]}]})};
 const rows=await additionalActivities(session,25,(async()=>({rows:[]})) as any);
 expect(rows.find(r=>r.type==='issue_decision')?.href).toBe('/lesson-operations');
 expect(rows.some(r=>r.href?.includes('/null')||r.href?.includes('/undefined'))).toBe(false);
});
