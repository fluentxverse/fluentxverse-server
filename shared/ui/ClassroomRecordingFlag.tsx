import type { Component } from 'solid-js';
import { ShieldCheck } from 'lucide-solid';
const ClassroomRecordingFlag: Component<{ available: boolean; status?: string; onPreferences: () => void }> = props => (
  <aside class="classroom-qa-notice" aria-label="Lesson recording notice">
    <ShieldCheck size={15} aria-hidden="true"/>
    <span>{props.status === 'recording' ? 'This lesson is being recorded for quality assurance.' : 'Lessons may be recorded for quality assurance with the required permissions.'}
      {props.available && <> <button type="button" onClick={props.onPreferences}>Recording preferences</button></>}
    </span>
  </aside>
);
export default ClassroomRecordingFlag;
