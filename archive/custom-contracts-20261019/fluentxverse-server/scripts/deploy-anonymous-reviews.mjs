import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, encodeFunctionData, getContractAddress, http, keccak256, parseAbi } from 'viem';
import { zkVerifySession, CurveType, Library } from 'zkverifyjs';

const root = new URL('../', import.meta.url);
const engineWorkspace = process.env.GMR_ENGINE_WORKSPACE || fileURLToPath(new URL('../../budol/gmr-engine/', root));
const directory = new URL('.deployment/anonymous-reviews/', root);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const stateFile = new URL('state.json', directory);
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { version: 1, chainId: 2651420, steps: {} };
const save = () => {
  const temp = new URL('state.tmp', directory);
  writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(temp, stateFile);
};
function container(name) { return JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }))[0]; }
function environment(name) {
  return Object.fromEntries(container(name).Config.Env.map(value => { const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)]; }));
}
const engineEnv = environment('budol-gmr-engine-1');
const serverEnv = parse(readFileSync(new URL('.env', root), 'utf8'));
const vaultIP = Object.values(container('budol-gmr-vault-1').NetworkSettings.Networks)[0].IPAddress;
const vaultURL = `http://${vaultIP}:8091`;
const rpcURL = 'https://horizen-testnet.rpc.caldera.xyz/http';
const bridge = '0x3098A6974649478f0133046e44105AA84e868C21';
const domainId = 175;
const chain = defineChain({ id: 2651420, name: 'Horizen Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcURL] } } });
const client = createPublicClient({ chain, transport: http(rpcURL, { timeout: 20_000, retryCount: 0 }) });
const apiBase = 'http://127.0.0.1:8090';
const phase = process.argv[2] || 'inspect';
const apply = process.argv.includes('--apply');
function requireApply() { if (!apply) throw new Error('This phase requires --apply'); }
async function api(path, body, headers = {}, timeout = 30_000, method) {
  const response = await fetch(`${apiBase}${path}`, { method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Engine ${path} returned HTTP ${response.status}`);
  return result;
}
const adminHeader = { 'X-GMR-Engine-Admin-Key': engineEnv.GMR_ENGINE_ADMIN_API_KEY };
async function login() {
  const response = await fetch(`${apiBase}/dashboard/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: engineEnv.GMR_ENGINE_OWNER_USERNAME, password: engineEnv.GMR_ENGINE_OWNER_PASSWORD }) });
  if (!response.ok) throw new Error(`Engine owner authentication failed (${response.status})`);
  return { Cookie: response.headers.get('set-cookie').split(';')[0] };
}
async function vaultWallet(projectId, address) {
  const response = await fetch(`${vaultURL}/v1/wallets?projectId=${encodeURIComponent(projectId)}`, { headers: { 'X-GMR-Vault-Key': engineEnv.GMR_ENGINE_VAULT_INTERNAL_API_KEY } });
  if (!response.ok) throw new Error('Vault project lookup failed');
  const data = await response.json();
  const found = data.wallets.find(wallet => wallet.address.toLowerCase() === address.toLowerCase());
  if (!found) throw new Error('Project wallet does not match Vault custody');
  return found;
}
async function vaultAccount(projectId, address) {
  const wallet = await vaultWallet(projectId, address);
  const { createVaultAccount } = await import(`${engineWorkspace}/scripts/vault-account.ts`);
  return createVaultAccount({ chainId: 2651420, rpcUrl: rpcURL, vaultAddress: address, vaultWalletRef: `gmr-vault:v1:${wallet.id}`,
    vaultProjectId: projectId, vaultUrl: vaultURL, vaultApiKey: engineEnv.GMR_ENGINE_VAULT_INTERNAL_API_KEY });
}
function artifact() {
  const require = createRequire(new URL('../../contracts/anonymous-reviews/package.json', import.meta.url));
  const solc = require('solc');
  const source = readFileSync(new URL('../../contracts/anonymous-reviews/AnonymousReviewRegistry.sol', import.meta.url), 'utf8');
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'AnonymousReviewRegistry.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } } })));
  if (compiled.errors?.some(error => error.severity === 'error')) throw new Error('Reviewed contract compilation failed');
  const result = compiled.contracts['AnonymousReviewRegistry.sol'].AnonymousReviewRegistry;
  return { ...result, sourceSha256: createHash('sha256').update(source).digest('hex') };
}
async function prepareArtifacts() {
  const assets = new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/', import.meta.url);
  const vk = JSON.parse(readFileSync(new URL('semaphore.vk.json', assets), 'utf8'));
  const pins = {};
  for (const extension of ['wasm', 'zkey']) pins[extension] = createHash('sha256').update(readFileSync(new URL(`semaphore.${extension}`, assets))).digest('hex');
  const keys = JSON.parse(readFileSync(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
  const expected = { ...keys, vk_delta_2: keys.vk_delta_2[7], IC: keys.IC[7] };
  if (JSON.stringify(vk) !== JSON.stringify(expected)) throw new Error('Proving release does not match packaged depth-8 verifier');
  pins.vk = createHash('sha256').update(JSON.stringify(vk)).digest('hex');
  const session = await zkVerifySession.start().Volta().readOnly();
  try { pins.nativeVk = await session.getVkHash({ proofType: 'groth16', config: { library: Library.snarkjs, curve: CurveType.bn128 } }, vk); }
  finally { await session.close(); }
  return { vk, pins };
}
async function transaction(name, account, data = '0x', to, value = 0n, deploy = false) {
  requireApply();
  const payload = createHash('sha256').update(JSON.stringify({ address: account.address, data, to: to || null, value: String(value) })).digest('hex');
  let step = state.steps[name];
  if (step && step.payload !== payload) throw new Error('Saved deployment transaction differs from current request');
  if (!step) {
    if (Object.values(state.steps).some(item => item.status !== 'success')) throw new Error('Earlier deployment transaction requires reconciliation');
    const pending = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const latest = await client.getTransactionCount({ address: account.address, blockTag: 'latest' });
    if (pending !== latest) throw new Error('Signer has another pending transaction; retry after confirmation');
    const gas = (await client.estimateGas({ account: account.address, data, to, value })) * 120n / 100n;
    const wallet = createWalletClient({ account, chain, transport: http(rpcURL, { timeout: 20_000, retryCount: 0 }) });
    const prepared = await wallet.prepareTransactionRequest({ data, to, value, gas, nonce: pending });
    const fee = prepared.maxFeePerGas || prepared.gasPrice;
    if (!fee || fee > 10_000_000_000n || gas * fee > 500_000_000_000_000n) throw new Error('Testnet fee exceeds deployment ceiling');
    if (await client.getBalance({ address: account.address }) < value + gas * fee) throw new Error('Insufficient testnet gas');
    const raw = await wallet.signTransaction(prepared);
    step = { payload, raw, hash: keccak256(raw), ...(deploy ? { address: getContractAddress({ from: account.address, nonce: BigInt(pending) }) } : {}) };
    state.steps[name] = step; save();
  }
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: step.hash }); } catch (error) { if (error.name !== 'TransactionReceiptNotFoundError') throw error; }
  if (!receipt) {
    let pending = false;
    try { await client.getTransaction({ hash: step.hash }); pending = true; } catch (error) { if (error.name !== 'TransactionNotFoundError') throw error; }
    if (!pending && await client.sendRawTransaction({ serializedTransaction: step.raw }) !== step.hash) throw new Error('Unexpected broadcast hash');
    receipt = await client.waitForTransactionReceipt({ hash: step.hash, confirmations: 2, timeout: 180_000 });
  }
  step.status = receipt.status; step.blockNumber = String(receipt.blockNumber); save();
  if (receipt.status !== 'success') throw new Error('Deployment transaction reverted; inspect saved journal');
  if (deploy && receipt.contractAddress?.toLowerCase() !== step.address.toLowerCase()) throw new Error('Deployment address mismatch');
  return step;
}
async function verifyRegistry(blockTag = 'latest') {
  if (!state.contract) throw new Error('Registry has not been deployed');
  const compiled = artifact();
  if (state.sourceSha256 !== compiled.sourceSha256) throw new Error('Deployed source pin differs from current contract');
  const code = await client.getCode({ address: state.contract, blockTag });
  const normalize = value => {
    const bytes = Buffer.from(value.replace(/^0x/, ''), 'hex');
    for (const entries of Object.values(compiled.evm.deployedBytecode.immutableReferences))
      for (const { start, length } of entries) bytes.fill(0, start, start + length);
    return bytes.toString('hex');
  };
  if (!code || normalize(code) !== normalize(compiled.evm.deployedBytecode.object)) throw new Error('Deployed registry bytecode mismatch');
  for (const [functionName, expected] of Object.entries({ owner: state.owner, bridge, domainId, vkHash: state.pins.nativeVk, proofDepth: 8, minBatch: 5 })) {
    const result = await client.readContract({ address: state.contract, abi: compiled.abi, functionName, blockTag });
    if (String(result).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`Registry ${functionName} mismatch`);
  }
  return compiled;
}
async function configureRuntime(enabled = false) {
  requireApply();
  const compiled = await verifyRegistry(enabled ? 'finalized' : 'latest');
  if (enabled && !await client.readContract({ address: state.contract, abi: compiled.abi, functionName: 'enabled', blockTag: 'finalized' }))
    throw new Error('Registry enablement is not finalized yet');
  const envFile = new URL('config/anonymous-reviews.env', root);
  const old = existsSync(envFile) ? parse(readFileSync(envFile, 'utf8')) : {};
  const values = { ANONYMOUS_REVIEWS_ENABLED: String(enabled), ANONYMOUS_REVIEWS_CHAIN_ID: '2651420', ANONYMOUS_REVIEWS_RPC_URL: rpcURL,
    ANONYMOUS_REVIEWS_CONTRACT: state.contract, ANONYMOUS_REVIEWS_BRIDGE: bridge, ANONYMOUS_REVIEWS_DOMAIN_ID: String(domainId),
    ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH: state.pins.nativeVk, ANONYMOUS_REVIEWS_VK_SHA256: state.pins.vk,
    ANONYMOUS_REVIEWS_WASM_SHA256: state.pins.wasm, ANONYMOUS_REVIEWS_ZKEY_SHA256: state.pins.zkey,
    ANONYMOUS_REVIEWS_ENCRYPTION_KEY: old.ANONYMOUS_REVIEWS_ENCRYPTION_KEY || randomBytes(32).toString('hex'),
    GMR_ANONYMOUS_REVIEWS_ENGINE_API_BASE: 'http://host.docker.internal:8090', GMR_ANONYMOUS_REVIEWS_ENGINE_API_KEY: state.apiKey };
  writeFileSync(envFile, '# Generated testnet review configuration. Keep private.\n' + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  const policyPath = `${engineWorkspace}/config/zkverify-projects.json`;
  const policies = JSON.parse(readFileSync(policyPath, 'utf8'));
  policies[state.projectId] = { domainId, vkHash: state.pins.nativeVk, publicInputs: 4, methods: ['registerCohort', 'acceptReview'] };
  writeFileSync(policyPath, JSON.stringify(policies, null, 2) + '\n');
}

try {
  if (await client.getChainId() !== 2651420 || !await client.getCode({ address: bridge })) throw new Error('Testnet RPC or official receipt bridge is unavailable');
  if (phase === 'project') {
    requireApply(); const session = await login();
    const projects = (await api('/dashboard/projects', undefined, session)).projects.filter(project => project.name === 'FluentXVerse Anonymous Reviews');
    if (projects.length > 1) throw new Error('Multiple review projects need explicit selection');
    let project, owner;
    if (!projects.length) {
      const result = await api('/dashboard/projects', { name: 'FluentXVerse Anonymous Reviews', environment: 'development', allowedChains: [2651420],
        allowedContracts: ['0x0000000000000000000000000000000000000001'], gasFreeEnabled: false, rateLimitPerMinute: 12 }, session);
      project = result.project; owner = result.serverWallet.address;
    } else {
      const result = await api(`/admin/apps/${projects[0].id}`, undefined, adminHeader); project = result.app; owner = result.serverWallet.address;
    }
    if (state.projectId && state.projectId !== project.id) throw new Error('Review deployment project differs from saved state');
    state.projectId = project.id; state.owner = owner; state.proposedContract = getContractAddress({ from: owner, nonce: 0n }); save();
    await api(`/dashboard/projects/${project.id}/settings`, { ...project, allowedChains: [2651420], allowedContracts: [state.proposedContract] }, session, 30_000, 'PUT');
    if (!state.apiKey) {
      const result = await api(`/admin/apps/${project.id}/api-keys`, { name: 'FluentXVerse private review relay', scopes: ['contracts:read', 'contracts:write', 'transactions:read'],
        allowedOrigins: [], allowedIps: [] }, adminHeader);
      state.apiKey = result.plaintext; state.apiKeyId = result.key.id; save();
    }
    console.log(JSON.stringify({ projectId: state.projectId, owner: state.owner, proposedContract: state.proposedContract }));
  } else if (phase === 'fund') {
    if (!state.projectId) throw new Error('Create the review project first');
    const source = await api('/v1/auth/me', undefined, { 'X-GMR-Engine-Key': serverEnv.GMR_SCREENING_ENGINE_API_KEY });
    const details = await api(`/admin/apps/${source.app.id}`, undefined, adminHeader);
    if (source.app.id !== '2a798002-7ed3-4e98-853e-62306479b9da') throw new Error('Unexpected testnet funding project');
    const account = await vaultAccount(source.app.id, details.serverWallet.address);
    const step = await transaction('fund-review-wallet', account, '0x', state.owner, 2_000_000_000_000_000n);
    console.log(JSON.stringify({ hash: step.hash, recipient: state.owner, testnetETH: '0.002' }));
  } else if (phase === 'deploy') {
    requireApply(); const { pins } = await prepareArtifacts();
    state.pins = pins; const compiled = artifact(); state.sourceSha256 = compiled.sourceSha256; save();
    const account = await vaultAccount(state.projectId, state.owner);
    const data = encodeDeployData({ abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}`, args: [state.owner, bridge, BigInt(domainId), pins.nativeVk] });
    const step = await transaction('deploy-registry', account, data, undefined, 0n, true);
    if (step.address.toLowerCase() !== state.proposedContract.toLowerCase()) throw new Error('Registry differs from scoped contract allowlist');
    state.contract = step.address; save(); await verifyRegistry(); await configureRuntime(false);
    console.log(JSON.stringify({ contract: state.contract, hash: step.hash, pins, runtimeVerified: true }));
  } else if (phase === 'enable-contract') {
    const compiled = await verifyRegistry(); const account = await vaultAccount(state.projectId, state.owner);
    const step = await transaction('enable-registry', account, encodeFunctionData({ abi: compiled.abi, functionName: 'setEnabled', args: [true] }), state.contract);
    console.log(JSON.stringify({ hash: step.hash, enabled: true }));
  } else if (phase === 'configure') {
    await configureRuntime(process.argv.includes('--enable-intake'));
    console.log(JSON.stringify({ runtimeConfigured: true, intakeEnabled: process.argv.includes('--enable-intake'), projectId: state.projectId }));
  } else if (phase === 'verify') {
    const finalized = await client.getBlock({ blockTag: 'finalized' });
    const activationBlock = state.steps['enable-registry']?.blockNumber;
    if (!activationBlock || finalized.number < BigInt(activationBlock)) throw new Error('Registry deployment and enablement are not finalized yet');
    const compiled = await verifyRegistry('finalized');
    const enabled = await client.readContract({ address: state.contract, abi: compiled.abi, functionName: 'enabled', blockTag: 'finalized' });
    if (!enabled) throw new Error('Registry enablement is not finalized yet');
    console.log(JSON.stringify({ projectId: state.projectId, registry: state.contract, enabled, finalizedBytecodeVerified: true }));
  } else if (phase === 'inspect') {
    console.log(JSON.stringify({ chainId: 2651420, bridge, projectId: state.projectId || null, registry: state.contract || null,
      owner: state.owner || null, steps: Object.fromEntries(Object.entries(state.steps).map(([name, step]) => [name, { hash: step.hash, status: step.status, address: step.address }])) }));
  } else throw new Error('Unsupported deployment phase');
} catch (error) {
  // Never echo provider responses, credentials or the private deployment state.
  console.error(/^(Engine |This phase|Multiple |Review |Project |Proving |Saved |Earlier |Signer |Testnet |Insufficient |Unexpected |Deployment |Registry |Create |Unsupported)/.test(error.message)
    ? error.message : 'Deployment preflight or operation failed; inspect the private journal and service state');
  process.exitCode = 1;
}
