import { writeFileSync } from 'node:fs';
import Elysia from 'elysia';
import { initDriver } from '../src/db/memgraph';
import { lessonRegistryRoute } from '../src/routes/lessonRegistry.route';
import { REGISTRY_POLICY } from '../src/services/lessonRegistry/outbox';
if (process.env.REGISTRY_TEST_URI !== 'bolt://127.0.0.1:17739') throw Error('Disposable graph required');
process.env.LESSON_REGISTRY_CAPTURE = 'true';
process.env.LESSON_REGISTRY_CHAIN_ID = '421614';
process.env.LESSON_REGISTRY_CONTRACT = '0x1b4e8106450e8176730827c47aca9910a931c110';
process.env.LESSON_REGISTRY_FEED_KEY = 'disposable-registry-http-observer-secret-only';
await initDriver(process.env.REGISTRY_TEST_URI, '', '', 1);
writeFileSync('/tmp/fxv-registry-observer.json', JSON.stringify({ lessonRegistry: true, projectId: 'registry-local-http-test', chainId: 421614,
  contract: process.env.LESSON_REGISTRY_CONTRACT, operator: '0xc67f2499aef7ce2b2e8c2f0cf3f5f0d1583757f1',
  policyHash: REGISTRY_POLICY, feedUrl: 'http://127.0.0.1:17741/internal/lesson-registry/events',
  feedKeyEnv: 'REGISTRY_OBSERVER_TEST_SECRET', mode: 'observe', epoch: 'registry-local-http-20261104' }), { mode: 0o600 });
new Elysia().use(lessonRegistryRoute).listen({ hostname: '127.0.0.1', port: 17741 });
console.log('Disposable private registry feed listening on loopback port 17741');
