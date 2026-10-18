export interface EngineTransaction {
  id: string;
  status: string;
  transactionHash?: string;
  error?: string;
}

export class GmrEngineRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface ContractWriteInput {
  abi: unknown;
  args: string[];
  chainId: number;
  contractAddress: string;
  functionName: string;
  value?: string;
  walletAddress?: string;
}

export interface ContractReadInput {
  abi: unknown;
  args: string[];
  chainId: number;
  contractAddress: string;
  functionName: string;
}

export interface ManagedUserWallet {
  id?: string;
  address: string;
  userID?: string;
  authProvider?: string;
  email?: string;
  metadata?: string;
}

export interface EngineProofSubmission {
  id: string;
  status: string;
  zkVerifyNetwork: string;
  transactionResult: string;
}

export class GmrEngineClient {
  private readonly baseUrl = (process.env.GMR_ENGINE_API_BASE || process.env.GMR_ENGINE_BASE_URL || '').replace(/\/$/, '');
  private readonly apiKey = process.env.GMR_ENGINE_API_KEY || '';

  configured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.configured()) {
      throw new Error('GMR Engine is not configured. Set GMR_ENGINE_API_BASE and GMR_ENGINE_API_KEY.');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-GMR-Engine-Key': this.apiKey,
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new GmrEngineRequestError(response.status, `GMR Engine request failed (${response.status}): ${text}`);
    }
    return data as T;
  }

  async contractWrite(input: ContractWriteInput): Promise<EngineTransaction> {
    const result = await this.request<{ transaction: EngineTransaction }>('/v1/contracts/write', {
      method: 'POST',
      body: JSON.stringify({
        abi: input.abi,
        args: input.args,
        chainId: input.chainId,
        contractAddress: input.contractAddress,
        functionName: input.functionName,
        value: input.value || '0',
        walletAddress: input.walletAddress || '',
      }),
    });
    return result.transaction;
  }

  async rpc(chainId: number, method: string, params: unknown[] = []): Promise<unknown> {
    const result = await this.request<{ result: unknown }>('/v1/rpc/read', {
      method: 'POST', body: JSON.stringify({ chainId, method, params }),
    });
    return result.result;
  }

  async submitProof(input: { proof: unknown; publicSignals: unknown; vk: unknown; domainId: number }): Promise<Record<string, any>> {
    const result = await this.request<{ submission: EngineProofSubmission }>('/v1/zkverify/proofs', {
      method: 'POST', signal: AbortSignal.timeout(300_000),
      body: JSON.stringify({ ...input, proofSystem: 'groth16', curve: 'bn128', expectedNetwork: 'Volta' }),
    });
    if (result.submission.zkVerifyNetwork !== 'Volta') throw new Error('Legacy proof submission requires Engine Volta configuration');
    const transaction = JSON.parse(result.submission.transactionResult);
    if (!transaction.txHash) throw new Error('Engine proof submission requires reconciliation');
    return transaction;
  }

  async transaction(transactionId: string): Promise<EngineTransaction> {
    const result = await this.request<{ transaction: EngineTransaction }>(`/v1/transactions/${encodeURIComponent(transactionId)}`);
    return result.transaction;
  }

  async createManagedUserWallet(input: {
    authProvider?: string;
    email?: string;
    metadata?: string;
    userID: string;
  }): Promise<ManagedUserWallet> {
    const result = await this.request<{ wallet: ManagedUserWallet }>('/v1/user-wallets/managed', {
      method: 'POST',
      body: JSON.stringify({
        authProvider: input.authProvider || 'fluentxverse_email',
        email: input.email || '',
        metadata: input.metadata || '',
        userID: input.userID,
      }),
    });
    return result.wallet;
  }
}

export const gmrEngine = new GmrEngineClient();
