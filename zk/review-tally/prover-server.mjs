import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';

export function createTallyProverServer({ binary, pin, token, port = 8092, hostname = '0.0.0.0' }) {
  if (!binary || !/^[a-f0-9]{64}$/.test(pin || '') || !/^[a-f0-9]{64}$/.test(token || '')
    || createHash('sha256').update(readFileSync(binary)).digest('hex') !== pin) throw new Error('Tally prover startup configuration is invalid');
  let active = false;
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  const invoke = (mode, input) => new Promise((resolve, reject) => {
    const child = execFile(binary, [mode], { timeout: mode === 'prove' ? 1_800_000 : 60_000, maxBuffer: 8 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, RISC0_DEV_MODE: '0', RAYON_NUM_THREADS: '2' } }, (error, stdout) => {
      if (error) reject(new Error('Local proof operation failed'));
      else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid proof result')); } }
    });
    child.stdin?.on('error', () => {}); child.stdin?.end(JSON.stringify(input));
  });
  return Bun.serve({ hostname, port, maxRequestBodySize: 8 * 1024 * 1024,
    async fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/health') return json({ status: 'ok' });
      const key = request.headers.get('X-Tally-Prover-Key') || '';
      if (!/^[a-f0-9]{64}$/.test(key) || !timingSafeEqual(Buffer.from(key), Buffer.from(token))) return json({ error: 'Unauthorized' }, 401);
      if (request.method !== 'POST' || !['/metadata', '/prove', '/verify'].includes(path)) return json({ error: 'Not found' }, 404);
      if (active) return json({ error: 'Prover is busy' }, 503);
      active = true; server.timeout(request, 0);
      try {
        const input = await request.json();
        if (path === '/prove' && JSON.stringify(input).length > 1_048_576) return json({ error: 'Witness too large' }, 413);
        const result = await invoke(path.slice(1), input);
        return json(path === '/metadata' ? { ...result, binarySha256: pin } : result);
      } catch { return json({ error: 'Tally proof operation failed' }, 503); }
      finally { active = false; }
    },
    error() { return json({ error: 'Tally request failed' }, 503); },
  });
}
if (import.meta.main) {
  createTallyProverServer({ binary: process.env.ANONYMOUS_REVIEW_TALLY_PROVER || '/app/review-tally-host',
    pin: process.env.ANONYMOUS_REVIEW_TALLY_PROVER_SHA256, token: process.env.ANONYMOUS_REVIEW_TALLY_PROVER_TOKEN });
  console.log('Private local tally prover listening on port 8092');
}
