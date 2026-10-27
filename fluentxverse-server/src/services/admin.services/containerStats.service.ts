import { open } from 'node:fs/promises';
import { t } from 'elysia';
import { Value } from '@sinclair/typebox/value';
import type { ContainerSnapshot, ContainerStats } from '../../../../shared/containerStats';

const counter = () => t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const schema = t.Object({
  version: t.Literal(1), sampledAt: t.String({ maxLength: 40 }), hostname: t.String({ minLength: 1, maxLength: 253 }),
  containers: t.Array(t.Object({
    id: t.String({ pattern: '^[a-f0-9]{64}$' }), name: t.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$' }),
    state: t.Union(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].map(value => t.Literal(value))),
    status: t.String({ maxLength: 256 }),
    restartCount: t.Optional(t.Union([counter(), t.Null()])),
    health: t.Optional(t.Union([t.Literal('none'), t.Literal('healthy'), t.Literal('unhealthy'), t.Literal('starting'), t.Null()])),
    metrics: t.Union([t.Null(), t.Object({
      cpuPercent: t.Union([t.Number({ minimum: 0, maximum: 10_000_000 }), t.Null()]),
      memoryBytes: counter(), memoryLimitBytes: t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      receivedBytes: counter(), sentBytes: counter(), blockReadBytes: counter(), blockWrittenBytes: counter(), pids: counter(),
    }, { additionalProperties: false })]),
  }, { additionalProperties: false }), { maxItems: 256 }),
}, { additionalProperties: false });

export class ContainerMetricsUnavailable extends Error {
  constructor() { super('Container monitoring is unavailable.'); }
}

export function validateContainerSnapshot(value: unknown, now = Date.now()): ContainerStats {
  if (!Value.Check(schema, value)) throw new ContainerMetricsUnavailable();
  const snapshot = value as ContainerSnapshot, sampled = Date.parse(snapshot.sampledAt);
  if (!Number.isFinite(sampled) || sampled > now + 5000 || new Set(snapshot.containers.map(c => c.id)).size !== snapshot.containers.length) throw new ContainerMetricsUnavailable();
  const ageSeconds = Math.max(0, (now - sampled) / 1000);
  const partial = snapshot.containers.some(c => ['running', 'paused'].includes(c.state) && !c.metrics);
  return { status: ageSeconds > 30 ? 'stale' : partial ? 'partial' : 'live', ageSeconds, snapshot };
}

export async function readContainerStats(path = process.env.CONTAINER_METRICS_FILE || '/run/fluentxverse-container-metrics/container-metrics.json'): Promise<ContainerStats> {
  let file;
  try {
    file = await open(path, 'r');
    const info = await file.stat();
    if (!info.isFile() || info.size > 262144) throw new ContainerMetricsUnavailable();
    const buffer = Buffer.alloc(262145), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 262144) throw new ContainerMetricsUnavailable();
    return validateContainerSnapshot(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
  } catch { throw new ContainerMetricsUnavailable(); }
  finally { await file?.close(); }
}
