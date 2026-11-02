import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { db, closePool } from '../src/db/postgres';
import { bookingSettingsService } from '../src/services/bookingSettings.service';
import { publicPassMode } from '../src/services/lessonPasses/policy';
const url = new URL(process.env.DATABASE_URL || '');
assert.equal(url.hostname, 'booking-settings-postgres');
assert.equal(url.pathname, '/booking_settings_qa');
assert.equal(url.username, 'booking_settings_qa');
assert.equal(process.env.NODE_ENV, 'test');
try {
  assert.equal((await db`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`)[0].n,0,'Use an empty disposable database');
  process.env.LESSON_BOOKING_MODE='paid';process.env.TRIAL_LESSON_LIMIT='1';
  assert.deepEqual(await bookingSettingsService.get(),{mode:'paid',trialLessonLimit:1,revision:0,updatedAt:null});
  const saved=await bookingSettingsService.update({mode:'trial',trialLessonLimit:2},0,'qa-superadmin');
  assert.equal(saved.revision,1);assert.deepEqual(await publicPassMode(),{mode:'trial',trialLessonLimit:2});
  const restarted=spawnSync(process.execPath,['--no-env-file','-e',"import{bookingSettingsService}from'./src/services/bookingSettings.service';import{closePool}from'./src/db/postgres';console.log(JSON.stringify(await bookingSettingsService.get()));await closePool();"],{encoding:'utf8',env:process.env});
  assert.equal(restarted.status,0,restarted.stderr);assert.equal(JSON.parse(restarted.stdout.trim()).mode,'trial');
  const racing=await Promise.allSettled([
    bookingSettingsService.update({mode:'paid',trialLessonLimit:1},1,'qa-one'),
    bookingSettingsService.update({mode:'trial',trialLessonLimit:3},1,'qa-two'),
  ]);
  assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(racing.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  const current=await bookingSettingsService.get();assert.equal(current.revision,2);
  assert.equal((await db`SELECT count(*)::int AS n FROM platform_booking_settings_audit`)[0].n,2);
  const audit=(await db`SELECT * FROM platform_booking_settings_audit ORDER BY revision`)[0];
  assert.equal(audit.actor_id,'qa-superadmin');assert.equal(audit.previous_mode,'paid');assert.equal(audit.mode,'trial');
  await assert.rejects(bookingSettingsService.update({mode:'trial',trialLessonLimit:0},2,'qa'),/whole number/);
  assert.equal((await bookingSettingsService.get()).revision,2);
  console.log('PASS: persisted booking policy survives process restart, concurrent saves conflict, and audit writes are atomic.');
} finally { await closePool(); }
