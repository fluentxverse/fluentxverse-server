import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { LessonSurveyService } from '../src/services/lessonSurvey.service';
import { TutorPerformanceService } from '../src/services/tutorPerformance.service';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required');
await initDriver(uri, '', '', 1);
const graph = getDriver().session();
const suffix = crypto.randomUUID(), studentId = `survey-student-${suffix}`, tutorId = `survey-tutor-${suffix}`;
const id = (name: string) => `survey-${name}-${suffix}`;
const service = new LessonSurveyService();
try {
  await graph.run('CREATE (:Student {id: $studentId}), (:User {id: $tutorId, rating: 4.0, totalReviews: 2})', { studentId, tutorId });
  for (const [name, offset, status, attendance] of [
    ['first', -60 * 60_000, 'confirmed', 'present'], ['second', -60 * 60_000, 'completed', 'present'],
    ['third', -60 * 60_000, 'confirmed', 'present'], ['fourth', -60 * 60_000, 'confirmed', 'present'],
    ['early-exit', -5 * 60_000, 'confirmed', 'present'],
    ['future', 60 * 60_000, 'confirmed', 'present'], ['closed', -50 * 3600_000, 'completed', 'present'],
    ['cancelled', -60 * 60_000, 'cancelled', 'present'], ['absent', -60 * 60_000, 'completed', 'absent'],
  ] as const) {
    await graph.run(`MATCH (s:Student {id: $studentId}) CREATE (b:Booking {bookingId: $bookingId, tutorId: $tutorId,
      status: $status, attendanceStudent: $attendance, attendanceTutor: 'present', durationMinutes: 25,
      slotDateTime: datetime($start)})-[:BOOKED_BY]->(s)`,
    { studentId, tutorId, bookingId: id(name), status, attendance, start: new Date(Date.now() + offset).toISOString() });
  }
  await assert.rejects(service.get(id('first'), 'another-student'));
  await assert.rejects(service.submit(id('first'), 'another-student', { rating: 5 }));
  for (const name of ['future', 'closed', 'cancelled', 'absent']) {
    assert.equal((await service.get(id(name), studentId)).eligible, false);
    await assert.rejects(service.submit(id(name), studentId, { rating: 5 }));
  }
  const duplicate = await Promise.allSettled([1, 2].map(() => service.submit(id('first'), studentId,
    { rating: 5, positive: ['connection'], improvement: ['pace'], comment: 'Private comment' })));
  assert.equal(duplicate.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await service.get(id('first'), studentId)).survey?.comment, 'Private comment');
  await service.submit(id('second'), studentId, { rating: 3 });
  await Promise.all([service.submit(id('third'), studentId, { rating: 4 }), service.submit(id('fourth'), studentId, { rating: 2 })]);
  const counts = await graph.run('MATCH (t:User {id: $tutorId}) RETURN t.rating AS rating, t.totalReviews AS count', { tutorId });
  assert.equal(Number(counts.records[0]!.get('count')), 6);
  assert.equal(Number(counts.records[0]!.get('rating')), 22 / 6);
  const metrics = await new TutorPerformanceService().get(tutorId, 'all');
  assert.equal(metrics.survey.total, 4); assert.equal(metrics.survey.average, 3.5);
  assert.equal(metrics.survey.topics.find(t => t.id === 'connection')?.positiveRate, 25);
  assert(!JSON.stringify(metrics.survey).includes('Private comment'));
  assert.equal((await service.get(id('early-exit'), studentId)).eligible, false);
  assert.equal(await service.markReady(id('early-exit'), 'another-tutor'), false);
  assert.equal(await service.markReady(id('future'), tutorId), false);
  assert.equal(await service.markReady(id('cancelled'), tutorId), false);
  assert.equal(await service.markReady(id('absent'), tutorId), false);
  assert.equal(await service.markReady(id('early-exit'), tutorId, 'left'), true);
  assert.equal((await service.get(id('early-exit'), studentId)).eligible, true);
  await service.clearDepartureReadiness(id('early-exit'), tutorId);
  assert.equal((await service.get(id('early-exit'), studentId)).eligible, false);
  assert.equal(await service.markReady(id('early-exit'), tutorId, 'ended'), true);
  await service.clearDepartureReadiness(id('early-exit'), tutorId);
  assert.equal((await service.get(id('early-exit'), studentId)).eligible, true);
  assert((await new ScheduleService().getLessonDetails(id('early-exit'), studentId)).surveyReadyAt);
  await service.submit(id('early-exit'), studentId, { rating: 4 });
  const updatedMetrics = await new TutorPerformanceService().get(tutorId, 'all');
  assert.equal(updatedMetrics.survey.total, 5);
  assert.equal(updatedMetrics.survey.average, 3.6);
  await assert.rejects(service.submit(id('early-exit'), studentId, { rating: 4 }));
  console.log('PASS: survey authorization, eligibility, duplicate concurrency, persistence, rating updates, and private aggregates');
} finally {
  await graph.run(`MATCH (n) WHERE n.id IN [$studentId, $tutorId] OR n.tutorId = $tutorId DETACH DELETE n`, { studentId, tutorId });
  await graph.close(); await closeDriver();
}
