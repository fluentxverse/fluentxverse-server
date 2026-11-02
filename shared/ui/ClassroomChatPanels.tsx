import { createEffect, on, onCleanup, type Component } from 'solid-js';
import { CalendarDays, Check, History, Mic, RefreshCw, Settings, ShieldCheck, Video, X } from 'lucide-solid';

export const ClassroomChatTools: Component<{ onHistory: () => void; onSettings: () => void }> = props => <div class="chat-header-actions" aria-label="Chat tools">
  <button type="button" class="chat-tool-btn" title="Classroom history" aria-label="Classroom history" onClick={props.onHistory}><History size={18}/></button>
  <button type="button" class="chat-tool-btn" title="Device settings" aria-label="Device settings" onClick={props.onSettings}><Settings size={18}/></button>
</div>;

interface Activity {
  id: string;
  userType: 'tutor' | 'student';
  message: string;
  createdAt: string;
}

interface Props {
  historyOpen: boolean;
  settingsOpen: boolean;
  sessionId: string;
  historyLoading: boolean;
  activities: Activity[];
  formatDate: (date?: string) => string;
  formatTime: (date: string) => string;
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  audioDeviceId: string;
  videoDeviceId: string;
  onAudioDevice: (id: string) => void;
  onVideoDevice: (id: string) => void;
  applying: boolean;
  recordingAvailable: boolean;
  onRecording: () => void;
  onRefreshHistory: () => void;
  onRefreshDevices: () => void;
  onApply: () => void;
  onClose: () => void;
}

const ClassroomChatPanels: Component<Props> = props => {
  let container: HTMLDivElement | undefined;
  let trigger: HTMLElement | null = null;
  const close = () => {
    if (props.applying) return;
    props.onClose();
    if (trigger?.isConnected) trigger.focus();
  };
  createEffect(on(() => props.historyOpen || props.settingsOpen, open => {
    if (!open) return;
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    container?.querySelector<HTMLButtonElement>('.classroom-modal-close')?.focus();
  }));
  createEffect(() => {
    const escape = (event: KeyboardEvent) => {
      // A nested recording dialog owns Escape until it is dismissed.
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (!props.historyOpen && !props.settingsOpen) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', escape);
    onCleanup(() => document.removeEventListener('keydown', escape));
  });
  return <div ref={container} class="classroom-chat-panels">
    {(props.historyOpen || props.settingsOpen) && <div class="classroom-chat-popover">
      {props.historyOpen && <div class="classroom-modal classroom-history-modal" role="dialog" aria-modal="false" aria-labelledby="classroom-history-title">
        <div class="classroom-modal-header">
          <div>
            <h2 id="classroom-history-title">History</h2>
            <div class="classroom-modal-meta">
              <span>SID: {props.sessionId}</span>
              <span><CalendarDays size={15}/>{props.formatDate(props.activities[0]?.createdAt)}</span>
            </div>
          </div>
          <button type="button" class="classroom-modal-close" aria-label="Close history" onClick={close}><X size={18}/></button>
        </div>
        <div class="classroom-history-list" aria-busy={props.historyLoading}>
          {props.historyLoading ? <div class="classroom-modal-empty">Loading history...</div> : props.activities.length === 0 ? <div class="classroom-modal-empty">No classroom activity yet.</div> : props.activities.map(log => <div class={`classroom-history-item ${log.userType}`}>
            <span class="classroom-history-marker" aria-hidden="true"/>
            <span class="classroom-history-time">{props.formatTime(log.createdAt)}</span>
            <span class="classroom-history-message">{log.message}</span>
          </div>)}
        </div>
        <div class="classroom-modal-footer">
          <button type="button" class="classroom-modal-primary" disabled={props.historyLoading} onClick={props.onRefreshHistory}><RefreshCw size={16}/>Refresh</button>
        </div>
      </div>}
      {props.settingsOpen && <div class="classroom-modal classroom-settings-modal" role="dialog" aria-modal="false" aria-labelledby="classroom-settings-title">
        <div class="classroom-modal-header">
          <div><h2 id="classroom-settings-title">Settings</h2><div class="classroom-modal-meta"><span>Classroom devices</span></div></div>
          <button type="button" class="classroom-modal-close" disabled={props.applying} aria-label="Close settings" onClick={close}><X size={18}/></button>
        </div>
        <div class="classroom-device-fields">
          <label class="classroom-device-field">
            <span><Mic size={16}/>Microphone</span>
            <select value={props.audioDeviceId} disabled={props.applying} onChange={event => props.onAudioDevice(event.currentTarget.value)}>
              <option value="">Default microphone</option>
              {props.audioDevices.map((device, index) => <option value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
            </select>
          </label>
          <label class="classroom-device-field">
            <span><Video size={16}/>Camera</span>
            <select value={props.videoDeviceId} disabled={props.applying} onChange={event => props.onVideoDevice(event.currentTarget.value)}>
              <option value="">Default camera</option>
              {props.videoDevices.map((device, index) => <option value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
            </select>
          </label>
        </div>
        {props.recordingAvailable && <button type="button" class="classroom-recording-settings" onClick={props.onRecording}><ShieldCheck size={17}/>Recording permission</button>}
        <div class="classroom-modal-footer">
          <button type="button" class="classroom-modal-secondary" disabled={props.applying} onClick={props.onRefreshDevices}><RefreshCw size={16}/>Refresh</button>
          <button type="button" class="classroom-modal-primary" disabled={props.applying} onClick={props.onApply}><Check size={16}/>{props.applying ? 'Applying...' : 'Apply'}</button>
        </div>
      </div>}
    </div>}
  </div>;
};

export default ClassroomChatPanels;
