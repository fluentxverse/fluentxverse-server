import { encodeAbiParameters, keccak256, toHex, type Hex } from 'viem';

export const PASS_PROTOCOL = 'fluentxverse.lesson-pass.v1';
export const PASS_DEPTH = 8;
export const PASS_MAX_BATCH = 256;
export const PASS_CATALOG = [{ id: 'basic-1', quantity: 1, cents: 600 }, { id: 'basic-30', quantity: 30, cents: 15000 }] as const;
export const PASS_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export interface PassAuthorization { id: Hex; root: string; refundCommitment: string; deadline: number }
export interface PassArtifacts { wasmUrl: string; zkeyUrl: string; wasmSha256: string; zkeySha256: string }
export interface PassBatch { id: Hex; root: string; members: string[]; status: string }
export interface PassItem { id: string; commitment: string; status: string; batchId?: Hex; origin: 'purchase' | 'refund' }
export interface PassReservation extends PassAuthorization { passId: string; status: string; bookingId?: string }
export interface PassAccount { passes: PassItem[]; reservations: PassReservation[]; orders: Array<{ id: string; quantity: number; cents: number; status: string }>; vault: { version: number; envelope: string } | null }
export interface PassMode { mode: 'legacy_erc1155' | 'private_passes' | 'trial'; trialLessonLimit?: number; chainId?: number; contract?: string; artifacts?: PassArtifacts }

export function passScalar(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,76}$/.test(value) || BigInt(value) >= PASS_FIELD) throw new Error('Invalid pass commitment');
  return value;
}
export function passId(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[a-f0-9]{64}$/.test(value) || BigInt(value) === 0n) throw new Error('Invalid pass reference');
  return value as Hex;
}
export function passScope(chainId: number, contract: string): string {
  return (BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [keccak256(toHex(PASS_PROTOCOL)), BigInt(chainId), contract as `0x${string}`]))) >> 8n).toString();
}
export function passMessage(authorization: PassAuthorization): string {
  passId(authorization.id); passScalar(authorization.root); passScalar(authorization.refundCommitment);
  if (!Number.isSafeInteger(authorization.deadline) || authorization.deadline <= 0) throw new Error('Invalid pass deadline');
  return BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' }],
    [keccak256(toHex(`${PASS_PROTOCOL}:reserve`)), authorization.id, BigInt(authorization.root), BigInt(authorization.refundCommitment), BigInt(authorization.deadline)]))).toString();
}
