import { LessonPrivacyCrypto } from './crypto';
import { LessonPrivacyStore } from './store';

export function startLessonEvidenceRetention(store = new LessonPrivacyStore()) {
  if (!new LessonPrivacyCrypto().evidenceEnabled) return () => {};
  let running = false;
  const purge = async () => {
    if (running) return;
    running = true;
    try { await store.purgeExpired(); }
    catch { console.warn('Lesson evidence expiry cleanup failed; it will retry.'); }
    finally { running = false; }
  };
  void purge();
  const timer = setInterval(() => void purge(), 3600000);
  timer.unref();
  return () => clearInterval(timer);
}
