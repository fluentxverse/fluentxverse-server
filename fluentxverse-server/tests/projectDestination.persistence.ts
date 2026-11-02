import assert from 'node:assert/strict';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { AnonymousReviewRepository, type ReviewCohort } from '../src/services/anonymousReviews/repository';
import { mainnetReceiptCoordinates } from '../src/services/proof.services/projectDestination';
import { reviewGroupId, reviewScope } from '../src/services/anonymousReviews/policy';

if (process.env.PROJECT_DESTINATION_TEST_URI !== 'bolt://127.0.0.1:17739') throw Error('Use only the disposable destination graph on port 17739');
process.env.PROOF_DESTINATION_MODE = 'project';
await initDriver(process.env.PROJECT_DESTINATION_TEST_URI, '', '', 60, 500);
const db = getDriver().session(), repo = new AnonymousReviewRepository();
try {
  assert.equal(Number((await db.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n')), 0);
  await repo.ready();
  for (let n = 0; n < 10; n++) {
    const studentId = 'synthetic-student-'+n, tutorId = 'synthetic-tutor-'+n, period = '2099-01';
    await db.run('CREATE(:Student{id:$studentId})', { studentId });
    const cohorts = [42161, 33139].map(chainId => {
      const d = mainnetReceiptCoordinates(chainId), id = reviewGroupId(tutorId, period, chainId);
      return { id, tutorId, period, chainId, contract: d.bridge.toLowerCase(), scope: reviewScope(chainId, d.bridge, id),
        opensAt: '2099-02-01T00:00:00Z', closesAt: '2099-02-08T00:00:00Z' } as ReviewCohort;
    });
    const attempts = await Promise.allSettled(cohorts.map((cohort, i) => repo.enroll(cohort, studentId+'-'+i, studentId, '123')));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1, 'Two concurrent destinations created duplicate review entitlements');
    const winner = attempts.findIndex(r => r.status === 'fulfilled');
    await repo.enroll(cohorts[winner]!, studentId+'-'+winner, studentId, '123');
    await assert.rejects(repo.enroll(cohorts[winner]!, studentId+'-'+winner, studentId, '456'), /original review key/);
    const original = await repo.enrollmentForPeriod(tutorId, period, studentId);
    assert.equal(original?.cohort.chainId, cohorts[winner]!.chainId);
    const rows = await db.run('MATCH(e:AnonymousReviewEnrollment {studentId:$studentId}) RETURN count(e) AS n', { studentId });
    assert.equal(Number(rows.records[0]!.get('n')), 1);
  }
  console.log('PASS: ten concurrent cross-destination enrollment races, idempotent retries and immutable review keys.');
} finally { await db.close(); await closeDriver(); }
