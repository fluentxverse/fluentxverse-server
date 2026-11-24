# Level 4, Chapter 5: Where We Belong

Current language target: **Level 4, TOEIC 225-545** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

The final eight episodes adapt the user's reference, concluding the Kamo House
story without adding a sixth chapter. No artwork or physical-intimacy scenes.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | The Opportunity of a Lifetime | Speaking | Expectations, concerns and shared preparation |
| 2 | Trouble in Seoul | Listening | Hotel assistance, an adapter loan and confirmed details |
| 3 | A Dream Comes True | Reading | Project award versus assignment terms and acceptance |
| 4 | A Trip to Fukuoka | Speaking | Meeting family, background and natural follow-up questions |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1-4 |
| 6 | The Bakery on the Corner | Speaking | Budget, risks and conditions before signing |
| 7 | The Future of Kamo House | Speaking | Partnership scope and polite negotiation |
| 8 | The Things We Leave Behind | Reading | Reflection, gratitude and farewell arrangements |
| 9 | Where We Belong | Speaking | Milestones, support and welcoming a new resident |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6-9 |

## Continuity and Teaching Evidence

The opening explicitly advances Chapter 4's unresolved opportunity: the agency
now confirms the brief and books a short presentation trip, but is still only
shortlisted. A hotel booking error is resolved with a second room at a nearby
partner hotel, with the hotel covering the additional room cost. The next
morning's distinct message concerns a free adapter loan: collect at reception
at eight, test before leaving, taxi at 8:30, return after the meeting before six.
Both complete listening scripts are under eighty words and tutor-only.

Lesson 3 first shows the project award and a proposed three-month assignment,
not automatic acceptance. The fresh challenge terms arrive one week later:
starting three weeks from that date matches the original proposed four-week
lead time. Written terms cover separate apartments and return economy flights,
approved local-work travel reimbursement with receipts, responsibilities and
return to the existing Japan-based roles. Acceptance precedes bookings. The
closing story establishes acceptance, not permanent relocation.

The earlier unbooked Fukuoka idea becomes a family visit. Nao receives a gallery
invitation, with exhibition arrangements still to confirm. Leo's fictional shop
budget distinguishes setup (240,000 deposit + 350,000 equipment + 60,000 other
setup = 650,000 yen), a 300,000 reserve and recurring rent of 120,000 per month.
Savings of 1,100,000 leave 150,000 outside setup and the reserve, not profit or
guaranteed business viability. Other monthly costs, lease and equipment need
checking. Only the later closing establishes a reviewed plan and signed lease;
the farewell still shows fit-out, not an already opened bakery.

Claire negotiates one trial pottery workshop for twelve at the partner cafe,
not fifty people, a merger or a permanent schedule. Nao's fee and written date,
costs and responsibilities need both parties' approval before publicity. Kamo
House stays independent; further events require a trial review.

The farewell's fresh reading note gives specific gifts and contributions, an
unconfirmed bakery opening, an upcoming exhibition and a first group call on
the first Sunday after arrival at eight in Kyoto. Ren sends the link; the group
chat carries smaller updates and later call dates remain open. Emma and Leo
acknowledge the past without restoring their romance. After three months,
Emma and Ren return from the completed assignment for Riverbend Bakery's
official opening. The tripod photograph and new resident complete the story's
full-circle ending.

## Standards and Persistence

Reuse the existing standard guides, fixed feedback, six vocabulary items,
discussion and basic pronunciation, two tips, six keyed Step A/four keyed Step B
items, actual-error marking and tutor notes. Direct character roles, ten-line
alternating speaking dialogues and fresh visible reading missions are retained.
No alternate-character or personal-disclosure instructions are added. Level 4
keeps the application's established BEGINNER badge with supported B1-B2 tasks.

```sh
bun scripts/apply-exploring-kyoto.ts --level=4 --chapter=5
```

Review generated `output/where-we-belong/lesson-*.json`, then use
`--write --expected=...` with a fresh reviewed snapshot digest. The updater
refuses non-draft replacements, backs up records, guards concurrent edits,
writes to Memgraph transactionally and verifies every saved field. It does not
publish drafts, deploy code, or store lesson content in Postgres.

Verification: `tests/whereWeBelong.test.ts` plus the existing chapter, curriculum,
validation and checkpoint suite passes 114 tests. The shared renderer harness
passes 33 fixture-backed desktop/mobile, light/dark cases across dashboard,
tutor and student, blocking all API writes:

```sh
node scripts/tests/new-paths.cjs --level=4 --chapter=5
```

No new-chapter strict TypeScript diagnostics; eight pre-existing diagnostics in
older Chapter 1 helpers remain. Screenshots are local generated output under
`output/where-we-belong/screenshots/`, not production artwork.

## Legacy Slot Cleanup

At the user's request, the two old Level 3 Chapter 1 speaking drafts in slots
5 and 10 were removed after verifying zero learner references/relationships.
`scripts/remove-legacy-conversational-checkpoint-drafts.ts` takes a full backup,
requires a reviewed snapshot digest, rechecks within the transaction and verifies
that all other lesson records and learner evidence are unchanged. It only targets
those two exact draft IDs and deliberately refuses a second run after removal.
Levels 3 and 4 now each contain forty regular records: eight per chapter, with
5/10 available to the existing personalized checkpoint mechanism.
