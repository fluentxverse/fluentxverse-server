import { expect, test } from 'bun:test';
import { selectTicketChain } from '../src/config/ticketChain';

test('Base Sepolia is selected explicitly and legacy Arbitrum remains explicit', () => {
  expect(selectTicketChain(84532).name).toBe('Base Sepolia');
  expect(selectTicketChain(421614).name).toBe('Arbitrum Sepolia');
  expect(() => selectTicketChain(8453)).toThrow('Unsupported ticket chain');
});
