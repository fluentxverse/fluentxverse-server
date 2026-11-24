import { z } from 'zod';
import { conversationalLanguageTarget } from '../../../../shared/conversationalLanguage';

const pair = z.array(z.string()).length(2);
export const languageEpisodeSchema = z.object({
  title: z.string(), skill: z.enum(['speaking', 'listening', 'reading']), intro: pair, goal: pair, warmup: z.string(),
  words: z.array(z.array(z.string()).length(3)).length(6), discussion: pair, followup: z.string(),
  tips: z.array(z.object({ rule: pair, examples: z.array(pair).min(1).max(2) })).length(2),
  apply: z.object({ situation: pair, roles: pair.nullable(), dialogue: z.array(pair), text: z.string(), questions: z.array(pair).min(3).max(4) }),
  choose: z.array(pair).length(6), choices: z.array(z.array(z.string()).length(4)).length(4),
  mission: z.object({ situation: pair, task: pair, roles: pair, text: z.string(), title: z.string(), lines: z.array(z.string()).min(4).max(7), evidence: z.string(), useful: z.array(z.string()).min(5).max(6) }),
  topics: z.array(z.object({ title: z.string(), questions: z.array(z.string()).length(3) })).length(3),
  trivia: pair, triviaQuestion: pair, closing: z.string(),
});
export function normalizeLanguageEpisode(value: z.infer<typeof languageEpisodeSchema>): any {
  const e: any = { ...value, apply: { ...value.apply }, topics: value.topics.map(t => [t.title, t.questions]) };
  if (!e.apply.roles) delete e.apply.roles;
  return e;
}
export const wordCount = (value: string) => value.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
export function languageEpisodeErrors(e: any, level: number, skill: string): string[] {
  const p = conversationalLanguageTarget(level)!;
  const errors: string[] = [];
  const limit = (v: string, max: number, name: string) => { if (wordCount(v) > max) errors.push(`${name}: ${wordCount(v)} words, maximum ${max}`); };
  if (e.skill !== skill) errors.push('Skill changed');
  if (!/^I can /.test(e.goal[0]) || /\byourself\b/.test(e.goal[0])) errors.push('Objective must use first-person I can wording');
  for (const [value, size, label] of [[e.words,6,'Vocabulary'],[e.tips,2,'Tips'],[e.choose,6,'Step A'],[e.choices,4,'Step B'],[e.topics,3,'Topics']] as const) if (!Array.isArray(value) || value.length !== size) errors.push(`${label} count changed`);
  if (!e.mission.roles || e.mission.roles.length !== 2 || e.mission.roles.some((r:string)=>/^(?:Tutor|Student|Teacher|Learner)$/i.test(r) || /invented/i.test(r))) errors.push('Direct character roles required');
  if (e.mission.lines.length < 4 || e.mission.lines.length > 7 || e.mission.useful.length < 5 || e.mission.useful.length > 6) errors.push('Incomplete mission prompts or useful language');
  for (const [sentence,phrase] of e.words) if (!sentence.toLowerCase().includes(phrase.toLowerCase())) errors.push('Vocabulary highlight absent from its example');
  limit(e.intro[0], p.maxIntroWords, 'Introduction');
  limit(e.goal[0], 15, 'Goal');
  if (skill === 'speaking') {
    if (e.apply.dialogue?.length !== 10 || e.apply.roles?.length !== 2) errors.push('Speaking requires ten lines and two roles');
    limit((e.apply.dialogue || []).map((l: string[]) => l[1]).join(' '), p.maxDialogueWords, 'Dialogue');
    (e.apply.dialogue || []).forEach((l: string[], i: number) => { if (l[0] !== e.apply.roles?.[i % 2]) errors.push('Speaking role order changed'); });
  } else {
    if (!e.apply.text || !e.mission.text || e.apply.text === e.mission.text) errors.push('Distinct complete receptive texts required');
    const max = skill === 'reading' ? p.maxReadingWords : p.maxListeningWords;
    limit(e.apply.text, max, 'Apply text'); limit(e.mission.text, max, 'Mission text');
    if (e.apply.dialogue?.length) errors.push('Receptive source must not be a visible dialogue');
  }
  for (const [sentence, answer] of e.choose) if (!sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ').includes(answer)) errors.push('Step A key does not match options');
  for (const choice of e.choices) if (!['A', 'B'].includes(choice[3]) || choice[1] === choice[2]) errors.push('Invalid Step B key or choices');
  const facing = [e.intro[0], e.goal[0], e.discussion[0], ...e.words.map((v: string[]) => v[0]), ...e.tips.flatMap((t: any) => [t.rule[0], ...t.examples.map((x: string[]) => x[0])]), e.apply.situation[0], e.apply.text, ...(e.apply.dialogue || []).map((x: string[]) => x[1]), e.mission.situation[0], e.mission.task[0], e.mission.text, ...e.mission.lines, ...e.mission.useful].join(' ');
  if (/invented adult|You may play|No personal or romantic|\bmonologue\b|B[12][–-]C[12]/i.test(facing)) errors.push('Unwanted role/level instructions');
  if (/provided that|not entirely convinced|had been deleted|would have been|could have been/i.test(facing)) errors.push('Unnecessarily advanced target language');
  if (level === 3 && /acquaintance|in hindsight|hypothetical|whether|would have|should have|could have|had been/i.test(facing)) errors.push('Use basic Level 3 wording and grammar');
  if (level === 5 && /\b(?:boyfriend|girlfriend|romantic|dating)\b|I am single/i.test(JSON.stringify(e))) errors.push('Unwanted Tokyo romance retained');
  for (const text of [e.intro[1], e.goal[1], e.discussion[1], e.apply.situation[1], e.mission.situation[1], e.mission.task[1], e.trivia[1], ...e.words.map((v: string[]) => v[2])]) if (!/[ぁ-んァ-ン\p{Script=Han}]/u.test(text)) errors.push('Missing Japanese support');
  return [...new Set(errors)];
}
