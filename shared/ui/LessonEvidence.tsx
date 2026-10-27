import { createEffect, createSignal, onCleanup, For, Show } from 'solid-js';
import { Download, FileCheck2, RefreshCw, ShieldCheck } from 'lucide-solid';
import { describeAttendanceClaim, type EvidenceField, type LessonEvidenceOptions, type LessonEvidenceRecord, type LessonPrivacyRole } from '../lessonPrivacy';
import type { LessonPrivacyApi } from '../lessonPrivacyApi';
import './lesson-privacy.css';

export default function LessonEvidence(props: { bookingId: string; role: LessonPrivacyRole; api: LessonPrivacyApi }) {
  const [data,setData] = createSignal<LessonEvidenceOptions | null>(null), [error,setError] = createSignal('');
  const [revision,setRevision] = createSignal(0), [busy,setBusy] = createSignal(false), [loading,setLoading] = createSignal(true);
  const [fields,setFields] = createSignal<EvidenceField[]>([]), [notice,setNotice] = createSignal('');
  const [clock,setClock] = createSignal(Date.now());
  let generation = 0, disposed = false;
  onCleanup(() => { disposed = true; generation++; });
  createEffect(() => {
    const id = props.bookingId, role = props.role, refresh = revision(), token = ++generation;
    void refresh;
    const controller = new AbortController(); setLoading(true); setData(null); setError('');
    props.api.evidenceOptions(role,id,controller.signal).then(value => {
      if (!controller.signal.aborted && token === generation) setData(value);
    }).catch(() => { if (!controller.signal.aborted && token === generation) setError('Could not load your private evidence.'); })
      .finally(() => { if (!controller.signal.aborted && token === generation) setLoading(false); });
    onCleanup(() => controller.abort());
  });
  createEffect(() => {
    props.bookingId; props.role; setFields([]); setNotice('');
  });
  createEffect(() => {
    const refresh = () => { setClock(Date.now()); setRevision(v => v+1); };
    const timer = window.setInterval(() => setClock(Date.now()),60000);
    window.addEventListener('focus',refresh);
    window.addEventListener('lesson-issue-updated',refresh);
    onCleanup(() => { clearInterval(timer); window.removeEventListener('focus',refresh); window.removeEventListener('lesson-issue-updated',refresh); });
  });
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy()) return;
    const id = props.bookingId; setBusy(true); setError(''); setNotice('');
    try { await action(); if (!disposed && id === props.bookingId) { setNotice(message); setRevision(v=>v+1); } }
    catch (e: any) { if (!disposed && id === props.bookingId) setError(e.response?.data?.error || e.message || 'Could not save your change.'); }
    finally { if (!disposed) setBusy(false); }
  };
  const toggle = (field: EvidenceField, checked: boolean) => setFields(list => checked ? [...list,field] : list.filter(item=>item!==field));
  const download = (record: LessonEvidenceRecord) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record.envelope,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download=`lesson-evidence-${record.id}.json`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section class="fxv-private-section fxv-evidence" aria-label="Private dispute evidence" aria-busy={loading() || busy()}>
    <header><h2><ShieldCheck size={20}/>Private dispute evidence</h2><button type="button" title="Refresh evidence" aria-label="Refresh evidence" disabled={loading()||busy()} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={17}/></button></header>
    {error() && <p role="alert" class="fxv-private-error">{error()}</p>}
    {notice() && <p role="status">{notice()}</p>}
    {loading() && <p role="status">Loading private evidence...</p>}
    <Show when={data()}>{value => <>
      {!value().enabled ? <p>Private evidence is not available yet.</p> : <>
        <p class="fxv-private-muted">Platform-signed attendance snapshot. No recordings, chat or assessment answers. This is not a ZK proof or proof of teaching quality.</p>
        <fieldset disabled={busy() || !value().canCreate}><legend>Include in snapshot</legend>
          {([['attendance','Attendance threshold for each participant'],['overlap','Shared time in the lesson room'],['cancellation','Cancellation timing']] as [EvidenceField,string][]).map(([field,label]) =>
            <label class="fxv-private-check"><input type="checkbox" checked={fields().includes(field)} onChange={e=>toggle(field,e.currentTarget.checked)}/><span>{label}</span></label>)}
        </fieldset>
        <button class="fxv-private-primary" type="button" disabled={busy() || !value().canCreate || !fields().length} onClick={()=>run(()=>props.api.createEvidence(props.role,props.bookingId,fields()),'Private snapshot created. This new snapshot has not been shared with support.')}><FileCheck2 size={17}/>Create private snapshot</button>
        {!value().canCreate && <p class="fxv-private-muted">Available after the lesson ends or is cancelled.</p>}
        <For each={value().records}>{record => <article class="fxv-evidence-record">
          <header><strong>Snapshot {new Date(record.createdAt).toLocaleString()}</strong><button type="button" title="Download signed snapshot" aria-label="Download signed snapshot" onClick={()=>download(record)}><Download size={17}/></button></header>
          <p class="fxv-private-muted">Threshold: {record.envelope.payload.thresholdMinutes} minutes. "Not established" does not mean absent.</p>
          <dl class="fxv-private-details">
            {record.envelope.payload.claims.attendance && <><div><dt>Student presence</dt><dd>{describeAttendanceClaim(record.envelope.payload.claims.attendance.student)}</dd></div><div><dt>Tutor presence</dt><dd>{describeAttendanceClaim(record.envelope.payload.claims.attendance.tutor)}</dd></div></>}
            {record.envelope.payload.claims.overlap && <div><dt>Shared room presence</dt><dd>{describeAttendanceClaim(record.envelope.payload.claims.overlap)}</dd></div>}
            {record.envelope.payload.claims.cancellation && <div><dt>Cancellation</dt><dd>{describeAttendanceClaim(record.envelope.payload.claims.cancellation)}</dd></div>}
          </dl>
          <label class="fxv-private-check"><input type="checkbox" checked={record.sharedWithSupport} disabled={busy() || Date.parse(record.expiresAt)<=clock() || (!record.sharedWithSupport&&!value().canShare)} onChange={e=>{
            const shared=e.currentTarget.checked;
            void run(()=>props.api.supportConsent(props.role,props.bookingId,record.id,shared),shared?'Snapshot shared with authorized support.':'Support access revoked.');
          }}/><span>Share this snapshot with support for my lesson issue</span></label>
          {!value().canShare && <p class="fxv-private-muted">Submit a lesson issue report before sharing with support.</p>}
          <p class="fxv-private-muted">Support access expires {new Date(record.expiresAt).toLocaleString()}. Revoking access cannot erase a copy already viewed or downloaded.</p>
        </article>}</For>
      </>}
    </>}</Show>
  </section>;
}
