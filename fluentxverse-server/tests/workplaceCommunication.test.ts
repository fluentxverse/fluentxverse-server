import { describe, expect, test } from 'bun:test';
import { createWorkplaceTemplate, parseWorkplaceData } from '../../shared/workplaceCommunication';

describe('Workplace Communication document validation', () => {
  test('both formats survive stored JSON round trips with independent content', () => {
    for (const mode of ['prepare', 'perform'] as const) {
      const data = createWorkplaceTemplate(mode);
      const first = data.sections[0]; if (!first) throw Error('Expected the workplace brief section');
      data.translationLanguage = 'ja';
      first.content = 'A new colleague arrives.\nAsk about their role.';
      first.translation = '新しい同僚を迎えましょう。';
      first.tutorNotes = 'Tutor opens the conversation.';
      expect(parseWorkplaceData(JSON.stringify(data))).toEqual(data);
      expect(createWorkplaceTemplate(mode).sections[0]?.content).toBe('');
    }
  });

  test('rejects corrupt storage and mismatched or duplicated sections', () => {
    for (const value of [null, 1, [], {}, '{', { ...createWorkplaceTemplate('prepare'), mode: 'input' },
      { ...createWorkplaceTemplate('prepare'), sections: createWorkplaceTemplate('perform').sections },
      { ...createWorkplaceTemplate('prepare'), translationLanguage: 'xx' }]) {
      expect(() => parseWorkplaceData(value)).toThrow();
    }
    const duplicate = createWorkplaceTemplate('prepare');
    const first = duplicate.sections[0]; if (!first) throw Error('Expected the workplace brief section');
    duplicate.sections[1] = first;
    expect(() => parseWorkplaceData(duplicate)).toThrow();
    const invalid = createWorkplaceTemplate('perform');
    const invalidFirst = invalid.sections[0]; if (!invalidFirst) throw Error('Expected the workplace brief section');
    invalidFirst.content = 'x'.repeat(20001);
    expect(() => parseWorkplaceData(invalid)).toThrow();
  });
});
