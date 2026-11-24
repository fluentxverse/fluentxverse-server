# Level 4, Chapter 4: Dreams in Motion

Current language target: **Level 4, TOEIC 225-545** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

Adapted from the user's eight-episode reference. Continue the successful second
market and existing couples without undoing the earlier breakup or adding
physical-intimacy scenes. No artwork generated.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | Bigger Dreams | Speaking | Ambitions, reasons and a small first step |
| 2 | A Plan on Paper | Listening | Responsibilities, handover and deadlines |
| 3 | Money Matters | Reading | Budget comparisons and confirmed funds |
| 4 | A Day in Uji | Speaking | Polite sample/product inquiries |
| 5 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 1-4 |
| 6 | A Scheduling Disaster | Speaking | Explain a clash and reschedule politely |
| 7 | The Big Presentation | Speaking | Explain benefits and respond to feedback in dialogue |
| 8 | The Unexpected Downpour | Reading | Updated layout, limits and alternatives |
| 9 | Doors Are Opening | Speaking | Celebrate opportunities without inventing final outcomes |
| 10 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 6-9 |

## Continuity and Evidence

Claire already committed to monthly markets in Chapter 3; this chapter develops
the branded Kamo Collective project rather than rediscovering the monthly idea.
Leo is considering a small own-brand venture while retaining his current job.
He has not opened a bakery or rented a shop.

The planning weekend proposes an expanded Saturday market three weeks away,
10-2. First ideas are due Wednesday evening. A separate listening handover asks
Ren for an online-poster draft by Friday at four, using Emma's approved logo;
Emma checks date/hours before publishing and Claire shares the approved version.
The scripts are distinct and short, with transcript text only in tutor guides.

The initial fictional fund is ¥40,000. Original costs of 18,000 + 8,000 + 20,000
total ¥46,000, a ¥6,000 shortfall. Replacing print with ¥8,000 online promotion
gives ¥34,000 costs and ¥6,000 reserve. The reading mission uses a new quote:
16,000 tables including delivery + 6,000 reusable decorations + 8,000 online
promotion + 5,000 weather covers = ¥35,000, leaving ¥5,000. Proposed vendor fees
and thirty unpaid pastry portions are not counted as available cash or profit.

The Uji shop and ¥500 twenty-gram sample are fictional roleplay details, not a
real supplier quote. Leo requests product/contact information and tests a sample
instead of committing to a large order. The existing Fukuoka idea is not turned
into a booked trip.

About two weeks before the market, Nao's Saturday-noon gallery opening conflicts
with Saturday 10-2. Claire checks venue/team/supplier availability; the event
changes to Sunday 10-2 with Nao arriving at nine. Public materials and logistics
are updated after confirmation. The presentation is a tutor-first exchange,
not a monologue: Claire requests larger Sunday date text and adjacent hours,
Ren checks versions and Claire approves the revision before publishing.

Rain at 9:40 Sunday cancels the outdoor layout, not the event. Four indoor tables
have shared sections; extra stock stays in a dry back room, and circulation stays
clear. The fresh 11:15 reading mission adds photos on the back wall, a noon craft
demonstration at table A, reserved pastry pickup at the counter from one, and no
outdoor reopening that day. Claire coordinates layout changes. Reservations do
not prove payment. Only the closing story reveals the afternoon's successful sales.

A week later, gallery extension and evening kitchen use are opportunities, with
details still to confirm. The agency is shortlisted for Seoul, not awarded the
project. The manager wants Emma/Ren on the presentation team, but brief, format,
deadline and any travel remain open. No flights, relocation, contract acceptance
or Level 4 Chapter 5 outcome is invented.

## Standards and Persistence

Keep the established BEGINNER badge for Level 4, supported B1-B2 text, Japanese
support, six vocabulary items, discussion, basic pronunciation, two tips, keyed
six-item Step A/four-item Step B exercises and existing actual-error marking/notes.
Direct roles, short alternating dialogues, private listening, fresh visible
reading challenges, standard tutor-guide counts and fixed range/accuracy/fluency
feedback. No alternate-character or personal-information disclaimers.

```sh
bun scripts/apply-exploring-kyoto.ts --level=4 --chapter=4
```

Review `output/dreams-in-motion/lesson-*.json`, then save with `--write --expected=...`
using the exact reviewed snapshot digest. The existing updater backs up records,
refuses non-draft replacement, guards concurrent changes, writes transactionally
to Memgraph and verifies every saved field. Earlier lessons, existing checkpoint
records and student marks/notes are not changed. No lesson content goes to Postgres.
Content persistence does not push or deploy application code.

## Verification

`tests/dreamsInMotion.test.ts` covers all eight episodes, roles, Japanese support,
guide/rubric standards, concise private listening, the interactive presentation,
exercise keys, fresh reading evidence, budget arithmetic, changed dates, rain
arrangements, pending opportunities and unchanged previous content. The related
authoring/validation/checkpoint suite passes 102 tests.

```sh
node scripts/tests/new-paths.cjs --level=4 --chapter=4
```

This passes 33 fixture-backed dashboard/tutor/student cases across desktop/mobile
and both themes, with all API writes blocked. Screenshots are under
`output/dreams-in-motion/screenshots/`. No Chapter 4 strict TypeScript diagnostics
were found; eight existing diagnostics remain in older Chapter 1 authoring helpers,
so the broader content type check is not fully clean.
