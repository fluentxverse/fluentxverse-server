import { afterAll, expect, mock, test } from 'bun:test';

let responseText = '';
let vocabularyInstructions = '';
mock.module('../src/services/agentFactory', () => ({
  createAgent: (config: { name: string; instructions: string }) => {
    if (config.name === 'Vocabulary Helper') vocabularyInstructions = config.instructions;
    return { generate: async () => ({ text: responseText }) };
  },
}));
const { getVocabularyDefinition } = await import('../src/services/ai.service');
afterAll(() => mock.restore());

test('requests Japanese with matching Hepburn romaji for every meaning', () => {
  expect(vocabularyInstructions).toContain('Japanese only');
  expect(vocabularyInstructions).toContain('Do not generate Korean or Vietnamese');
  for (const field of ['koreanNative', 'koreanRomanized', 'vietnameseNative', 'vietnameseRomanized']) {
    expect(vocabularyInstructions).not.toContain(field);
  }
  expect(vocabularyInstructions).toContain('plain Hepburn romaji');
  expect(vocabularyInstructions).toContain('Include both Japanese fields for every meaning');
});

test('returns Japanese and romaji separately for each selected meaning', async () => {
  const definitions = [
    { meaning: 'Possible effects or results', partOfSpeech: 'noun', japaneseNative: '影響、結果', japaneseRomanized: 'eikyou, kekka', koreanNative: '함의, 영향', koreanRomanized: 'hamui, yeonghyang', vietnameseNative: 'hàm ý, hệ quả', vietnameseRomanized: 'ham y, he qua' },
    { meaning: 'An indirectly suggested meaning', partOfSpeech: 'noun', japaneseNative: '含意', japaneseRomanized: "gan'i" },
  ];
  responseText = '```json\n' + JSON.stringify({ definitions }) + '\n```';
  const result = await getVocabularyDefinition('implications');
  expect(result.definitions[0]).toEqual({
    meaning: definitions[0]!.meaning, partOfSpeech: 'noun',
    japaneseNative: definitions[0]!.japaneseNative, japaneseRomanized: definitions[0]!.japaneseRomanized,
  });
  expect(result.definitions[1]?.japaneseNative).toBe('含意');
  expect(result.definitions[1]?.japaneseRomanized).toBe("gan'i");
});

test('legacy AI responses remain usable without inventing Japanese translations', async () => {
  responseText = JSON.stringify({ definitions: [{ meaning: 'Possible effects', partOfSpeech: 'noun', koreanNative: '영향' }] });
  const result = await getVocabularyDefinition('implications');
  expect(result.definitions[0]?.japaneseNative).toBe('');
  expect(result.definitions[0]?.japaneseRomanized).toBe('');
  expect(result.definitions[0]).not.toHaveProperty('koreanNative');
  expect(result.definitions[0]).not.toHaveProperty('vietnameseNative');
});

test('empty words and missing definitions include safe empty Japanese fields', async () => {
  responseText = JSON.stringify({ definitions: [] });
  for (const word of ['', 'unknown']) {
    const result = await getVocabularyDefinition(word);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]?.japaneseNative).toBe('');
    expect(result.definitions[0]?.japaneseRomanized).toBe('');
  }
});
