import { test, expect, mock, spyOn } from 'bun:test';
import Elysia from 'elysia';
import { InterviewService } from '../src/services/interview.services/interview.service';
import { signAuthToken } from '../src/utils/jwt';
mock.module('../src/middleware/auth.middleware', () => ({ createAdminGuard: async (cookie: any) => cookie.adminAuth?.value === 'staff-fixture' ? { userId: 'staff' } : null }));
const Interview = (await import('../src/routes/interview.route')).default;
test('cancelled interviews remain staff-reviewable with media closed, not joinable tutor rooms', async () => {
  const room = spyOn(InterviewService.prototype, 'getRoom').mockResolvedValue({ id:'cancelled',tutorId:'tutor',tutorName:'Test',status:'cancelled',date:'2026-11-02',time:'2:00 PM',result:null,reviewedAt:null,rubricScores:null,notes:'Private staff note',timestamps:[],mediaClosed:false,recordingUrl:undefined });
  const app = new Elysia().use(Interview);
  try {
    const get = (cookie: string) => app.handle(new Request('http://localhost/interview/room/cancelled',{headers:{origin:'https://dashboard.fluentxverse.com',cookie}}));
    const staff = await get('adminAuth=staff-fixture');
    expect(staff.status).toBe(200); const body = await staff.json() as { data: { status: string; mediaClosed: boolean; notes: string } }; const data = body.data;
    expect(data.status).toBe('cancelled'); expect(data.mediaClosed).toBe(true); expect(data.notes).toBe('Private staff note');
    const owner = await signAuthToken({userId:'tutor',role:'tutor',email:'test@example.invalid'});
    expect((await get(`tutorAuth=${owner}`)).status).toBe(404);
    const other = await signAuthToken({userId:'other',role:'tutor',email:'other@example.invalid'});
    const denied = await get(`tutorAuth=${other}`); expect(denied.status).toBe(403); expect(await denied.text()).not.toContain('Private staff note');
    expect((await get('')).status).toBe(403);
  } finally {room.mockRestore();}
});
