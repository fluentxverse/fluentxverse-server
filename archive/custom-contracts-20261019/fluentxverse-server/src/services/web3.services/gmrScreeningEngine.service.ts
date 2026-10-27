import { GmrEngineRequestError, type EngineTransaction } from './gmrEngine.service';
import { privacyInfrastructure } from '../proof.services/horizenReceipt';

// Screening uses a separate Engine project; never fall back to the ticket key.
export class GmrScreeningEngineClient {
  constructor(private readonly baseUrl = (process.env.GMR_SCREENING_ENGINE_API_BASE || '').replace(/\/$/, ''),
    private readonly apiKey = process.env.GMR_SCREENING_ENGINE_API_KEY || '') {}

  async operation<T = Record<string, unknown>>(action: string, input: unknown = {}): Promise<T> {
    if (!this.baseUrl || !this.apiKey) throw new Error('Configure the dedicated screening Engine connection');
    const response = await fetch(`${this.baseUrl}/v1/screening/${action}`, {
      method: action === 'config' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': this.apiKey },
      body: action === 'config' ? undefined : JSON.stringify(input),
      signal: AbortSignal.timeout(action === 'submit' ? 300_000 : action === 'prove' ? 240_000 : 100_000),
    });
    if (!response.ok) throw new GmrEngineRequestError(response.status, `Screening Engine ${action} failed (${response.status}); check Engine project configuration`);
    return response.json() as Promise<T>;
  }

  async queue(action: 'register' | 'request-validation' | 'certify' | 'revoke', input: unknown = {}): Promise<EngineTransaction> {
    if (privacyInfrastructure() === 'bridge_only') throw new Error('Custom screening contract writes are disabled');
    const result = await this.operation<{ transaction: EngineTransaction }>(action, input);
    return result.transaction;
  }
}

export const gmrScreeningEngine = new GmrScreeningEngineClient();
