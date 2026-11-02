import { expect, test } from 'bun:test';
import { MAINNET_RECEIPT_DESTINATIONS, assertHorizenReceiptConfig, finalizedDestinationReceipt, horizenVerificationNetwork, HorizenReceiptReader } from '../src/services/proof.services/horizenReceipt';

test('all offered mainnets pin their own domain and official bridge', () => {
  for (const destination of MAINNET_RECEIPT_DESTINATIONS) {
    expect(horizenVerificationNetwork(destination.chainId)).toBe('zkVerify');
    expect(() => assertHorizenReceiptConfig({ ...destination, rpcUrl: 'https://rpc.example' })).not.toThrow();
    expect(() => assertHorizenReceiptConfig({ ...destination, domainId: 999, rpcUrl: 'https://rpc.example' })).toThrow();
  }
});
test('an Arbitrum receipt cannot be replaced by a Base receipt or a mismatched chain', async () => {
  const receipt = { chainId: 42161, domainId: 10, verifiedOnZkVerify: true, verifiedOnArbitrum: true, status: 'arbitrum_finalized' };
  expect(finalizedDestinationReceipt(receipt, 42161)).toBe(true);
  expect(finalizedDestinationReceipt(receipt, 8453)).toBe(false);
  expect(finalizedDestinationReceipt({ ...receipt, domainId: 2 }, 42161)).toBe(false);
  expect(finalizedDestinationReceipt({ ...receipt, verifiedOnArbitrum: false, verifiedOnBase: true, status: 'base_finalized' }, 42161)).toBe(false);
  const reader = new HorizenReceiptReader(() => ({ getChainId: async () => 8453 } as any));
  await expect(reader.check({ chainId: 42161, domainId: 10, bridge: MAINNET_RECEIPT_DESTINATIONS[1].bridge, rpcUrl: 'https://rpc.example' })).rejects.toThrow('Wrong');
});
