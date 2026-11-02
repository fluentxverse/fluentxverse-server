import { lessonOutcomeRequests } from './requests';

export function startLessonOutcomeQueue() {
  if (process.env.LESSON_OUTCOME_QUEUE_ENABLED !== 'true') return () => {};
  const from = process.env.LESSON_OUTCOME_QUEUE_FROM || '';
  if (!Number.isFinite(Date.parse(from))) throw new Error('Set LESSON_OUTCOME_QUEUE_FROM before enabling automatic lesson proof requests.');
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await lessonOutcomeRequests.queueUnreported(new Date(from).toISOString()); }
    catch { console.warn('Lesson outcome queue check failed; no proof verification is implied.'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
