import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, chmodSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { zkVerifySession } from 'zkverifyjs';
import { createPublicClient, http, parseAbi, type Hex } from 'viem';
import { parseTallyProof, tallyStatement } from '../src/services/anonymousReviews/tallyPolicy';
import { ReviewTallySnapshotSource } from '../src/services/anonymousReviews/tallySnapshot';
import { validateReceipt, type ReviewReceipt } from '../src/services/anonymousReviews/chain';
import { tallyFixture } from '../tests/reviewTally.fixture';
import { isTallyReceiptPublication, validateTallyReleaseEvidence } from './review-tally-release-policy';

// Host-only release tooling. Private state never leaves the ignored deployment directory.
const root = fileURLToPath(new URL('../', import.meta.url));
const engineRoot = process.env.GMR_ENGINE_WORKSPACE || fileURLToPath(new URL('../../../budol/gmr-engine/', import.meta.url));
const zkRoot = fileURLToPath(new URL('../../zk/review-tally/', import.meta.url));
const directory = `${root}.deployment/review-tally/`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const stateFile = `${directory}state.json`, configFile = `${root}config/anonymous-tally.env`;
let state: any = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { version: 1, synthetic: true };
const [phase = 'inspect', argument] = process.argv.slice(2).filter(value => value !== '--apply');
const apply = process.argv.includes('--apply');
let lock: number | undefined;
const write = (file: string, value: string) => {
  writeFileSync(`${file}.tmp`, value, { mode: 0o600 }); chmodSync(`${file}.tmp`, 0o600); renameSync(`${file}.tmp`, file);
};
const save = () => write(stateFile, JSON.stringify(state, null, 2));
const mutate = () => {
  if (!apply) throw new Error('Mutations require --apply');
  if (lock === undefined) {
    try { lock = openSync(`${directory}release.lock`, 'wx', 0o600); }
    catch { throw new Error('Another release operation needs reconciliation before proceeding'); }
    writeFileSync(lock, JSON.stringify({ pid: process.pid, phase, startedAt: new Date().toISOString() }));
    // Reload only after acquiring ownership; another operator may have completed since startup.
    state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { version: 1, synthetic: true };
  }
};
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const docker = (args: string[], input?: string) => execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 });
const inspect = (name: string) => JSON.parse(docker(['inspect', name]))[0];
const environment = (name: string) => Object.fromEntries(inspect(name).Config.Env.map((value: string) => {
  const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)];
}));
function sourcePin() {
  const hash = createHash('sha256');
  const visit = (path: string, prefix = '') => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === 'target' || item.name.startsWith('.')) continue;
      const relative = `${prefix}${item.name}`;
      if (item.isDirectory()) visit(`${path}/${item.name}`, `${relative}/`);
      else if (item.isFile()) { hash.update(relative); hash.update('\0'); hash.update(readFileSync(`${path}/${item.name}`)); }
      else throw new Error('Unsupported artifact source entry');
    }
  };
  visit(zkRoot); return hash.digest('hex');
}
function approved() {
  if (!state.image || state.sourceSha256 !== sourcePin()) throw new Error('Prover sources need approval');
  if (inspect(state.image).Id !== state.dockerImageId) throw new Error('Approved prover image changed');
}
function config() {
  approved();
  const values = parse(readFileSync(configFile, 'utf8'));
  if (values.ANONYMOUS_REVIEW_TALLY_IMAGE_ID !== state.imageId || values.ANONYMOUS_REVIEW_TALLY_PROVER_SHA256 !== state.binarySha256)
    throw new Error('Tally artifact configuration changed');
  if (!/^[a-f0-9]{64}$/.test(values.ANONYMOUS_REVIEW_TALLY_PROVER_TOKEN || '')) throw new Error('Private prover token is invalid');
  Object.assign(process.env, parse(readFileSync(`${root}config/anonymous-reviews.env`, 'utf8')), values);
  return values;
}
async function engine(path: string, body?: unknown, headers: Record<string, string> = {}, method?: string, timeout = 30_000) {
  const response = await fetch(`http://127.0.0.1:8090${path}`, { method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Engine operation returned HTTP ${response.status}`);
  return response.json() as Promise<any>;
}
async function prover(mode: 'metadata' | 'verify' | 'prove', input: unknown = {}) {
  const values = config();
  const container = inspect('fluentxverse-server-review-tally-prover-1');
  if (container.Image !== state.dockerImageId || container.Config.User !== 'bun' || !container.HostConfig.ReadonlyRootfs
    || Object.keys(container.HostConfig.PortBindings || {}).length || container.HostConfig.Memory !== 12 * 1024 ** 3
    || container.HostConfig.NanoCpus !== 2_000_000_000 || !container.HostConfig.CapDrop?.includes('ALL')
    || !container.HostConfig.SecurityOpt?.includes('no-new-privileges:true')) throw new Error('Private prover isolation differs from release policy');
  const address = Object.values(container.NetworkSettings.Networks).map((value: any) => value.IPAddress).find(Boolean);
  if (!address) throw new Error('Private prover is not running');
  const response = await fetch(`http://${address}:8092/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json',
    'X-Tally-Prover-Key': values.ANONYMOUS_REVIEW_TALLY_PROVER_TOKEN! }, body: JSON.stringify(input), signal: AbortSignal.timeout(mode === 'prove' ? 1_800_000 : 60_000) });
  if (!response.ok) throw new Error(`Prover operation returned HTTP ${response.status}`);
  const result = await response.json() as any;
  if (mode === 'metadata' && (result.imageId !== state.imageId || result.binarySha256 !== state.binarySha256 || result.version !== 'V2_3'))
    throw new Error('Running prover pins differ');
  return result;
}
const output = (value: unknown) => console.log(JSON.stringify(value));
async function checkBridgeReceipt(receipt: ReviewReceipt) {
  validateReceipt(receipt);
  if (receipt.aggregationId !== String(state.submission.aggregationId)) throw new Error('Unexpected receipt aggregation');
  const client = createPublicClient({ transport: http(process.env.ANONYMOUS_REVIEWS_RPC_URL!, { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== 2651420) throw new Error('Unsupported receipt destination chain');
  const verified = await client.readContract({ address: process.env.ANONYMOUS_REVIEWS_BRIDGE as Hex,
    abi: parseAbi(['function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns(bool)']),
    functionName: 'verifyProofAggregation', args: [175n, BigInt(receipt.aggregationId), state.statement, receipt.merklePath as Hex[], BigInt(receipt.leafCount), BigInt(receipt.index)], blockTag: 'finalized' });
  state.receipt = receipt; state.finalizedBridgeVerified = verified; save();
  output({ synthetic: true, status: verified ? 'bridge_verified' : 'awaiting_horizen_relay', aggregationId: receipt.aggregationId });
}

try {
  if (phase === 'approve') {
    mutate();
    const image = argument || 'fluentxverse-review-tally:activation';
    const metadata = JSON.parse(docker(['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', '/app/review-tally-host', image, 'metadata']));
    const binarySha256 = docker(['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'sha256sum', image, '/app/review-tally-host']).split(' ')[0]!;
    if (!/^0x[a-f0-9]{64}$/.test(metadata.imageId) || !/^[a-f0-9]{64}$/.test(binarySha256) || metadata.version !== 'V2_3') throw new Error('Invalid prover metadata');
    if (state.submission && state.imageId !== metadata.imageId) throw new Error('Submitted release cannot change programs');
    Object.assign(state, { image, dockerImageId: inspect(image).Id, imageId: metadata.imageId, elfSha256: metadata.elfSha256,
      binarySha256, sourceSha256: sourcePin(), approvedAt: new Date().toISOString() }); save();
    output({ artifactApproved: true, imageId: state.imageId, binarySha256, dockerImageId: state.dockerImageId });
  } else if (phase === 'project') {
    mutate(); approved();
    const env = environment('budol-gmr-engine-1');
    const response = await fetch('http://127.0.0.1:8090/dashboard/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env.GMR_ENGINE_OWNER_USERNAME, password: env.GMR_ENGINE_OWNER_PASSWORD }) });
    if (!response.ok) throw new Error('Engine owner authentication failed');
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Engine owner authentication failed');
    const owner = { Cookie: cookie }, admin = { 'X-GMR-Engine-Admin-Key': env.GMR_ENGINE_ADMIN_API_KEY };
    const projects = (await engine('/dashboard/projects', undefined, owner)).projects.filter((project: any) => project.name === 'FluentXVerse Review Tallies');
    if (projects.length > 1) throw new Error('Multiple tally projects need reconciliation');
    const project = projects[0] || (await engine('/dashboard/projects', { name: 'FluentXVerse Review Tallies', environment: 'development',
      allowedChains: [2651420], allowedContracts: ['0x0000000000000000000000000000000000000001'], gasFreeEnabled: false, rateLimitPerMinute: 6 }, owner)).project;
    if (state.projectId && state.projectId !== project.id) throw new Error('Saved tally project differs');
    state.projectId = project.id; save();
    await engine(`/dashboard/projects/${project.id}/settings`, { ...project, allowedChains: [2651420],
      allowedContracts: ['0x0000000000000000000000000000000000000001'], gasFreeEnabled: false, rateLimitPerMinute: 6 }, owner, 'PUT');
    const policyFile = `${engineRoot}/config/zkverify-projects.json`, policies = JSON.parse(readFileSync(policyFile, 'utf8'));
    policies[project.id] = { proofSystem: 'risc0', version: 'V2_3', domainId: 175, vkHash: state.imageId, publicInputs: 31, methods: [] };
    write(policyFile, JSON.stringify(policies, null, 2) + '\n');
    // Keep the mounted policy readable by the runtime without exposing the generated API key.
    chmodSync(policyFile, 0o644);
    if (!state.apiKey) {
      const result = await engine(`/admin/apps/${project.id}/api-keys`, { name: 'Private tally submission',
        scopes: ['contracts:read', 'contracts:write', 'transactions:read'], allowedOrigins: [], allowedIps: [] }, admin);
      state.apiKey = result.plaintext; state.apiKeyId = result.key.id; save();
    }
    output({ projectId: state.projectId, dedicatedProject: true, contractWritesAllowed: false });
  } else if (phase === 'configure') {
    mutate(); approved(); if (!state.apiKey) throw new Error('Create the dedicated tally project first');
    const old = existsSync(configFile) ? parse(readFileSync(configFile, 'utf8')) : {};
    if (old.ANONYMOUS_REVIEW_TALLY_ENABLED === 'true') throw new Error('Do not overwrite an enabled release');
    const values = { ANONYMOUS_REVIEW_TALLY_ENABLED: 'false', ANONYMOUS_REVIEW_TALLY_MAX_REVIEWS: '8', ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK: '30173321',
      ANONYMOUS_REVIEW_TALLY_IMAGE_ID: state.imageId, ANONYMOUS_REVIEW_TALLY_PROVER_SHA256: state.binarySha256,
      ANONYMOUS_REVIEW_TALLY_PROVER_URL: 'http://review-tally-prover:8092', ANONYMOUS_REVIEW_TALLY_PROVER_TOKEN: old.ANONYMOUS_REVIEW_TALLY_PROVER_TOKEN || randomBytes(32).toString('hex'),
      GMR_ANONYMOUS_TALLY_ENGINE_API_BASE: 'http://host.docker.internal:8090', GMR_ANONYMOUS_TALLY_ENGINE_API_KEY: state.apiKey };
    write(configFile, '# Private testnet tally release configuration.\n' + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
    output({ configured: true, enabled: false, projectId: state.projectId });
  } else if (phase === 'check') {
    config(); await prover('metadata');
    const auth = await engine('/v1/auth/me', undefined, { 'X-GMR-Engine-Key': state.apiKey });
    if (auth.app.id !== state.projectId) throw new Error('Dedicated Engine key differs');
    const policies = JSON.parse(readFileSync(`${engineRoot}/config/zkverify-projects.json`, 'utf8'));
    if (JSON.stringify(policies[state.projectId]) !== JSON.stringify({ proofSystem: 'risc0', version: 'V2_3', domainId: 175,
      vkHash: state.imageId, publicInputs: 31, methods: [] })) throw new Error('Engine project policy differs');
    const denied = await fetch('http://127.0.0.1:8090/v1/zkverify/proofs', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-GMR-Engine-Key': state.apiKey }, body: JSON.stringify({ proofSystem: 'risc0', version: 'V3_0',
      vk: state.imageId, publicSignals: `0x${'0'.repeat(1984)}`, proof: '0x00', expectedNetwork: 'Volta', domainId: 175 }), signal: AbortSignal.timeout(10_000) });
    const denial = await denied.json() as any;
    if (denied.status !== 502 || !String(denial.error).includes('project verification policy')) throw new Error('Engine project policy is not enforced at runtime');
    output({ configured: true, privateProverVerified: true, projectId: state.projectId, imageId: state.imageId, enabled: process.env.ANONYMOUS_REVIEW_TALLY_ENABLED === 'true' });
  } else if (phase === 'smoke-prepare') {
    mutate(); config(); await prover('metadata');
    if (!existsSync(`${directory}smoke-proof.json`)) {
      const existing = `${zkRoot}target/synthetic-proof.json`;
      let proof;
      if (existsSync(existing) && JSON.parse(readFileSync(existing, 'utf8')).vk === state.imageId) {
        const { synthetic, ...value } = JSON.parse(readFileSync(existing, 'utf8'));
        if (synthetic !== true) throw new Error('Only explicit synthetic fixtures are allowed'); proof = parseTallyProof(value);
      } else proof = parseTallyProof(await prover('prove', tallyFixture().witness));
      if (proof.vk !== state.imageId || (await prover('verify', proof)).verified !== true) throw new Error('Synthetic proof verification failed');
      write(`${directory}smoke-proof.json`, JSON.stringify(proof));
    }
    const proof = parseTallyProof(JSON.parse(readFileSync(`${directory}smoke-proof.json`, 'utf8')));
    if (proof.vk !== state.imageId || (await prover('verify', proof)).verified !== true) throw new Error('Synthetic proof verification failed');
    state.statement = tallyStatement(state.imageId, proof.publicSignals); state.proofSha256 = digest(JSON.stringify(proof)); save();
    output({ synthetic: true, localVerified: true, statement: state.statement, proofBytes: (proof.proof.length - 2) / 2 });
  } else if (phase === 'smoke-submit') {
    mutate(); config();
    if (!state.submission) {
      if (state.submitting) throw new Error('Uncertain submission needs Engine reconciliation; do not retry');
      const proof = parseTallyProof(JSON.parse(readFileSync(`${directory}smoke-proof.json`, 'utf8')));
      if (digest(JSON.stringify(proof)) !== state.proofSha256 || tallyStatement(state.imageId, proof.publicSignals) !== state.statement
        || (await prover('verify', proof)).verified !== true) throw new Error('Approved synthetic proof differs');
      const account = await engine('/v1/zkverify/account', undefined, { 'X-GMR-Engine-Key': state.apiKey }, undefined, 90_000);
      if (account.network !== 'Volta' || !account.account?.address) throw new Error('Engine project has no Volta submission account');
      const session = await zkVerifySession.start().Volta().readOnly();
      try {
        const api = session.api as any, decimals = api.registry.chainDecimals[0];
        if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Unsupported testnet fee units');
        const extrinsic = api.tx.settlementRisc0Pallet.submitProof({ Vk: state.imageId }, { V2_3: proof.proof }, proof.publicSignals, 175);
        const fee = BigInt((await extrinsic.paymentInfo(account.account.address)).partialFee.toString());
        const balance = BigInt((await api.query.system.account(account.account.address)).data.free.toString());
        const ceiling = 10n * 10n ** BigInt(decimals);
        state.feePreflight = { fee: fee.toString(), balance: balance.toString(), decimals, ceiling: ceiling.toString() }; save();
        if (fee > ceiling || balance < fee + BigInt(api.consts.balances.existentialDeposit.toString())) throw new Error('Testnet fee or balance exceeds release policy');
        state.estimatedFee = fee.toString(); save();
      } finally { await session.close(); }
      state.submitting = true; save();
      const { submission } = await engine('/v1/zkverify/proofs', { proof: proof.proof, publicSignals: proof.publicSignals, vk: state.imageId,
        domainId: 175, proofSystem: 'risc0', version: 'V2_3', expectedNetwork: 'Volta' }, { 'X-GMR-Engine-Key': state.apiKey }, undefined, 300_000);
      state.engineSubmissionId = submission?.id; save();
      const result = JSON.parse(submission?.transactionResult || '{}');
      if (submission?.zkVerifyNetwork !== 'Volta' || result.statement?.toLowerCase() !== state.statement || result.domainId !== 175
        || !/^0x[a-fA-F0-9]{64}$/.test(result.txHash || '') || !/^0x[a-fA-F0-9]{64}$/.test(result.blockHash || '')
        || !Number.isSafeInteger(result.aggregationId) || result.aggregationId < 0) throw new Error('Submitted proof needs reconciliation');
      state.submission = { id: submission.id, txHash: result.txHash, blockHash: result.blockHash, aggregationId: result.aggregationId }; save();
    }
    output({ synthetic: true, submission: state.submission });
  } else if (phase === 'receipt') {
    mutate(); config(); if (!state.submission) throw new Error('Submit the synthetic proof first');
    // Retain the public path before the relay arrives, even if archive access later disappears.
    if (state.receipt) await checkBridgeReceipt(state.receipt);
    else {
      const session = await zkVerifySession.start().Volta().readOnly();
      try {
        if (!state.receiptBlockHash) {
          const head = await session.api.rpc.chain.getHeader(await session.api.rpc.chain.getFinalizedHead());
          const start = state.scanNext ?? (await session.api.rpc.chain.getHeader(state.submission.blockHash)).number.toNumber();
          const end = Math.min(head.number.toNumber(), start + 249);
          for (let height = start; height <= end; height++) {
            const hash = (await session.api.rpc.chain.getBlockHash(height)).toString();
            const events = await (session.api.query as any).system.events.at(hash);
            if (events.some(({ event }: any) => isTallyReceiptPublication(event, state.submission.aggregationId))) {
              state.receiptBlockHash = hash; state.receiptBlockNumber = height; save(); break;
            }
            state.scanNext = height + 1; save();
          }
        }
        if (!state.receiptBlockHash) output({ synthetic: true, status: 'awaiting_volta_aggregation', scanNext: state.scanNext });
        else {
          const path = await session.getAggregateStatementPath(state.receiptBlockHash, 175, state.submission.aggregationId, state.statement);
          if (path.leaf.toLowerCase() !== state.statement) throw new Error('Unexpected receipt leaf');
          const receipt: ReviewReceipt = { aggregationId: String(state.submission.aggregationId), merklePath: path.proof as Hex[], leafCount: String(path.numberOfLeaves), index: String(path.leafIndex) };
          validateReceipt(receipt);
          state.receipt = receipt; save();
          await checkBridgeReceipt(receipt);
        }
      } finally { await session.close(); }
    }
  } else if (phase === 'enable') {
    mutate(); const values = config();
    if (!argument) throw new Error('A completed closed-cohort evidence file is required');
    if (statSync(argument).size > 8 * 1024 * 1024) throw new Error('Completed cohort evidence is too large');
    const evidence = JSON.parse(readFileSync(argument, 'utf8'));
    const proof = validateTallyReleaseEvidence(evidence, state.imageId);
    if ((await prover('verify', proof)).verified !== true) throw new Error('Completed cohort proof is invalid');
    // Only this isolated preflight overrides the flag; the running application remains disabled.
    process.env.ANONYMOUS_REVIEW_TALLY_ENABLED = 'true';
    const source = new ReviewTallySnapshotSource(); validateReceipt(evidence.receipt);
    await source.complete(evidence.cohort, evidence.manifest);
    if (!await source.receipt(evidence.statement, evidence.receipt)) throw new Error('Completed cohort receipt is not finalized on Horizen');
    values.ANONYMOUS_REVIEW_TALLY_ENABLED = 'true';
    write(configFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
    state.activationEvidenceSha256 = digest(readFileSync(argument)); state.enabledAt = new Date().toISOString(); save();
    output({ enabledConfiguration: true, restartApiRequired: true, groupId: evidence.manifest.groupId });
  } else if (phase === 'inspect') {
    output({ imageId: state.imageId || null, dockerImageId: state.dockerImageId || null, projectId: state.projectId || null,
      submission: state.submission || null, bridgeVerified: state.finalizedBridgeVerified === true, completedCohortValidated: !!state.activationEvidenceSha256,
      testnetFeePreflight: state.feePreflight || null,
      enabledConfiguration: existsSync(configFile) && parse(readFileSync(configFile, 'utf8')).ANONYMOUS_REVIEW_TALLY_ENABLED === 'true' });
  } else throw new Error('Unsupported release phase');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  console.error(/^(Mutations|Another release|Prover sources|Approved prover|Tally artifact|Private prover|Running prover|Engine operation|Prover operation|Engine owner|Multiple tally|Saved tally|Submitted release|Invalid prover|Create the|Do not overwrite|Dedicated Engine|Engine project|Only explicit|Synthetic proof|Approved synthetic|Uncertain submission|Submitted proof|Submit the|Unexpected receipt|A completed|Completed cohort|Unsupported|Testnet fee)/.test(message)
    ? message : 'Tally release operation failed; inspect private state without printing credentials or witnesses');
  process.exitCode = 1;
} finally {
  if (lock !== undefined) { closeSync(lock); unlinkSync(`${directory}release.lock`); }
}
process.exit(process.exitCode || 0);
