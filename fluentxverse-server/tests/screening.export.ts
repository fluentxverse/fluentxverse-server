import { signScreeningCredential } from '../src/services/screening/credential';
import { screeningLeaf, encodeValidationPayload, type ScreeningChainConfig } from '../src/services/screening/chain';
import { screeningFixture } from './screening.fixture';

const [adapterAddress, registry, bridge, signer] = process.argv.slice(2) as string[];
const config: ScreeningChainConfig = { chainId: 2651420, agentId: '12', adapterAddress: adapterAddress!,
  validationRegistry: registry as any, identityRegistry: registry as any, bridge: bridge as any, signer: signer as any,
  vkHash: `0x${'a'.repeat(64)}`, issuerHash: '', domainId: 42 };
const signed = await signScreeningCredential(screeningFixture(), config, Buffer.alloc(32, 7));
config.issuerHash = signed.signals.issuerHash;
console.log(JSON.stringify({ values: signed.publicSignals, leaf: screeningLeaf(config.vkHash, signed.publicSignals),
  payload: encodeValidationPayload(config, signed.publicSignals), vkHash: config.vkHash }));
