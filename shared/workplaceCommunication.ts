export const WORKPLACE_COMMUNICATION_COURSE = 'workplace-communication';

export type WorkplaceLessonMode = 'prepare' | 'perform';
export type WorkplaceTranslation = 'none' | 'ja' | 'ko';

export const WORKPLACE_TEMPLATES = {
  prepare: [
    { id: 'brief', heading: 'Workplace Brief', minutes: 2 },
    { id: 'words', heading: 'Words at Work', minutes: 3 },
    { id: 'phrases', heading: 'Useful Phrases', minutes: 4 },
    { id: 'responses', heading: 'Response Builder', minutes: 4 },
    { id: 'delivery', heading: 'Delivery Practice', minutes: 3 },
    { id: 'rehearsal', heading: 'Guided Rehearsal', minutes: 7 },
    { id: 'review', heading: 'Progress Review', minutes: 2 },
  ],
  perform: [
    { id: 'brief', heading: 'Workplace Brief', minutes: 2 },
    { id: 'recall', heading: 'Language Refresh', minutes: 2 },
    { id: 'exchange', heading: 'First Exchange', minutes: 4 },
    { id: 'details', heading: 'Handle the Details', minutes: 5 },
    { id: 'task', heading: 'Complete the Task', minutes: 7 },
    { id: 'discussion', heading: 'Beyond the Scenario', minutes: 3 },
    { id: 'review', heading: 'Progress Review', minutes: 2 },
  ],
} as const;

export interface WorkplaceSection {
  id: string;
  content: string;
  translation: string;
  tutorNotes: string;
}

export interface WorkplaceCommunicationData {
  version: 1;
  mode: WorkplaceLessonMode;
  translationLanguage: WorkplaceTranslation;
  sections: WorkplaceSection[];
}

export function createWorkplaceTemplate(mode: WorkplaceLessonMode): WorkplaceCommunicationData {
  return {
    version: 1,
    mode,
    translationLanguage: 'none',
    sections: WORKPLACE_TEMPLATES[mode].map(section => ({
      id: section.id, content: '', translation: '', tutorNotes: '',
    })),
  };
}

export function parseWorkplaceData(value: unknown): WorkplaceCommunicationData {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || data.version !== 1 || !['prepare', 'perform'].includes(data.mode)
    || !['none', 'ja', 'ko'].includes(data.translationLanguage) || !Array.isArray(data.sections)) {
    throw new Error('Invalid Workplace Communication template.');
  }
  const template = WORKPLACE_TEMPLATES[data.mode as WorkplaceLessonMode];
  if (data.sections.length !== template.length || data.sections.some((section: unknown, index: number) => {
    if (!section || typeof section !== 'object') return true;
    const item = section as WorkplaceSection;
    return item.id !== template[index]?.id
      || [item.content, item.translation, item.tutorNotes].some(text => typeof text !== 'string' || text.length > 20000);
  })) {
    throw new Error('Workplace Communication sections do not match the selected template.');
  }
  return {
    version: 1,
    mode: data.mode,
    translationLanguage: data.translationLanguage,
    sections: data.sections.map((section: WorkplaceSection) => ({
      id: section.id, content: section.content, translation: section.translation, tutorNotes: section.tutorNotes,
    })),
  };
}
