import { test, expect } from 'bun:test';
import { adminCredentialSummary } from '../src/services/tutorIdentity/adminCredential';

test('admin credential summary allowlists references without leaking private proving material', () => {
  const entry = { id: 'identity', revoked: false, issuanceStage: 'issued', mintTransactionHash: 'mint',
    issuanceJson: JSON.stringify({ stage: 'issued', binding: { chainId: 42161, holder: 'wallet', collection: 'collection' },
      tokenId: '123', nativeProofTransactionHash: 'proof', witness: { secret: 'PRIVATE-WITNESS' }, signedAssessment: 'PRIVATE-ASSESSMENT' }),
    documentNumber: 'PRIVATE-DOCUMENT', issuanceLease: 'PRIVATE-LEASE' };
  const summary = adminCredentialSummary(entry, 'identity');
  expect(summary.current).toBe(true);
  expect(summary.tokenId).toBe('123');
  expect(summary.metadataUrl).toBeNull(); // Only persisted, public metadata unlocks a link.
  expect(JSON.stringify(summary)).not.toContain('PRIVATE-');
});

test('revoked historical NFTs remain distinguishable from a pending current submission', () => {
  const old = adminCredentialSummary({ id: 'old', revoked: true, issuanceStage: 'issued' }, 'new');
  expect(old.status).toBe('invalidated');
  expect(old.current).toBe(false);
  const pending = adminCredentialSummary({ id: 'new', revoked: false, credentialDisplayStatus: 'credential_awaiting_arbitrum_finality' }, 'new');
  expect(pending.current).toBe(true);
  expect(pending.status).toBe('credential_awaiting_arbitrum_finality');
  expect(pending.metadataUrl).toBeNull();
});
