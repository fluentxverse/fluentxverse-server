export const LEGACY_PROOF_RETIREMENT_REASON = 'Legacy proof keys are retired because their trusted setup is unsafe. Historical transactions are not valid certification evidence.';

export class LegacyProofRetiredError extends Error {
  readonly status = 410;
  constructor() { super(LEGACY_PROOF_RETIREMENT_REASON); this.name = 'LegacyProofRetiredError'; }
}

export function retiredCredentialStatus(props: Record<string, unknown>, now = Date.now()): 'retired' | 'expired' | 'revoked' {
  if (props.revoked === true || props.status === 'revoked') return 'revoked';
  const expiry = typeof props.expiresAt === 'string' ? Date.parse(props.expiresAt) : NaN;
  return Number.isFinite(expiry) && expiry <= now ? 'expired' : 'retired';
}
