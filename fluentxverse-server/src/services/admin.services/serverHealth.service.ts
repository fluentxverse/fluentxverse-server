import { open } from 'node:fs/promises';
import { t } from 'elysia';
import { Value } from '@sinclair/typebox/value';
import type { ServerHealth, ServerHealthSnapshot } from '../../../../shared/serverHealth';

const bytes = () => t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const rate = () => t.Union([t.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), t.Null()]);
const capacity = t.Object({ totalBytes: bytes(), usedBytes: bytes(), availableBytes: bytes() }, { additionalProperties: false });
const schema = t.Object({
  version: t.Literal(1),
  sampledAt: t.String({ maxLength: 40 }),
  hostname: t.String({ minLength: 1, maxLength: 253 }),
  uptimeSeconds: t.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  cpu: t.Object({ model: t.String({ minLength: 1, maxLength: 256 }), cores: t.Integer({ minimum: 1, maximum: 65536 }), usagePercent: t.Union([t.Number({ minimum: 0, maximum: 100 }), t.Null()]) }, { additionalProperties: false }),
  memory: capacity,
  disk: capacity,
  network: t.Object({ interface: t.String({ minLength: 1, maxLength: 32 }), addresses: t.Array(t.String({ maxLength: 64 }), { maxItems: 32 }), receivedBytes: bytes(), sentBytes: bytes(), receiveBytesPerSecond: rate(), sendBytesPerSecond: rate() }, { additionalProperties: false }),
  bandwidth: t.Object({ allowanceBytes: bytes(), billingSource: t.Literal('not_connected') }, { additionalProperties: false }),
}, { additionalProperties: false });

export class MetricsUnavailable extends Error {
  constructor() { super('Host monitoring is unavailable.'); }
}

export function validateHostSnapshot(value: unknown, now = Date.now()): ServerHealth {
  if (!Value.Check(schema, value)) throw new MetricsUnavailable();
  const snapshot = value as ServerHealthSnapshot;
  const sampled = Date.parse(snapshot.sampledAt);
  if (!Number.isFinite(sampled) || sampled > now + 5000) throw new MetricsUnavailable();
  for (const capacity of [snapshot.memory, snapshot.disk]) {
    if (!capacity.totalBytes || capacity.usedBytes > capacity.totalBytes || capacity.availableBytes > capacity.totalBytes - capacity.usedBytes) throw new MetricsUnavailable();
  }
  if (snapshot.memory.usedBytes + snapshot.memory.availableBytes !== snapshot.memory.totalBytes) throw new MetricsUnavailable();
  const ageSeconds = Math.max(0, (now - sampled) / 1000);
  return { status: ageSeconds > 30 ? 'stale' : 'live', ageSeconds, snapshot };
}

export async function readServerHealth(path = process.env.HOST_METRICS_FILE || '/run/fluentxverse-metrics/host-metrics.json'): Promise<ServerHealth> {
  let handle;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size > 65536) throw new MetricsUnavailable();
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new MetricsUnavailable();
    return validateHostSnapshot(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
  } catch {
    throw new MetricsUnavailable();
  } finally { await handle?.close(); }
}
