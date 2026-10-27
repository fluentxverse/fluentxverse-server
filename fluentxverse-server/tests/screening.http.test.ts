import { test, expect, spyOn } from 'bun:test';
import Elysia from 'elysia';
import Screening from '../src/routes/screening.route';
import { sealPrivateEvidence, openPrivateEvidence } from '../src/services/screening/storage';
import { signAuthToken } from '../src/utils/jwt';
import { gmrScreeningEngine } from '../src/services/web3.services/gmrScreeningEngine.service';

const app = new Elysia().use(Screening);
test('bridge-only metadata does not claim model execution or agent registration', async () => {
  const policy = await app.handle(new Request('http://localhost/screening/policy'));
  expect(policy.status).toBe(200);
  expect(policy.headers.get('cache-control')).toBe('no-store');
  const metadata = await (await app.handle(new Request('http://localhost/screening/agent.json'))).json() as { screening: { modelExecutionProven: boolean }; registrations: unknown[] };
  expect(metadata.screening.modelExecutionProven).toBe(false);
  expect(metadata.registrations).toEqual([]);
});
test('historical agent registration is not advertised as an active dependency', async () => {
  const previous = process.env.SCREENING_ENABLED;
  const previousMode = process.env.PRIVACY_INFRA_MODE;
  process.env.SCREENING_ENABLED = 'false';
  process.env.PRIVACY_INFRA_MODE = 'bridge_only';
  const mock = spyOn(gmrScreeningEngine, 'operation').mockResolvedValue({ config: {
    chainId: 2651420, agentId: '0', identityRegistry: `0x${'1'.repeat(40)}`, vkPath: '/private/key.json', secret: 'private-value',
  } });
  try {
    const response = await app.handle(new Request('http://localhost/screening/agent.json'));
    const body = await response.text();
    const data = JSON.parse(body);
    expect(data.registrations).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
    expect(data.active).toBe(false);
    expect(body).not.toContain('private-value');
    expect(body).not.toContain('/private/key.json');
  } finally {
    mock.mockRestore();
    if (previous === undefined) delete process.env.SCREENING_ENABLED; else process.env.SCREENING_ENABLED = previous;
    if (previousMode === undefined) delete process.env.PRIVACY_INFRA_MODE; else process.env.PRIVACY_INFRA_MODE = previousMode;
  }
});
test('anonymous users and foreign origins cannot issue credentials or share credentials', async () => {
  expect((await app.handle(new Request('http://localhost/screening/me'))).status).toBe(401);
  for (const origin of ['https://untrusted.example', 'https://student.fluentxverse.com']) {
    const result = await app.handle(new Request('http://localhost/screening/admin/register-agent', { method: 'POST', headers: { origin } }));
    expect(result.status).toBe(403);
  }
  const result = await app.handle(new Request('http://localhost/screening/admin/register-agent', { method: 'POST', headers: { origin: 'https://dashboard.fluentxverse.com' } }));
  expect(result.status).toBe(401);
  const sharing = await app.handle(new Request('http://localhost/screening/123/share', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: JSON.stringify({ shared: true }) }));
  expect(sharing.status).toBe(403);
});
test('private evidence encryption authenticates the credential context and ciphertext', () => {
  const previous = process.env.SCREENING_EVIDENCE_KEY_HEX;
  process.env.SCREENING_EVIDENCE_KEY_HEX = '12'.repeat(32);
  try {
    const plaintext = Buffer.from('Private answers, scores, transcript and notes');
    const sealed = sealPrivateEvidence(plaintext, 'credential-1');
    expect(sealed).not.toContain(plaintext.toString());
    expect(openPrivateEvidence(sealed, 'credential-1')).toEqual(plaintext);
    expect(() => openPrivateEvidence(sealed, 'credential-2')).toThrow();
    const altered = JSON.parse(sealed); altered.tag = '00'.repeat(16);
    expect(() => openPrivateEvidence(JSON.stringify(altered), 'credential-1')).toThrow();
  } finally { if (previous === undefined) delete process.env.SCREENING_EVIDENCE_KEY_HEX; else process.env.SCREENING_EVIDENCE_KEY_HEX = previous; }
});
test('a signed student token in the tutor cookie cannot access screening credentials', async () => {
  const token = await signAuthToken({ userId: 'screening-role-test', email: 'test@example.invalid', role: 'student' }, 60);
  const result = await app.handle(new Request('http://localhost/screening/me', { headers: { cookie: `tutorAuth=${token}` } }));
  expect(result.status).toBe(403);
});
