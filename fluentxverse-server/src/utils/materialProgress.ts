export type MaterialCompletionStatus = 'in_progress' | 'completed';
export interface MaterialSection { id: string; label: string }

export const isExcludedConversationalStoppingPoint = (id: string, label?: string | null): boolean =>
  /^(missionData\d*|feedbackData)(\.|$)/.test(id) || /^Part [56]\b/.test(label || '');

export const isExcludedBusinessStoppingPoint = (id: string): boolean => /^(discussion|feedback)(\.|$)/.test(id);

const title = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim()
  ? value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().slice(0, 200) : fallback;
const part = (number: unknown, fallback: number, name: string) => `Part ${typeof number === 'number' && number > 0 ? number : fallback} - ${name}`;

// IDs are structural paths; labels are saved separately so historical notes survive title edits.
export function materialSections(materialType: string, lesson: any): MaterialSection[] {
  if (materialType === 'daily-dispatch') return [];
  const sections: MaterialSection[] = [];
  const add = (id: string, label: string) => sections.push({ id, label });
  if (materialType === 'business-english') {
    add('introduce', 'Part 1 - Warm-up');
    add('present', 'Part 2 - Key expressions');
    add('understand', 'Part 3 - Comprehension');
    add('practice', 'Part 4 - Drill');
    for (const [index, step] of (lesson?.beData?.practice?.steps || []).entries()) {
      add(`practice.steps.${index}`, `Part 4 - Drill - ${title(step.title, `Step ${index + 1}`)}`);
    }
    add('challenge', 'Part 5 - Simulation');
    return sections;
  }
  if (materialType !== 'conversational-skills') return [];
  add('introduction', 'Part 1 - Introduce');
  const learn = part(2, 2, title(lesson?.learnData?.sectionTitle, 'Learn'));
  add('learn', learn);
  for (const [index, step] of (lesson?.learnData?.steps || []).entries()) {
    const label = `${learn} - ${title(step.stepName, `Step ${index + 1}`)}`;
    add(`learn.steps.${index}`, label);
    if (step.discussionPart) add(`learn.steps.${index}.discussion`, `${label} - Discussion`);
    if (step.pronunciationPart) add(`learn.steps.${index}.pronunciation`, `${label} - Pronunciation`);
  }
  if (lesson?.stepBData) {
    const data = lesson.stepBData;
    const field = { 'speak-your-mind': 'speakYourMind', 'grammar-tip': 'grammarTip', pronunciation: 'pronunciation' }[data.stepType as string];
    add('learn.stepB', `${learn} - ${title(data.stepName || (field && data[field]?.stepName), 'Step B')}`);
  }
  for (const [key, number, fallback] of [
    ['applyData', 3, 'Apply'], ['exerciseData', 4, 'Exercise'],
  ] as const) {
    const data = lesson?.[key];
    if (!data) continue;
    const label = part(data.sectionNumber, number, title(data.sectionTitle, fallback));
    if (isExcludedConversationalStoppingPoint(key, label)) continue;
    add(key, label);
    if (key === 'exerciseData' && data.hasStepB) {
      add(`${key}.stepA`, `${label} - ${title(data.stepAName, 'Step A')}`);
      add(`${key}.stepB`, `${label} - ${title(data.stepBName, 'Step B')}`);
    }
  }
  return sections;
}
