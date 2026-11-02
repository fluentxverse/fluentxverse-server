import type { Component } from 'solid-js';
import { ShieldCheck } from 'lucide-solid';
import './lesson-recording-notice.css';
const LessonRecordingNotice: Component = () => (
  <aside class="fxv-lesson-recording-notice" aria-label="Lesson recording notice">
    <ShieldCheck size={20} aria-hidden="true"/>
    <p><strong>Recording notice:</strong> Lessons may be recorded for quality assurance when the required permissions are in place. Recordings are handled confidentially and reviewed only by authorized staff.</p>
  </aside>
);
export default LessonRecordingNotice;
