import { test, expect } from 'bun:test';
import { registryConfig, registryCommitment, registryDisputeEnrollment } from '../src/services/lessonRegistry/outbox';
import production from '../../shared/lessonRegistryDeployment.json';

test('registry enrollment is opt-in, deployment-bound, and does not adopt legacy bookings', () => {
  const names = ['LESSON_REGISTRY_CAPTURE', 'LESSON_REGISTRY_CHAIN_ID', 'LESSON_REGISTRY_CONTRACT', 'LESSON_REGISTRY_PRODUCTION'] as const;
  const original = names.map(name => process.env[name]);
  try {
    delete process.env.LESSON_REGISTRY_CAPTURE;
    expect(registryConfig()).toBeNull();
    expect(registryDisputeEnrollment({ bookingId: 'legacy' })).toBeNull();
    process.env.LESSON_REGISTRY_CAPTURE = 'true';
    process.env.LESSON_REGISTRY_CHAIN_ID = '42161';
    process.env.LESSON_REGISTRY_CONTRACT = '0x' + '1'.repeat(40);
    expect(() => registryConfig()).toThrow(/Sepolia/);
    process.env.LESSON_REGISTRY_CONTRACT = production.contract;
    delete process.env.LESSON_REGISTRY_PRODUCTION;
    expect(() => registryConfig()).toThrow(/production/);
    process.env.LESSON_REGISTRY_PRODUCTION = production.epoch;
    expect(registryConfig()?.chainId).toBe(42161);
    process.env.LESSON_REGISTRY_CONTRACT = '0x' + '1'.repeat(40);
    expect(() => registryConfig()).toThrow(/production/);
    process.env.LESSON_REGISTRY_CHAIN_ID = '421614';
    const binding = registryConfig()!;
    expect(binding.chainId).toBe(421614);
    expect(() => registryDisputeEnrollment({ registryVersion: 1, registryKey: '0x' + 'a'.repeat(64), registryBinding: 'different' })).toThrow(/changed/);
    const enrolled = registryDisputeEnrollment({ registryVersion: 1, registryKey: '0x' + 'a'.repeat(64), registryBinding: binding.binding, registryRevision: 2 });
    expect(enrolled?.registryBookingRevision).toBe(2);
    expect(enrolled?.chainKey).toBe('0x' + 'a'.repeat(64));
  } finally {
    names.forEach((name, i) => { if (original[i] === undefined) delete process.env[name]; else process.env[name] = original[i]; });
  }
});

test('private receipts cannot be replayed with different evidence, salt, deployment, key, revision or evidence type', () => {
  const binding = { chainId: 421614, contract: '0x' + '1'.repeat(40) }, key = '0x' + 'a'.repeat(64), salt = 'b'.repeat(64);
  const commit = (b = binding, k = key, revision = 1, type = 'FXV_BOOKING_RECEIPT_V1', bytes = '["private fixture"]', s = salt) =>
    registryCommitment(b, k, revision, type, bytes, s);
  const original = commit();
  expect(commit()).toBe(original);
  for (const changed of [commit({ ...binding, chainId: 42161 }), commit({ ...binding, contract: '0x' + '2'.repeat(40) }),
    commit(binding, '0x' + 'c'.repeat(64)), commit(binding, key, 2), commit(binding, key, 1, 'FXV_BOOKING_REASON_V1'),
    commit(binding, key, 1, undefined, '["tampered fixture"]'), commit(binding, key, 1, undefined, undefined, 'c'.repeat(64))]) {
    expect(changed).not.toBe(original);
  }
  expect(() => commit(binding, key, 1, undefined, undefined, 'short')).toThrow(/binding/);
});
