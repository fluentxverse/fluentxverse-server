import assert from 'node:assert/strict';
import { Agent } from '@mastra/core/agent';

assert.equal(process.env.APPLICATION_RELEASE_PROBE, 'isolated-real-provider');
assert.equal(process.env.MEMGRAPH_URI, 'bolt://127.0.0.1:17706');
const original = Agent.prototype.generate;
const redact = (value: unknown) => Object.entries(process.env)
  .filter(([key, value]) => /KEY|SECRET|PASSWORD|TOKEN/.test(key) && value && value.length >= 8)
  .reduce((text, [, secret]) => text.replaceAll(secret!, '[redacted]'), String(value)).slice(0, 800);
// This preload is used only for synthetic, disposable-database provider diagnostics.
Agent.prototype.generate = async function (this: Agent, ...args: any[]) {
  try { return await original.apply(this, args as any); }
  catch (error: any) {
    console.error('[provider-probe]', JSON.stringify({ kind: error?.name, message: redact(error?.message),
      causeKind: error?.cause?.name, causeMessage: redact(error?.cause?.message) }));
    throw error;
  }
} as typeof original;
