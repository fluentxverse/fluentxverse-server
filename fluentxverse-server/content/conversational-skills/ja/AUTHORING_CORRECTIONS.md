# Conversational Skills Authoring Corrections

Apply these rules to every new or regenerated lesson in this course edition.

## Introduction

1. The tutor introduces the lesson objective before the situation. Use "lesson objective" consistently.
2. Use a natural opening such as: "Our lesson objective today is to [task]. Is it clear?"
3. Introduce the context next with: "Here's our situation. [situation]"
4. Do not repeat the same situation text as both the visible introduction and an unexplained tutor script.

## Apply

1. Keep `situationText` as plain English text. Never put `<br>`, `<small>`, numbered questions, or other HTML in it.
2. Put the Japanese support text in `situationTranslation`.
3. Put comprehension questions in `tutorSteps[].questions`, not inside the situation.

## Speaking Roleplays

1. The tutor always speaks first and starts in character.
2. The first roleplay prompt must be a natural line the tutor can say immediately.
3. Prefer concrete questions such as "Where are you from?" and "What is your job?"
4. Avoid vague or teacher-like prompts such as "Tell me one thing about yourself" and "What can you ask me?"
5. Use later prompts only as support when the learner needs help; allow the conversation to flow naturally.
6. Assign a concrete role directly: "You are Emma. Your tutor is Leo." Do not add alternate-character choices or personal/romantic-information disclaimers. Keep learner instructions inside the story situation.

## Review Checklist

- Lesson objective comes before situation in the tutor guide.
- Apply situation fields contain no HTML.
- Japanese support uses the translation field.
- Comprehension questions are separate from the situation.
- Tutor starts every speaking roleplay with a natural spoken line.
- Roleplay questions sound like real conversation, not instructions about conversation.

## Tutor Guide Standard

- From Level 6 onward, use **STEP B: PRONUNCIATION** with a short connected-speech
  tip and a Phrase/Example table. Teach linking sounds across word boundaries,
  light function words, meaningful stress and pauses between thought groups.
  Provide at least two relevant phrases, readable guides and full-sentence
  examples. Bold the exact stressed words or syllables in the examples with
  `<strong>`; do not bold the whole sentence. Use separate linking and pause
  marks so that learners can distinguish connection, grouping and stress.
  Use only Step B Pronunciation. Remove Part III pronunciation entirely;
  Part II transitions directly to Step B. Do not add commentary about IPA,
  reading cues or accents to lesson content.
  This newer direction replaces Step B grammar/reading tips for this edition.
  Levels 6 onward remain English-only; do not add Japanese support to these editions.
  Level 8 uses the owner's TOEIC 785–940 authoring range and visible score label.

- Use the current Level 3, Chapter 1, Lesson 3 guide as the editorial reference: concise numbered instructions, spoken scripts, separate tips, and structured questions/answer keys.
- Keep Intro, Learn, and Grammar Tip scripts in their existing single-string fields; Apply, Exercise, Mission, and Feedback use arrays. Do not change renderer schemas merely to standardize wording.
- Learn has five vocabulary steps, five discussion steps, and five pronunciation steps. Adapt sounds, examples, and questions to the lesson.
- Keep full listening transcripts in dedicated tutor-only blocks, never in student-facing text. Listening missions may need one extra step for delivery.
- Preserve each lesson's questions, answer keys, dialogue, roleplay lines, and listening scripts. Standardize presentation, not the content skill.
- Feedback always uses the reference lesson's fixed six-step guide: introduce Feedback, read the lesson objective, check achievement, score Challenge 1, give range/accuracy/fluency feedback, wrap up.
