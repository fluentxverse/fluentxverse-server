# Conversational Skills Authoring Corrections

Apply these rules to every new or regenerated lesson in this course edition.

## Introduction

1. The tutor introduces the lesson goal before the situation.
2. Use a natural opening such as: "Our goal for today is: [goal]. Is it clear?"
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

## Review Checklist

- Goal comes before situation in the tutor guide.
- Apply situation fields contain no HTML.
- Japanese support uses the translation field.
- Comprehension questions are separate from the situation.
- Tutor starts every speaking roleplay with a natural spoken line.
- Roleplay questions sound like real conversation, not instructions about conversation.
