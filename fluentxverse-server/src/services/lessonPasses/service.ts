import type { PassAccount } from '../../shared/lessonPasses';
import { PassError } from './policy';
import { LessonPassRepository } from './repository';
import { LessonPassChain } from './chain';

export class LessonPassService {
  constructor(readonly repository = new LessonPassRepository(), readonly chain = new LessonPassChain()) {}
  async mine(studentId: string): Promise<PassAccount & { archived: true }> {
    const result = await this.repository.account(studentId);
    return { archived: true, vault: result.vault,
      passes: result.passes.map(n => ({ id: n.id, commitment: n.commitment, status: n.status, batchId: n.batchId, origin: n.origin })),
      reservations: result.reservations.map(n => ({ id: n.id, passId: n.passId, root: n.root, refundCommitment: n.refundCommitment,
        deadline: Number(n.deadline), status: n.status, bookingId: n.bookingId })),
      orders: result.orders.map(n => ({ id: n.id, quantity: Number(n.quantity), cents: Number(n.cents), status: n.status })) };
  }
  private archived(): never { throw new PassError('Custom lesson-pass contracts are archived; existing balances and claims were not changed', 410); }
  async saveVault(..._args: unknown[]): Promise<any> { return this.archived(); }
  async order(..._args: unknown[]): Promise<any> { return this.archived(); }
  async approve(..._args: unknown[]): Promise<any> { return this.archived(); }
  async batch(..._args: unknown[]): Promise<any> { return this.archived(); }
  async seal(..._args: unknown[]): Promise<any> { return this.archived(); }
  async register(..._args: unknown[]): Promise<any> { return this.archived(); }
  async prepare(..._args: unknown[]): Promise<any> { return this.archived(); }
  async proof(..._args: unknown[]): Promise<any> { return this.archived(); }
  async submit(..._args: unknown[]): Promise<any> { return this.archived(); }
  async certify(..._args: unknown[]): Promise<any> { return this.archived(); }
  async readyForBooking(..._args: unknown[]): Promise<any> { return this.archived(); }
  async returnUnused(..._args: unknown[]): Promise<any> { return this.archived(); }
  async finalize(..._args: unknown[]): Promise<any> { return this.archived(); }
  async reconcile(..._args: unknown[]): Promise<any> { return this.archived(); }
  async recoverUnused(..._args: unknown[]): Promise<any> { return this.archived(); }
}
export const lessonPassService = new LessonPassService();
