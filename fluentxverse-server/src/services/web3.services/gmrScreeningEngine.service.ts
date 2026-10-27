import type { EngineTransaction } from './gmrEngine.service';

// Compatibility surface for retired callers. Generic proof submission lives in screening/chain.ts.
export class GmrScreeningEngineClient {
  constructor(private readonly baseUrl = (process.env.GMR_SCREENING_ENGINE_API_BASE || '').replace(/\/$/, ''),
    private readonly apiKey = process.env.GMR_SCREENING_ENGINE_API_KEY || '') {}

  async operation<T = Record<string, unknown>>(action: string, input: unknown = {}): Promise<T> {
    throw new Error('Custom screening contract APIs are archived; use generic Engine proof/receipt APIs');
  }

  async queue(action: 'register' | 'request-validation' | 'certify' | 'revoke', input: unknown = {}): Promise<EngineTransaction> {
    throw new Error('Custom screening contract writes are archived and disabled');
  }
}

export const gmrScreeningEngine = new GmrScreeningEngineClient();
