import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { AnonymousReviewTally } from '../src/services/anonymousReviews/tally';
import { requireAnonymousReviews } from '../src/services/anonymousReviews/policy';
import { tallyConfig } from '../src/services/anonymousReviews/tallyPolicy';

// Trusted deployment-host tooling; no HTTP proxy timeout and no private witness output.
let connected = false;
try {
  for (const file of ['config/anonymous-reviews.env', 'config/anonymous-tally.env'])
    if (existsSync(file)) Object.assign(process.env, parse(readFileSync(file, 'utf8')));
  requireAnonymousReviews(); tallyConfig();
  const [phase, id, receiptFile] = process.argv.slice(2).filter(value => value !== '--apply');
  if (!id || !/^0x[a-f0-9]{64}$/.test(id) || !['status', 'prepare', 'prove', 'submit', 'certify', 'publish'].includes(phase || '')) throw new Error('Invalid operator arguments');
  if (phase !== 'status' && !process.argv.includes('--apply')) throw new Error('Mutations require --apply');
  if (!process.env.MEMGRAPH_URI || !process.env.MEMGRAPH_PASSWORD) throw new Error('Authorized database configuration is required');
  await initDriver(process.env.MEMGRAPH_URI, process.env.MEMGRAPH_USERNAME || process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD, 1); connected = true;
  const tally = new AnonymousReviewTally();
  const result = phase === 'status' ? await tally.repository.tally(id).then(record => ({ status: record?.status || 'not_prepared',
    zkVerifyTx: record?.zkVerifyTx || null, engineSubmissionId: record?.engineSubmissionId || null }))
    : phase === 'certify' ? await tally.certify(id, JSON.parse(readFileSync(receiptFile || '', 'utf8')))
    : await tally[phase as 'prepare' | 'prove' | 'submit' | 'publish'](id);
  console.log(JSON.stringify(result));
} catch { console.error('Tally operator action failed; review configuration or reconcile the recorded operation before retrying'); process.exitCode = 1; }
finally { if (connected) await closeDriver(); }
