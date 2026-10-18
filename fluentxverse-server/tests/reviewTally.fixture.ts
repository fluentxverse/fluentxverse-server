import { keccak256, toHex, type Hex } from 'viem';
import { Group } from '@semaphore-protocol/group';
import { reviewGroupId, reviewScope, reviewMessage, semaphoreHash, reviewSignalStatement } from '../src/services/anonymousReviews/policy';
import { tallyJournal, tallyManifestHash, tallyTotals, word, type TallyWitness } from '../src/services/anonymousReviews/tallyPolicy';
import { validateAnonymousContent } from '../src/shared/anonymousReviews';

export function tallyFixture(count = 5) {
  const groupId = reviewGroupId('synthetic-tutor', '2020-01'), registry = `0x${'1'.repeat(40)}`;
  const scope = reviewScope(2651420, registry, groupId), members = Array.from({ length: count }, (_, i) => String((i + 1) * 111));
  const contents = Array.from({ length: count }, (_, i) => validateAnonymousContent({ rating: i % 5 + 1, positive: ['feedback'],
    improvement: i % 2 ? [] : ['connection'], salt: (i + 1).toString(16).padStart(64, '0') }));
  const root = word(new Group(members.map(BigInt)).root), scopeHash = word(BigInt(semaphoreHash(scope))), reviewVk = `0x${'ab'.repeat(32)}` as Hex;
  const snapshot: TallyWitness['snapshot'] = { chainId: 2651420, registry, groupId, scopeHash, root, reviewVk,
    closesAt: Date.parse('2020-02-08T00:00:00Z') / 1000, blockNumber: 30, blockHash: `0x${'cd'.repeat(32)}`,
    blockTimestamp: Date.parse('2020-02-08T00:00:00Z') / 1000 + 60,
    accepted: contents.map((content, i) => {
      const nullifier = word(i + 1), messageHash = word(BigInt(semaphoreHash(reviewMessage(groupId, content))));
      return { nullifier, messageHash, statement: reviewSignalStatement(reviewVk, [root, nullifier, messageHash, scopeHash].map(v => BigInt(v).toString())) };
    }) };
  const witness = { snapshot, contents }, totals = tallyTotals(contents);
  return { witness, totals, scope, members, journal: tallyJournal(snapshot, totals), manifestHash: tallyManifestHash(snapshot) };
}
if (import.meta.main) console.log(JSON.stringify(tallyFixture().witness));
