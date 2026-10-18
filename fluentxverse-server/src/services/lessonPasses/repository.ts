import { getDriver } from '../../db/memgraph';
import { Group } from '@semaphore-protocol/group';
import { createHash } from 'node:crypto';
import { PassError } from './policy';
import { PASS_CATALOG, passScalar, type PassBatch, type PassAuthorization } from '../../shared/lessonPasses';

export interface StoredPass { id: string; studentId: string; commitment: string; status: string; batchId?: string; origin: 'purchase' | 'refund'; orderId?: string }
export interface StoredReservation extends PassAuthorization {
  studentId: string; passId: string; status: string; proofJson?: string; nullifier?: string; zkVerifyTx?: string;
  engineSubmissionId?: string; receiptJson?: string; transactionId?: string; bookingId?: string; finalAction?: 'settle' | 'return';
}
const props = (row: any, name = 'n') => row?.get(name)?.properties;
export class LessonPassRepository {
  private schema?: Promise<void>;
  async ready() {
    this.schema ??= (async () => {
      const db = getDriver().session();
      try {
        for (const label of ['LessonPassLock', 'LessonPassAccount', 'LessonPassOrder', 'LessonPassPayment', 'LessonPass', 'LessonPassKey', 'LessonPassBatch', 'LessonPassReservation', 'LessonPassNullifier'])
          await db.run(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.id IS UNIQUE`);
      } finally { await db.close(); }
    })().catch(error => { this.schema = undefined; throw error; });
    return this.schema;
  }
  async lock(tx: any) { await tx.run("MERGE (n:LessonPassLock {id:'ledger'}) SET n.version=coalesce(n.version,0)+1"); }
  async transaction<T>(action: (tx: any) => Promise<T>): Promise<T> {
    await this.ready(); const db = getDriver().session();
    try { return await db.executeWrite(async tx => { await this.lock(tx); return action(tx); }); } finally { await db.close(); }
  }
  async read(query: string, parameters: Record<string, any> = {}) {
    await this.ready(); const db = getDriver().session();
    try { return await db.run(query, parameters); } finally { await db.close(); }
  }
  async pass(id: string): Promise<StoredPass | null> { return props((await this.read('MATCH (n:LessonPass {id:$id}) RETURN n', { id })).records[0]) || null; }
  async reservation(id: string): Promise<StoredReservation | null> { return props((await this.read('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id })).records[0]) || null; }
  async batch(id: string): Promise<(PassBatch & { transactionId?: string }) | null> {
    const n = props((await this.read('MATCH (n:LessonPassBatch {id:$id}) RETURN n', { id })).records[0]);
    return n ? { ...n, members: JSON.parse(n.membersJson) } : null;
  }
  async ownedReservation(studentId: string, id: string) {
    const n = await this.reservation(id);
    if (!n || n.studentId !== studentId) throw new PassError('Pass reservation not found', 404);
    return n;
  }
  async saveVault(studentId: string, expectedVersion: number, envelope: string) {
    return this.transaction(async tx => {
      if (!(await tx.run('MATCH (s:Student {id:$studentId}) RETURN s.id', { studentId })).records.length) throw new PassError('Student not found', 404);
      const old = props((await tx.run('MERGE (n:LessonPassAccount {id:$studentId}) RETURN n', { studentId })).records[0]);
      if (old.envelope === envelope) return { version: Number(old.vaultVersion), envelope };
      if (Number(old.vaultVersion || 0) !== expectedVersion) throw new PassError('Recovery vault changed on another device; reload before saving', 409);
      await tx.run('MATCH (n:LessonPassAccount {id:$studentId}) SET n.vaultVersion=$version,n.envelope=$envelope', { studentId, version: expectedVersion + 1, envelope });
      return { version: expectedVersion + 1, envelope };
    });
  }
  async account(studentId: string) {
    const account = props((await this.read('MATCH (n:LessonPassAccount {id:$studentId}) RETURN n', { studentId })).records[0]);
    const passes = (await this.read("MATCH (n:LessonPass {studentId:$studentId}) WHERE n.status IN ['approved','available','authorizing'] RETURN n ORDER BY n.id LIMIT 512", { studentId })).records.map(row => props(row));
    const reservations = (await this.read("MATCH (n:LessonPassReservation {studentId:$studentId}) WHERE NOT n.status IN ['settled','returned','unused_expired'] RETURN n ORDER BY n.createdAt DESC LIMIT 512", { studentId })).records.map(row => props(row));
    const orders = (await this.read('MATCH (n:LessonPassOrder {studentId:$studentId}) RETURN n ORDER BY n.createdAt DESC LIMIT 50', { studentId })).records.map(row => props(row));
    return { vault: account?.envelope ? { version: Number(account.vaultVersion), envelope: account.envelope } : null, passes, reservations, orders };
  }
  async createOrder(studentId: string, id: string, sku: string, commitments: string[]) {
    const item = PASS_CATALOG.find(item => item.id === sku);
    if (!item || commitments.length !== item.quantity || new Set(commitments).size !== commitments.length) throw new PassError('Invalid lesson package');
    commitments.forEach(passScalar);
    return this.transaction(async tx => {
      const old = props((await tx.run('MATCH (n:LessonPassOrder {id:$id}) RETURN n', { id })).records[0]);
      if (old) {
        if (old.studentId !== studentId || old.sku !== sku || old.commitmentsJson !== JSON.stringify(commitments)) throw new PassError('Order reference already used', 409);
        return old;
      }
      if (!props((await tx.run('MATCH (n:LessonPassAccount {id:$studentId}) RETURN n', { studentId })).records[0])?.envelope)
        throw new PassError('Save the encrypted recovery vault before creating an order', 409);
      const outstanding = (await tx.run("MATCH (n:LessonPassOrder {studentId:$studentId,status:'payment_pending'}) RETURN n", { studentId })).records;
      if (outstanding.length >= 10) throw new PassError('Too many pending orders', 409);
      const active = (await tx.run("MATCH (n:LessonPass {studentId:$studentId}) WHERE n.status <> 'spent' RETURN n", { studentId })).records.length;
      if (active + outstanding.reduce((sum: number, row: any) => sum + Number(props(row).quantity), 0) + item.quantity > 512) throw new PassError('Pass account capacity reached', 409);
      for (const commitment of commitments) {
        if ((await tx.run('MATCH (n:LessonPassKey {id:$commitment}) RETURN n', { commitment })).records.length) throw new PassError('Pass key already used', 409);
        await tx.run('CREATE (:LessonPassKey {id:$commitment})', { commitment });
      }
      const order = { id, studentId, sku, quantity: item.quantity, cents: item.cents, commitmentsJson: JSON.stringify(commitments), status: 'payment_pending', createdAt: new Date().toISOString() };
      await tx.run('CREATE (n:LessonPassOrder) SET n += $order', { order }); return order;
    });
  }
  async approveOrder(id: string, reference: string, cents: number, operatorId: string) {
    const paymentId = createHash('sha256').update(reference).digest('hex');
    return this.transaction(async tx => {
      const order = props((await tx.run('MATCH (n:LessonPassOrder {id:$id}) RETURN n', { id })).records[0]);
      if (!order) throw new PassError('Order not found', 404);
      if (cents !== Number(order.cents)) throw new PassError('Settled payment amount does not match the order', 409);
      const previous = props((await tx.run('MATCH (n:LessonPassPayment {id:$paymentId}) RETURN n', { paymentId })).records[0]);
      if (previous && previous.orderId !== id) throw new PassError('Payment reference already credited', 409);
      if (order.status === 'approved') {
        if (!previous) throw new PassError('Approved payment reference is immutable', 409);
        return order;
      }
      if (order.status !== 'payment_pending') throw new PassError('Order is not awaiting payment', 409);
      await tx.run('CREATE (:LessonPassPayment {id:$paymentId,orderId:$id,reference:$reference,cents:$cents,operatorId:$operatorId,approvedAt:$now})',
        { paymentId, id, reference, cents, operatorId, now: new Date().toISOString() });
      const commitments: string[] = JSON.parse(order.commitmentsJson);
      for (const commitment of commitments) await tx.run(`CREATE (n:LessonPass {id:$passId,studentId:$studentId,commitment:$commitment,
        status:'approved',origin:'purchase',orderId:$id})`, { id, passId: `${id}:${commitment}`, studentId: order.studentId, commitment });
      await tx.run("MATCH (n:LessonPassOrder {id:$id}) SET n.status='approved'", { id }); return { ...order, status: 'approved' };
    });
  }
  async sealBatch(id: string, passIds: string[]) {
    return this.transaction(async tx => {
      const old = props((await tx.run('MATCH (n:LessonPassBatch {id:$id}) RETURN n', { id })).records[0]);
      if (old) {
        if (old.passIdsJson !== JSON.stringify(passIds)) throw new PassError('Pass batch is immutable', 409);
        return { ...old, members: JSON.parse(old.membersJson) };
      }
      const rows = (await tx.run('MATCH (n:LessonPass) WHERE n.id IN $ids RETURN n', { ids: passIds })).records.map((r: any) => props(r));
      if (rows.length !== passIds.length || rows.some((n: StoredPass) => n.status !== 'approved' || n.batchId)) throw new PassError('Only unbatched approved passes can be sealed', 409);
      const members = rows.map((n: StoredPass) => n.commitment).sort((a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : 1);
      const batch = { id, root: new Group(members.map(BigInt)).root.toString(), membersJson: JSON.stringify(members), passIdsJson: JSON.stringify(passIds), status: 'sealed' };
      await tx.run('CREATE (n:LessonPassBatch) SET n += $batch', { batch });
      await tx.run('MATCH (n:LessonPass) WHERE n.id IN $ids SET n.batchId=$id', { ids: passIds, id });
      return { ...batch, members };
    });
  }
  async activateBatch(id: string) {
    await this.transaction(async tx => {
      await tx.run("MATCH (n:LessonPassBatch {id:$id}) SET n.status='active'", { id });
      await tx.run("MATCH (n:LessonPass {batchId:$id,status:'approved'}) SET n.status='available'", { id });
    });
  }
  async authorize(studentId: string, passId: string, authorization: PassAuthorization) {
    return this.transaction(async tx => {
      const old = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id: authorization.id })).records[0]);
      if (old) {
        if (old.studentId !== studentId || old.passId !== passId || old.refundCommitment !== authorization.refundCommitment || Number(old.deadline) !== authorization.deadline)
          throw new PassError('Reservation reference already used', 409);
        return old;
      }
      const pass = props((await tx.run('MATCH (n:LessonPass {id:$passId,studentId:$studentId}) RETURN n', { passId, studentId })).records[0]);
      if (!pass || pass.status !== 'available') throw new PassError('Pass is not available', 409);
      const batch = props((await tx.run('MATCH (n:LessonPassBatch {id:$id}) RETURN n', { id: pass.batchId })).records[0]);
      if (batch?.status !== 'active' || batch.root !== authorization.root) throw new PassError('Pass batch is not active', 409);
      if ((await tx.run('MATCH (n:LessonPassKey {id:$id}) RETURN n', { id: authorization.refundCommitment })).records.length) throw new PassError('Replacement pass key already used', 409);
      await tx.run('CREATE (:LessonPassKey {id:$id})', { id: authorization.refundCommitment });
      const reservation = { ...authorization, studentId, passId, status: 'prepared', createdAt: new Date().toISOString() };
      await tx.run('CREATE (n:LessonPassReservation) SET n += $reservation', { reservation });
      await tx.run("MATCH (n:LessonPass {id:$passId}) SET n.status='authorizing'", { passId });
      return reservation;
    });
  }
  async saveProof(id: string, proofJson: string, nullifier: string) {
    return this.transaction(async tx => {
      const n = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id })).records[0]);
      if (!n) throw new PassError('Reservation not found', 404);
      if (n.proofJson) { if (JSON.parse(n.proofJson).message !== JSON.parse(proofJson).message || n.nullifier !== nullifier) throw new PassError('Pass proof is immutable', 409); return n; }
      if (n.status !== 'prepared') throw new PassError('Reservation is not awaiting its proof', 409);
      const used = props((await tx.run('MATCH (n:LessonPassNullifier {id:$nullifier}) RETURN n', { nullifier })).records[0]);
      if (used) {
        const prior = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id: used.reservationId })).records[0]);
        if (prior?.status !== 'unused_expired' || prior.passId !== n.passId) throw new PassError('Pass entitlement already used', 409);
        await tx.run('MATCH (n:LessonPassNullifier {id:$nullifier}) SET n.reservationId=$id', { nullifier, id });
      } else await tx.run('CREATE (:LessonPassNullifier {id:$nullifier,reservationId:$id})', { nullifier, id });
      await tx.run("MATCH (n:LessonPassReservation {id:$id}) SET n.proofJson=$proofJson,n.nullifier=$nullifier,n.status='proof_ready'", { id, proofJson, nullifier });
      return { ...n, proofJson, nullifier, status: 'proof_ready' };
    });
  }
  async claim(label: 'LessonPassBatch' | 'LessonPassReservation', id: string, allowed: string[], status: string) {
    return this.transaction(async tx => props((await tx.run(`MATCH (n:${label} {id:$id}) WHERE n.status IN $allowed SET n.status=$status RETURN n`, { id, allowed, status })).records[0]) || null);
  }
  async patch(label: 'LessonPassBatch' | 'LessonPassReservation', id: string, values: Record<string, string>) {
    await this.transaction(tx => tx.run(`MATCH (n:${label} {id:$id}) SET n += $values`, { id, values }));
  }
  async saveReceipt(id: string, receiptJson: string) {
    await this.transaction(async tx => {
      const n = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id })).records[0]);
      if (n?.receiptJson && n.receiptJson !== receiptJson) throw new PassError('Receipt is immutable', 409);
      await tx.run('MATCH (n:LessonPassReservation {id:$id}) SET n.receiptJson=$receiptJson', { id, receiptJson });
    });
  }
  async readyReservation(id: string) {
    await this.transaction(async tx => {
      const n = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id })).records[0]);
      if (!n || !['certifying', 'awaiting_horizen'].includes(n.status)) return;
      await tx.run("MATCH (n:LessonPassReservation {id:$id}) SET n.status='ready'", { id });
      await tx.run("MATCH (n:LessonPass {id:$id}) SET n.status='reserved'", { id: n.passId });
    });
  }
  async claimForBooking(tx: any, studentId: string, id: string, bookingId: string) {
    await this.lock(tx);
    const rows = await tx.run("MATCH (n:LessonPassReservation {id:$id,studentId:$studentId,status:'ready'}) WHERE n.bookingId IS NULL SET n.bookingId=$bookingId,n.status='booked' RETURN n", { id, studentId, bookingId });
    if (!rows.records.length) throw new PassError('Pass reservation has already been used for a booking', 409);
  }
  async booking(id: string) {
    return props((await this.read('MATCH (n:Booking {bookingId:$id}) RETURN n', { id })).records[0]) || null;
  }
  async expireUnused(id: string, expectedStatus: string) {
    return this.transaction(async tx => {
      const n = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id })).records[0]);
      if (!n || n.status !== expectedStatus || n.bookingId) throw new PassError('Reservation changed; reload', 409);
      await tx.run("MATCH (n:LessonPassReservation {id:$id}) SET n.status='unused_expired'", { id });
      await tx.run("MATCH (n:LessonPass {id:$id,status:'authorizing'}) SET n.status='available'", { id: n.passId });
      return { status: 'unused_expired' };
    });
  }
  async beginFinalization(id: string, choose: (reservation: StoredReservation, booking: any) => 'settle' | 'return') {
    return this.transaction(async tx => {
      const n = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id })).records[0]) as StoredReservation;
      if (!n || !['booked','return_requested','finalizing','settled','returned'].includes(n.status)) throw new PassError('Reservation cannot be finalized', 409);
      if (n.status === 'finalizing' || ['settled','returned'].includes(n.status)) {
        if (!n.finalAction) throw new PassError('Finalization needs operator reconciliation', 409);
        return { reservation: n, fresh: false };
      }
      const booking = n.bookingId ? props((await tx.run('MATCH (n:Booking {bookingId:$id}) SET n.passFinalizationVersion=coalesce(n.passFinalizationVersion,0)+1 RETURN n', { id: n.bookingId })).records[0]) : null;
      const finalAction = choose(n, booking);
      await tx.run("MATCH (n:LessonPassReservation {id:$id}) SET n.status='finalizing',n.finalAction=$finalAction", { id, finalAction });
      return { reservation: { ...n, status: 'finalizing', finalAction }, fresh: true };
    });
  }
  async queue() {
    const result: Record<string, any[]> = {};
    for (const label of ['LessonPassOrder','LessonPass','LessonPassBatch','LessonPassReservation'])
      result[label] = (await this.read(`MATCH (n:${label}) WHERE NOT n.status IN ['spent','settled','returned','unused_expired'] RETURN n ORDER BY n.id LIMIT 512`)).records.map(row => {
        const { proofJson, receiptJson, commitmentsJson, membersJson, passIdsJson, ...n } = props(row); return n;
      });
    return result;
  }
  async finalize(id: string, action: 'settle' | 'return') {
    await this.transaction(async tx => {
      const n = props((await tx.run('MATCH (n:LessonPassReservation {id:$id}) RETURN n', { id })).records[0]);
      if (!n || n.finalAction !== action) throw new PassError('Unexpected pass finalization', 409);
      if (n.status === (action === 'return' ? 'returned' : 'settled')) return;
      if (n.status !== 'finalizing') throw new PassError('Pass finalization is not pending', 409);
      if (action === 'return') {
        await tx.run(`CREATE (:LessonPass {id:$passId,studentId:$studentId,commitment:$commitment,status:'approved',origin:'refund'})`,
          { passId: `refund:${id}`, studentId: n.studentId, commitment: n.refundCommitment });
      }
      await tx.run('MATCH (n:LessonPassReservation {id:$id}) SET n.status=$status', { id, status: action === 'return' ? 'returned' : 'settled' });
      await tx.run("MATCH (n:LessonPass {id:$id}) SET n.status='spent'", { id: n.passId });
      if (n.bookingId) await tx.run('MATCH (n:Booking {bookingId:$bookingId}) SET n.refundStatus=$refundStatus,n.refunded=$refunded',
        { bookingId: n.bookingId, refundStatus: action === 'return' ? 'pass_issued' : 'not_required', refunded: action === 'return' });
    });
  }
}
