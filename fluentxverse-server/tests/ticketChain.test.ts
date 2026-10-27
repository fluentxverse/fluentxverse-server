import { expect, test } from 'bun:test';
import { selectTicketChain } from '../src/config/ticketChain';

test('Base mainnet and explicit test networks are selected without RPC chain confusion', () => {
  expect(selectTicketChain(84532).name).toBe('Base Sepolia');
  expect(selectTicketChain(421614).name).toBe('Arbitrum Sepolia');
  expect(selectTicketChain(8453).name).toBe('Base');
  expect(() => selectTicketChain(26514)).toThrow('Unsupported ticket chain');
});
