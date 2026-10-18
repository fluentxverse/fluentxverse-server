import { expect, test, spyOn } from 'bun:test';
import { GmrEngineClient } from '../src/services/web3.services/gmrEngine.service';

test('engine read transport keeps credentials server-side and preserves null receipts', async () => {
  const oldURL = process.env.GMR_ENGINE_API_BASE, oldKey = process.env.GMR_ENGINE_API_KEY;
  process.env.GMR_ENGINE_API_BASE = 'http://engine.test:8090';
  process.env.GMR_ENGINE_API_KEY = 'fixture-engine-key';
  const client = new GmrEngineClient();
  const implementation = async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('http://engine.test:8090/v1/rpc/read');
    expect((init?.headers as Record<string, string>)['X-GMR-Engine-Key']).toBe('fixture-engine-key');
    expect(JSON.parse(String(init?.body))).toEqual({ chainId: 84532, method: 'eth_getTransactionReceipt', params: ['0x123'] });
    return Response.json({ result: null });
  };
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(implementation as typeof fetch);
  try { expect(await client.rpc(84532, 'eth_getTransactionReceipt', ['0x123'])).toBeNull(); }
  finally {
    fetchMock.mockRestore();
    if (oldURL === undefined) delete process.env.GMR_ENGINE_API_BASE; else process.env.GMR_ENGINE_API_BASE = oldURL;
    if (oldKey === undefined) delete process.env.GMR_ENGINE_API_KEY; else process.env.GMR_ENGINE_API_KEY = oldKey;
  }
});
