export interface ConversationalLanguageTarget {
  level: number;
  toeicMin: number;
  toeicMax: number;
  maxIntroWords: number;
  maxDialogueWords: number;
  maxListeningWords: number;
  maxReadingWords: number;
  sentenceWords: number;
  supportLanguage: 'ja' | 'en';
  stepAType: 'vocabulary' | 'expressions';
  stepAItemCount: number;
}

// Product authoring targets supplied by the course owner, not CEFR conversions.
export function conversationalLanguageTarget(level: number): ConversationalLanguageTarget | null {
  if (level === 8) return { level, toeicMin: 785, toeicMax: 940, maxIntroWords: 100,
    maxDialogueWords: 220, maxListeningWords: 130, maxReadingWords: 280, sentenceWords: 26,
    supportLanguage: 'en', stepAType: 'expressions', stepAItemCount: 4 };
  if ([6, 7].includes(level)) return { level, toeicMin: 550, toeicMax: 780, maxIntroWords: 90,
    maxDialogueWords: 180, maxListeningWords: 110, maxReadingWords: 220, sentenceWords: 22,
    supportLanguage: 'en', stepAType: 'expressions', stepAItemCount: 4 };
  if (![3, 4, 5].includes(level)) return null;
  return { level, toeicMin: level === 3 ? 10 : 225, toeicMax: level === 3 ? 220 : 545,
    maxIntroWords: level === 3 ? 50 : 65, maxDialogueWords: level === 3 ? 90 : 115,
    maxListeningWords: level === 3 ? 55 : 70, maxReadingWords: level === 3 ? 110 : 145,
    sentenceWords: level === 3 ? 12 : 16, supportLanguage: 'ja', stepAType: 'vocabulary', stepAItemCount: 6 };
}

export const naturalPronunciationInstructions = 'From Level 6 onward, Step B is Pronunciation: teach natural connected speech and meaning groups in phrases and full sentences. Use a short tip and a Phrase/Example table with at least two relevant phrases, readable linking or pause guides, and complete examples. Bold the exact words or syllables that carry stress with <strong>; do not bold the whole sentence. Keep linking and pause marks distinct from stress. Use only Step B Pronunciation. Omit Learn Part III pronunciation entirely; Part II transitions directly to Step B. Do not add commentary about IPA, reading cues or accents to lesson content.';

export function conversationalLanguageInstructions(level: number): string {
  const target = conversationalLanguageTarget(level);
  if (!target) return level >= 6 ? naturalPronunciationInstructions : '';
  if (level === 8) return `Course-owner language target: Level 8, TOEIC 785-940. Use TOEIC 785–940 as the visible level label. This is an authoring range, not a CEFR equivalence or test-score guarantee.
Use nuanced but accessible English: qualified claims, competing perspectives, implications, respectful disagreement and precise questions. Teach relevant multiword expressions through clear English meanings and contextual examples. The reference's C1-C2 subtitle does not replace this score range. Attribute experiences to the speaker; avoid unsupported universal social, medical or legal claims.
English only: no Japanese translations, support paragraphs or bilingual labels. Step A has exactly four expressions instead of vocabulary cards. Keep standard tutor guides, useful language and fixed English feedback. Sensitive topics stay within assigned fictional roles; do not require learners to disclose personal health, family or reproductive experiences.
${naturalPronunciationInstructions}
Speaking is short tutor-first dialogue, not a required monologue. Aim for sentences of at most ${target.sentenceWords} words. Introductions: at most ${target.maxIntroWords}; speaking model: at most ${target.maxDialogueWords}; each private listening script: at most ${target.maxListeningWords}; each reading passage: at most ${target.maxReadingWords}.`;
  if ([6, 7].includes(level)) return `Course-owner language target: Level ${level}, TOEIC 550-780. This is an authoring range, not a CEFR equivalence or test-score guarantee.
Use clear intermediate English, natural multiword expressions, reasons, comparisons, polite clarification and manageable connected sentences. Do not follow an advanced C1 label from a story reference. Explain unfamiliar cultural terms in plain English and attribute local practices to their speaker rather than treating them as universal rules.
English only: no Japanese translations, support paragraphs or bilingual labels. Step A uses exactly four relevant expressions, each with an English meaning and a contextual example, instead of six vocabulary items. Use the existing expressions layout. Keep discussion, pronunciation, useful-language support and standard tutor guides.
${naturalPronunciationInstructions}
Speaking must be tutor-first dialogue, not a required monologue. Aim for sentences of at most ${target.sentenceWords} words. Introductions: at most ${target.maxIntroWords} words; speaking model: at most ${target.maxDialogueWords}; each private listening script: at most ${target.maxListeningWords}; each reading passage: at most ${target.maxReadingWords}.`;
  return `Course-owner language target: Level ${level}, TOEIC ${target.toeicMin}-${target.toeicMax}. This is an authoring range, not a CEFR equivalence or test-score guarantee.
Use ${level === 3 ? 'very basic words, short complete sentences, simple present/past, can, and direct questions. Give one idea at a time. Avoid abstract discussion and complex conditionals.' : 'common everyday/work words, short sentences, simple reasons with because, polite requests and clear questions. Explain essential story words in Japanese. Avoid dense business jargon, complex conditionals and past-perfect passive exercises.'}
Keep the plot, not the difficult wording. Speaking must be a short tutor-first dialogue, not a required monologue. Use Japanese support and useful sentence frames. Aim for sentences of at most ${target.sentenceWords} words. Introductions: at most ${target.maxIntroWords} words; speaking model: at most ${target.maxDialogueWords}; each private listening script: at most ${target.maxListeningWords}; each reading passage: at most ${target.maxReadingWords}. Do not make Level 5 more grammatically advanced than Level 4 merely because its story is set at work.`;
}

// English-only editions retain English rubric wording and empty bilingual fields.
export function clearConversationalTranslations(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clearConversationalTranslations);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /translation|^(?:goal|title).*jp$/i.test(key) ? '' : clearConversationalTranslations(item)]));
}
