import { afterAll, beforeAll, expect, test, describe } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { NotificationService } from '../src/services/notification.services/notification.service';

const uri = process.env.NOTIFICATIONS_TEST_URI;
if (uri && uri !== 'bolt://127.0.0.1:17987') throw Error('Use the disposable localhost notification test database only');
const suite = uri ? describe : describe.skip;
const prefix = 'notification-resolution-' + crypto.randomUUID(), owner = prefix+'-owner', other=prefix+'-other';
const service = new NotificationService();
async function run(query: string, params: Record<string, any> = {}) {
  const session=getDriver().session();
  try{return await session.run(query,params);}finally{await session.close();}
}
suite('lesson notification reconciliation with disposable Memgraph',()=>{
  beforeAll(async()=>{
    await initDriver(uri!, '', '', 1);
    for(const [key,state]of Object.entries({
      submitted:{status:'completed',notesSubmittedAt:'2026-10-31',notesDraftDirty:false},
      draft:{status:'completed'},cancelled:{status:'cancelled'},absent:{attendanceStudent:'absent'},
      changed:{status:'completed',notesSubmittedAt:'2026-10-31',notesDraftDirty:true},
    }))await run('CREATE (b:Booking {bookingId:$id}) SET b += $state',{id:prefix+'-'+key,state});
    for(const key of ['submitted','draft','cancelled','absent','changed','missing']){
      await service.createNotification({userId:owner,userType:'tutor',type:key==='cancelled'?'session_reminder':'system',
        title:'Reminder',message:'Please act',data:key==='cancelled'
          ?{sessionId:prefix+'-'+key,link:'/classroom/'+prefix+'-'+key}
          :{bookingId:prefix+'-'+key,link:'/lesson/'+prefix+'-'+key}});
      await run('MATCH (n:Notification {userId:$owner}) WHERE n.data CONTAINS $bookingId SET n.id=$id',
        {owner,bookingId:prefix+'-'+key,id:(key==='cancelled'?'booking:':'notes-reminder:')+prefix+'-'+key+':pending'});
    }
    await service.createNotification({userId:other,userType:'tutor',type:'system',title:'Other user',message:'Keep unread',data:{}});
  });
  afterAll(async()=>{
    await run('MATCH (n) WHERE n.userId IN $users OR n.bookingId STARTS WITH $prefix DETACH DELETE n',{users:[owner,other],prefix});
    await closeDriver();
  });
  test('unread filtering and pagination happen after obsolete reminders are resolved',async()=>{
    const unread=await service.getNotifications({userId:owner,isRead:false,limit:1});
    expect(unread).toHaveLength(1);
    expect(['draft','changed'].some(key=>unread[0]!.data?.bookingId===prefix+'-'+key)).toBe(true);
    expect(await service.getUnreadCount(owner)).toBe(2);
    const next=await service.getNotifications({userId:owner,isRead:false,limit:1,offset:1});
    expect(next).toHaveLength(1);expect(next[0]!.id).not.toBe(unread[0]!.id);
    expect(await service.getUnreadCount(other)).toBe(1);
  });
  test('history retains all notices and removes unavailable links persistently',async()=>{
    const items=await service.getNotifications({userId:owner,limit:20});
    expect(items).toHaveLength(6);
    const missing=items.find(item=>item.data?.bookingId===prefix+'-missing')!;
    expect(missing.isRead).toBe(true);
    expect(missing.data?.link).toBeUndefined();
    expect((missing.data as any).actionUnavailable).toBe(true);
    expect(items.filter(item=>item.isRead)).toHaveLength(4);
    const cancelled=items.find(item=>item.type==='session_reminder')!;
    expect(cancelled.isRead).toBe(true);
    expect(cancelled.data?.link).toBe('/lesson/'+prefix+'-cancelled');
  });
  test('parallel list/count reads reconcile consistently',async()=>{
    const values=await Promise.all([service.getUnreadCount(owner),service.getNotifications({userId:owner,isRead:false}),service.getUnreadCount(owner)]);
    expect(values[0]).toBe(2);expect(values[1]).toHaveLength(2);expect(values[2]).toBe(2);
  });
});
