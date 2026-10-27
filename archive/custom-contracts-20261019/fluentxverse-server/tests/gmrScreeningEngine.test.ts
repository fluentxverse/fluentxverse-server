import { afterEach, expect, test } from 'bun:test';
import { GmrScreeningEngineClient, gmrScreeningEngine } from '../src/services/web3.services/gmrScreeningEngine.service';
import { gmrEngine } from '../src/services/web3.services/gmrEngine.service';
import { proveScreeningCredential } from '../src/services/screening/prover';
import { policyHash, schemaHash } from '../src/services/screening/policy';

const originalFetch = globalThis.fetch;
const originalOperation = gmrScreeningEngine.operation;
const savedMode = process.env.PRIVACY_INFRA_MODE;
afterEach(() => { globalThis.fetch = originalFetch; gmrScreeningEngine.operation = originalOperation;
  if (savedMode === undefined) delete process.env.PRIVACY_INFRA_MODE; else process.env.PRIVACY_INFRA_MODE = savedMode; });

test('screening uses its own project key and never exposes it in payloads', async () => {
  process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    expect(url).toBe('https://engine.example/v1/screening/certify');
    expect((init.headers as Record<string,string>)['X-GMR-Engine-Key']).toBe('test-screening-key');
    expect(String(init.body)).not.toContain('test-screening-key');
    expect((init.headers as Record<string,string>).Origin).toBeUndefined();
    return Response.json({ transaction: { id: 'queued-id', status: 'queued' }, certified: false });
  }) as any;
  const client = new GmrScreeningEngineClient('https://engine.example', 'test-screening-key');
  expect(await client.queue('certify', { publicSignals: ['1'] })).toEqual({ id: 'queued-id', status: 'queued' });
});

test('screening fails without its dedicated connection', async () => {
  const client = new GmrScreeningEngineClient('', '');
  await expect(client.operation('config')).rejects.toThrow('dedicated screening Engine connection');
});

test('provider errors are sanitized', async () => {
  globalThis.fetch = (async () => Response.json({ error: 'private-provider-credential' }, { status: 409 })) as any;
  try { await new GmrScreeningEngineClient('https://engine.example','test-key').operation('register'); throw Error('Expected failure'); }
  catch (error) {
    expect(String(error)).toContain('409');
    expect(String(error)).not.toContain('private-provider-credential');
    expect(String(error)).not.toContain('test-key');
  }
});

test('legacy proof submission delegates to Engine and requires Volta', async () => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    expect(String(url)).toEndWith('/v1/zkverify/proofs');
    const body = JSON.parse(String(init.body));
    expect(body.expectedNetwork).toBe('Volta');
    expect(body.curve).toBe('bn128');
    expect(body.seedPhrase).toBeUndefined();
    return Response.json({ submission: { id: 'engine-proof-id', zkVerifyNetwork: 'Volta', transactionResult: JSON.stringify({txHash:'0xtest',status:'finalized'}) } });
  }) as any;
  expect(await gmrEngine.submitProof({proof:{},publicSignals:[],vk:{},domainId:0})).toEqual({txHash:'0xtest',status:'finalized'});
});

test('credential proving delegates the witness to Engine and rejects a changed statement', async () => {
  process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
  const signals = ['1','2',policyHash,schemaHash,'5','6','7','8','9','100','31536100','2651420','0','10','11'];
  const witness = { writtenScore: '90' };
  gmrScreeningEngine.operation = (async (action: string, input: any) => {
    expect(action).toBe('prove'); expect(input).toEqual({ input: witness, publicSignals: signals });
    return { proof: { protocol: 'groth16' }, publicSignals: signals };
  }) as any;
  expect(await proveScreeningCredential(witness, signals)).toEqual({ protocol: 'groth16' });
  gmrScreeningEngine.operation = (async () => ({ proof: {}, publicSignals: [...signals.slice(0,14), '12'] })) as any;
  await expect(proveScreeningCredential(witness, signals)).rejects.toThrow('does not match issued credential');
});
