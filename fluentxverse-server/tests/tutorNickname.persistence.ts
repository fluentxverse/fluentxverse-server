import { expect, test } from 'bun:test';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { TutorService } from '../src/services/tutor.services/tutor.service';
import { AdminService } from '../src/services/admin.services/admin.service';
import { signAuthToken } from '../src/utils/jwt';
import { FavoritesService } from '../src/services/favorites.services/favorites.service';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';

test('nickname validation, initial review, public privacy and approved change moderation persist', async () => {
  if (process.env.NICKNAME_TEST_URI !== 'bolt://127.0.0.1:17729') throw Error('Use only the disposable nickname graph on 17729');
  process.env.JWT_SECRET = 'nickname-fixture-not-a-production-key';
  await initDriver(process.env.NICKNAME_TEST_URI, '', '', 30, 500);
  const session = getDriver().session();
  let ownsFixture = false;
  try {
    expect(Number((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n'))).toBe(0);
    ownsFixture = true;
    await session.run("CREATE (:User {id:'nickname-fixture',email:'fixture@example.invalid',firstName:'LegalFirst',lastName:'PrivateSurname',displayName:'LegalFirst PrivateSurname',profileStatus:'incomplete',bio:'A complete tutor introduction',profilePicture:'photo.jpg',videoIntroUrl:'intro.mp4',schoolAttended:'Sample School',major:'English',interests:'[\"Reading\"]'})");
    const { default: TutorRoutes } = await import('../src/routes/tutor.route');
    const api = new Elysia().use(TutorRoutes);
    const token = await signAuthToken({ userId: 'nickname-fixture', role: 'tutor', email: 'fixture@example.invalid' } as any);
    const request = async (path: string, data?: unknown, method = 'PATCH') => (await api.handle(new Request('http://localhost/tutor/'+path, {
      method, headers: { Cookie: `tutorAuth=${token}`, 'Content-Type':'application/json' }, ...(data === undefined ? {} : {body:JSON.stringify(data)}),
    }))).json() as Promise<any>;
    expect((await request('profile/submit', {}, 'POST')).error).toContain('Preferred nickname');
    for (const nickname of ['', 'Alex99', '@Alex', 'Mary  Ann', '<script>']) expect((await request('profile', {nickname})).success).toBe(false);
    expect((await request('profile', {nickname:' Alex '})).success).toBe(true);
    expect((await request('profile/submit', {}, 'POST')).success).toBe(true);
    const admin = new AdminService(), service = new TutorService();
    const pending = await admin.getPendingProfileReviews();
    expect(pending[0]?.nickname).toBe('Alex');
    for (const key of ['profilePicture','videoIntro','bio','education','interests'] as const) expect((await admin.reviewProfileItem('nickname-fixture',key,'approve')).allApproved).toBe(false);
    expect((await admin.reviewProfileItem('nickname-fixture','nickname','approve')).allApproved).toBe(true);
    const publicProfile = await request('nickname-fixture', undefined, 'GET');
    expect(publicProfile.data).toMatchObject({nickname:'Alex',displayName:'Alex',firstName:'Alex',lastName:'',email:''});
    expect(JSON.stringify(publicProfile.data)).not.toContain('PrivateSurname');
    expect((await service.getTutorProfile('nickname-fixture'))?.lastName).toBe('PrivateSurname');
    expect((await request('profile', {nickname:'Lex'})).hasPendingChanges).toBe(true);
    expect((await service.getTutorProfile('nickname-fixture'))?.nickname).toBe('Alex');
    await admin.reviewPendingChange('nickname-fixture',0,'reject','Use the name in your video.');
    expect((await service.getTutorProfile('nickname-fixture'))?.nickname).toBe('Alex');
    await service.updateProfile('nickname-fixture',{nickname:'Lex'});
    await admin.reviewPendingChange('nickname-fixture',0,'approve');
    expect((await service.getTutorProfile('nickname-fixture'))?.nickname).toBe('Lex');
    expect((await request('nickname-fixture', undefined, 'GET')).data.displayName).toBe('Lex');
    const futureDate = new Date(Date.now()+86400000).toISOString().slice(0,10);
    await session.run(`MATCH(u:User {id:'nickname-fixture'}) SET u.writtenExamPassed=true,u.speakingExamPassed=true,u.interviewPassed=true
      CREATE (s:Student {id:'nickname-student'})
      CREATE (u)-[:OPENS_SLOT]->(slot:TimeSlot {id:'nickname-slot',slotDate:$date,slotTime:'10:00 AM',status:'open',attendanceMarked:'present',tutorId:u.id})
      CREATE (s)-[:FAVORITES {id:'nickname-favorite',createdAt:'2026-10-28'}]->(u)
      CREATE (b:Booking {bookingId:'nickname-booking',tutorId:u.id,status:'confirmed',durationMinutes:30})-[:BOOKS]->(slot)
      CREATE (b)-[:BOOKED_BY]->(s)`, {date:futureDate});
    const search = await service.searchTutors({query:'Lex',dateFilter:futureDate});
    expect(search.tutors[0]).toMatchObject({nickname:'Lex',displayName:'Lex',firstName:'Lex',lastName:'',email:''});
    expect((await service.searchTutors({query:'PrivateSurname',dateFilter:futureDate})).tutors).toHaveLength(0);
    expect((await new FavoritesService().getFavorites('nickname-student')).favorites[0]?.tutorName).toBe('Lex');
    expect((await new ScheduleService().getStudentBookings('nickname-student'))[0]?.tutorName).toBe('Lex');
    expect((await new ScheduleService().getStudentStats('nickname-student')).nextLesson?.tutorName).toBe('Lex');
    // Re-editing a nickname already checked during initial review must invalidate that check.
    await session.run("MATCH(u:User {id:'nickname-fixture'}) SET u.profileStatus='pending_review'");
    await service.updateProfile('nickname-fixture',{nickname:'Sam'});
    expect(JSON.parse((await session.run("MATCH(u:User {id:'nickname-fixture'}) RETURN u.profileItemStatuses AS s")).records[0]!.get('s')).nickname.status).toBe('pending');
  } finally {
    if (ownsFixture) await session.run('MATCH(n) DETACH DELETE n');
    await session.close(); await closeDriver();
  }
}, 30000);
