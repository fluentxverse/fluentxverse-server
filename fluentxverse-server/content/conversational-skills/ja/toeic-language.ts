import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { languageCatalog } from './language-catalog';
import { buildNewBeginningLesson, storyLessonNumbers, type StoryLessonNumber } from './level-3-chapter-1/new-beginning';
import { languageEpisodeErrors } from './language-validation';
import { conversationalLanguageInstructions, conversationalLanguageTarget } from '../../../../shared/conversationalLanguage';

export function readLanguageRevision(level: number, chapter: number, number: number): any {
  const result = JSON.parse(readFileSync(resolve(import.meta.dir, `toeic-revisions-v1/L${level}-C${chapter}-${number}.json`), 'utf8'));
  if (result.version !== 'toeic-v1' || result.level !== level || result.chapter !== chapter || result.number !== number || !result.review.approved || result.review.issues.length) throw Error('Missing or unapproved language revision');
  const errors = languageEpisodeErrors(result.episode, level, result.episode.skill);
  if (errors.length) throw Error(errors.join('; '));
  return result;
}

// Media, scores and learner records are not language-editing surfaces.
function preserveMedia(original: any, revised: any): any {
  if (!original || !revised || typeof original !== 'object' || typeof revised !== 'object') return revised;
  if (Array.isArray(original) && Array.isArray(revised)) return revised.map((v, i) => preserveMedia(original[i], v));
  for (const [key, value] of Object.entries(original)) {
    if (/image|background/i.test(key)) revised[key] = structuredClone(value);
    else if (key in revised) revised[key] = preserveMedia(value, revised[key]);
  }
  return revised;
}

export function buildToeicLesson(level: number, chapter: number, number: StoryLessonNumber, previous: any = {}, reference?: any): any {
  const definition = languageCatalog.find(c => c.level === level && c.chapter === chapter);
  if (!definition) throw Error('No authored story at this level/chapter');
  const revision = readLanguageRevision(level, chapter, number);
  const e = revision.episode;
  if (e.skill !== definition.episodes[number].skill) throw Error('Language editing changed the lesson skill');
  const base: any = definition.build(number, previous, reference);
  const index = storyLessonNumbers.indexOf(number);
  const previousSummary = index > 0 ? readLanguageRevision(level, chapter, storyLessonNumbers[index - 1]!).episode.closing :
    level === 5 ? 'Mika moves from Osaka to start a new job in Tokyo.' : base.storyData.previousSummary;
  const text = buildNewBeginningLesson(number, previous, 'https://api.fluentxverse.com', reference, {
    episode: e, id: base.id, chapterName: base.chapterName, setting: base.storyData.setting,
    previousSummary, storyNotes: `${conversationalLanguageInstructions(level)}\nKeep this chapter's plot and all stated facts. Use the current TOEIC language revision for authoring.`,
  });
  const lesson = { ...previous, ...base, ...text, id: previous.id || base.id, course: 'conversational-skills', level, chapter, lessonNumber: number,
    status: previous.status || base.status || 'draft', levelBadge: base.levelBadge, chapterLabel: base.chapterLabel,
    authoringLanguageTarget: `TOEIC ${conversationalLanguageTarget(level)!.toeicMin}-${conversationalLanguageTarget(level)!.toeicMax}`,
    authoringLanguageRevision: 'toeic-v1' };
  lesson.storyData.characters = structuredClone(base.storyData.characters);
  if (level === 5) {
    lesson.storyData.storyTitle = 'Tokyo After Hours';
    lesson.storyData.characters = [
      { id: 'mika', name: 'Mika Tanaka', role: 'main', description: 'A new marketing worker from Osaka. She asks questions and learns about the team.' },
      { id: 'ethan', name: 'Ethan', role: 'supporting', description: 'Project manager from Bristol. He shares work with the team and sometimes disagrees with Daichi.' },
      { id: 'soo-jin', name: 'Soo-jin', role: 'supporting', description: 'Creative director from Seoul. She helps Mika and leads the design work.' },
      { id: 'daichi', name: 'Daichi', role: 'supporting', description: 'Senior analyst. He checks research and financial reports. His knowledge of the printer document is not explained yet.' },
    ];
  }
  const learn = lesson.learnData.steps[0];
  learn.discussionPart.tutorSteps[2].tip = 'Use the character details. Accept short, clear answers.';
  lesson.stepBData.grammarTip.tutorSteps[1].tip = 'Use a simple example from this scene. Give one short correction if needed.';
  if (level === 5) learn.pronunciationPart = structuredClone(base.learnData.steps[0].pronunciationPart);
  if (level === 3 && chapter === 4 && number === 9) {
    const guide = lesson.missionData.tutorSteps[1];
    guide.scripts.push(
      {text:'Now I will be the agency recruiter. Please stay as Emma. I will start the call.'},
      {text:'Hello Emma. What would you like to ask about our offer?'},
      {text:'The offer is five office days. What plan do you suggest?'},
      {text:'We can consider two office days and three Kyoto workdays. I must ask the team first.'},
      {text:'We expect an answer by Monday morning, before the five p.m. reply deadline. Is the plan approved yet?'},
    );
    guide.tips.unshift({text:'Use two short dialogues. Start as Leo, then announce the recruiter role and start again. The request is still pending, not approved.'});
  }
  if (level === 4 && chapter === 5 && number === 9) {
    lesson.missionData.tutorSteps[1].scripts.push(
      {text:'Now I will be the new resident. Please stay as Emma. I will start.'},
      {text:'Hello. Is this Kamo House? I am moving in today.'},
    );
  }
  return preserveMedia(Object.keys(previous).length ? previous : base, lesson);
}
