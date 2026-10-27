import { PassError } from './policy';
import type { StoredReservation } from './repository';
import type { ReviewReceipt } from '../anonymousReviews/chain';
import type { Hex } from 'viem';

// Keep the service interface for historical records, but no contract adapter is active.
export class LessonPassChain {
  private retired(): never { throw new PassError('Custom lesson-pass contracts are archived; no transaction was sent', 410); }
  async check(): Promise<any> { return this.retired(); }
  async read(_name: string, _args: unknown[] = []): Promise<any> { return this.retired(); }
  async write(_name: string, _args: unknown[]): Promise<{ id: string; status: string }> { return this.retired(); }
  async activeBatch(_id: Hex, _root: string, _count: number): Promise<boolean> { return this.retired(); }
  async submit(_proof: unknown): Promise<{ txHash: string; submissionId: string }> { return this.retired(); }
  async verifiedReceipt(_reservation: StoredReservation, _receipt: ReviewReceipt): Promise<boolean> { return this.retired(); }
  async state(_reservation: StoredReservation): Promise<number> { return this.retired(); }
  async reserve(_reservation: StoredReservation, _receipt: ReviewReceipt): Promise<{ id: string; status: string }> { return this.retired(); }
  async expiredUnspent(_reservation: StoredReservation): Promise<boolean> { return this.retired(); }
}
