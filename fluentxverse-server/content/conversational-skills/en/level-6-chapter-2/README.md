# Level 6, Chapter 2: Beyond the Workshop

Threads of Tradition continues with eight English-only lessons adapted directly
from the owner's outline. The target remains **TOEIC 550–780**, as in Chapter 1;
the reference's C1 label does not control wording. No external model API,
model-availability probe or application AI credits are used for authoring.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | An Invitation to Explore | Speaking | Propose a collaboration and agree on contributions |
| 2 | The Paper That Tells a Story | Listening | Follow a craft explanation and ask about judgment |
| 3 | The Next Generation | Reading | Interpret an interview and respect independent choices |
| 4 | The Masters of Wood | Speaking | Compare experience, traditional methods and modern tools |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | The Value of Handmade | Speaking | Balance craft value, livelihood and affordability |
| 7 | Dancing Through History | Speaking | Explain participation and attribute a personal perspective |
| 8 | The Story We Choose to Tell | Reading | Identify misleading framing and agree on revisions |
| 9 | Hands of the Future | Speaking | Reflect on learning and assess impact carefully |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Owner Pointers

Apply [the saved authoring corrections](../../ja/AUTHORING_CORRECTIONS.md),
with the owner's newer English-only direction overriding Japanese-support
instructions. The lesson objective comes before the situation. Apply situation
fields contain plain text; questions live in structured tutor-guide fields.
Speaking has concrete roles, a natural tutor opening and ten short turns.

Step A is **Expressions**, with exactly four relevant phrases per lesson.
Each has an English meaning and an italic contextual example with the phrase
in bold. No vocabulary cards, Japanese translations or bilingual fallback.
Pronunciation appears only in Step B; there is no Part III pronunciation.
Part II, Step B Pronunciation, six/four keyed exercises, five Useful Language frames,
three optional discussion topics and standard numbered tutor guides remain.
Step B uses the owner's Phrase/Example table with linking and meaning-group
guides. Exact stressed words or syllables are bold in complete examples; this
replaces the earlier grammar/reading-tip variation. Part II leads directly to Step B; there is no Part III pronunciation.
The fixed English feedback rubric is preserved. Actual mistakes and notes
support future checkpoints; no learner weakness is invented.

Introductions are 59–65 words. Speaking models are 116–121 words. The two
private listening scripts are below 90 words; reading sources and fresh notes
are below 125 words. No new artwork or romance. Existing identities, artwork,
publication states, fixed English feedback, learner properties and saved
checkpoints are preserved by the established builders and guarded writer.

## Story and Cultural Background

The chapter begins two weeks after the festival. The new documentary invitation
does not establish release of the Chapter 1 film, a paid contract or future
interview permissions. Aiko researches history, Haru contributes workshop
experience, Mei explores food interests, and Daniel leads the documentary.

The papermaking activity is supervised and partial, rather than a complete
production recipe or professional finished sheet. Yui admires her mother's work
and considers a catalogue without promising succession or launching a service.
Her agreement to inclusion includes a request for accurate portrayal; it is
not approval of an edit that removes her technical contribution.

Mr. Mori's demonstration supports a comparison of experienced judgment, not a
claim that woodworking and dyeing are identical or that all traditional joints
avoid nails. Machines can complement hand skills. The fivefold tray price
applies to the fictional pair, not every handmade product. Different budgets
and sustainable maker income both belong in the conversation.

The Gujo visit is in summer festival season. No exact dates or blanket filming
permission are invented. The older participant's statement is attributed to
her rather than every dancer. The misleading title Japan's Last Artisans and
the removal of Yui's context lead to the revised Hands of the Future. Agreed
checks and review requests are not automatically completed approvals.

Several weeks later, the community screening occurs. Applause and one student's
changed view support a modest impact claim, not economic rescue or unanimous
views. Another documentary has been suggested, but no new trip is confirmed.

Primary background sources, checked November 14, 2026:

- [Echizen Washi Village](https://www.echizenwashi.jp/english/): the established
  paper-making centre and opportunities to experience handmade paper.
- [Museum HIDA](https://hida-center.com/english/museumhida.html): Hida's
  woodworking heritage, architecture, furniture and master craftspeople.
- [Gujo Hachiman Tourism Association](https://www.gujohachiman.com/kanko/odori_e.html):
  communal summer dances that welcome participants, including beginners.

These sources support general setting facts. The named hosts, conversations,
shop comparison, editing notes and screening are fictional teaching material.
Language trivia is original; no source passage is reproduced in a lesson.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=6 --chapter=2
bun test ./fluentxverse-server/tests/beyondWorkshop.test.ts
node scripts/tests/new-paths.cjs --level=6 --chapter=2
```

The dry run creates reviewable JSON under `output/beyond-the-workshop/`.
The writer requires the exact snapshot digest with `--write --expected=...`,
backs up privately, detects concurrent edits, refuses published replacements
and verifies every saved field. It writes curriculum content to Memgraph.
Slots 5/10 remain dynamic; learner notes, exercise marks and existing saved
checkpoints are not rewritten. Saving drafts does not publish or deploy them.

Chapter tests cover the English-only expressions layout, keys, language
budgets, private listening, fresh reading evidence, continuity and preservation.
The shared read-only harness checks dashboard/tutor/student, desktop/mobile,
and light/dark renderers, including highlighted expression rows. Generated
screenshots and logs are local verification evidence, not source-release files.

Saved and verified November 14, 2026: eight new drafts, chapter metadata,
private backup and full-record read-back. Eleven chapter tests passed, with
Chapter 1/checkpoint/curriculum coverage also passing. All 33 browser cases
passed. A wider validation run still has an older Level 3 assertion expecting
no artwork in Lessons 6/7; it is unrelated to this chapter and was left intact.
The full server typecheck reports the existing 159 diagnostics elsewhere,
with none in Chapter 2's new content or tests. Nothing was published or deployed.
