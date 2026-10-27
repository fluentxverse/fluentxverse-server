import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from '../../db/postgres';
import { getDriver } from '../../db/memgraph';
import { readServerHealth } from './serverHealth.service';
import { readContainerStats } from './containerStats.service';
import type { AlertSnapshot, AlertTelemetry } from '../../../../shared/operationalAlerts';

export const ALERT_MONITOR_URL = 'https://fluentxverse-alerts.paulanthonyarriola.workers.dev';
const EXPECTED = new Set(['fluentxverse-server','budol-gmr-engine-1','budol-gmr-vault-1','fluentxverse-memgraph',
  'fluentxverse-postgres','fluentxverse-redis','budol-gmr-engine-memgraph-1','budol-gmr-vault-memgraph-1',
  'fluentxverse-seaweed-master','fluentxverse-seaweed-volume','fluentxverse-seaweed-filer']);
export function monitorAuthorized(supplied: string | null, secret = process.env.OPERATIONAL_ALERTS_KEY || '') {
  const hash = (v: string) => createHash('sha256').update(v).digest();
  return secret.length >= 32 && timingSafeEqual(hash(supplied || ''), hash(secret));
}
const number = (v: any): number => { const n = typeof v?.toNumber === 'function' ? v.toNumber() : Number(v); if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid aggregate'); return n; };

export async function readArchiveAlerts(): Promise<NonNullable<AlertTelemetry['recordings']>> {
  const rows = await db`SELECT
    count(*) FILTER (WHERE (error IS NOT NULL OR attempts>=3))::int AS failed,
    count(*) FILTER (WHERE provider_status='UPLOADED' AND invoked_at<NOW()-INTERVAL '30 minutes')::int AS overdue
    FROM qa_recordings WHERE local_status NOT IN ('stored','deleted')`;
  return { failed: number(rows[0].failed), overdue: number(rows[0].overdue) };
}
export async function readPendingProofAlerts(): Promise<NonNullable<AlertTelemetry['proofs']>> {
  const session = getDriver().session();
  let pending = 0, missingTimestamp = 0; const dates: number[] = [];
  try {
    // Read application workflow metadata only. No witness, scores, identities or signing keys leave the origin.
    for (const label of ['TutorScreeningCredential', 'AnonymousReviewSubmission', 'AnonymousReviewTally', 'LessonPassReservation']) {
      const rows = await session.run(`MATCH(n:${label}) WHERE n.status IN $statuses AND coalesce(n.revoked,false)=false
        RETURN count(n) AS pending, min(coalesce(n.publicationAuthorizedAt,n.createdAt)) AS oldest,
        sum(CASE WHEN n.publicationAuthorizedAt IS NULL AND n.createdAt IS NULL THEN 1 ELSE 0 END) AS missing`,
        { statuses: ['submitting_zkverify','awaiting_horizen_validation','awaiting_horizen','certifying','finalizing'] }, { timeout: 2000 });
      const row = rows.records[0]; pending += number(row?.get('pending') || 0); missingTimestamp += number(row?.get('missing') || 0);
      const oldest = row?.get('oldest');
      if (oldest) { const date = Date.parse(String(oldest)); if (!Number.isFinite(date)) throw Error('Invalid proof timestamp'); dates.push(date); }
    }
    return { pending, oldestAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null, missingTimestamp };
  } finally { await session.close(); }
}
export async function collectAlertTelemetry(read = { host: readServerHealth, containers: readContainerStats, recordings: readArchiveAlerts, proofs: readPendingProofAlerts }): Promise<AlertTelemetry> {
  const result: AlertTelemetry = { version: 1, sampledAt: new Date().toISOString(), host: null, containers: null, recordings: null, proofs: null };
  try { const h = await read.host(); if (h.status === 'live') result.host = { diskUsedPercent: h.snapshot.disk.usedBytes / h.snapshot.disk.totalBytes * 100, diskAvailableBytes: h.snapshot.disk.availableBytes }; } catch {}
  try { const c = await read.containers(); if (c.status !== 'stale') result.containers = c.snapshot.containers.filter(c => EXPECTED.has(c.name)).map(c => ({ id: c.id, name: c.name, state: c.state, restartCount: c.restartCount ?? null, health: c.health ?? null })); } catch {}
  try { result.recordings = await read.recordings(); } catch {}
  try { result.proofs = await read.proofs(); } catch {}
  return result;
}
export async function alertMonitorRequest(path: '/snapshot' | '/acknowledge', body?: { id: string; actor: string }): Promise<AlertSnapshot> {
  const key = process.env.OPERATIONAL_ALERTS_KEY || ''; if (key.length < 32) throw Error('Alerts not configured');
  const response = await fetch(ALERT_MONITOR_URL + path, { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(response.status === 409 ? 'Incident no longer active' : 'Alert monitor unavailable');
  return response.json();
}
