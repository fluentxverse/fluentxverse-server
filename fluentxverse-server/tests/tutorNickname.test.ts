import { expect, test } from 'bun:test';
import { tutorPublicName, validateTutorNickname } from '../../shared/tutorPublicName';

test('preferred nicknames allow readable names and reject decorative or private-contact formats', () => {
  for (const value of ['Alex', 'Mary Ann', "D'Anne", 'Anne-Marie', 'Jos\u00e9', 'A'.repeat(24)]) expect(validateTutorNickname(value)).toBe(value);
  expect(validateTutorNickname(' Alex ')).toBe('Alex');
  for (const value of [null, 12, '', 'A', 'A'.repeat(25), 'Alex99', '@Alex', 'Alex@example.com', 'Mary  Ann', 'Mary--Ann', 'Alex\nAnn', '\u{1F600}Alex', '\u{1D400}lex', '\uFF21lex', '\u1D2Clex', '<Alex>']) expect(() => validateTutorNickname(value)).toThrow();
});

test('public tutor names prefer nickname and never fall back to a legal surname or legacy full display name', () => {
  const tutor = { nickname: 'Lex', firstName: 'Alexander', lastName: 'PrivateSurname', displayName: 'Alexander PrivateSurname' };
  expect(tutorPublicName(tutor)).toBe('Lex');
  expect(tutorPublicName({ ...tutor, nickname: undefined })).toBe('Alexander');
  expect(tutorPublicName({ givenName: 'Sam' })).toBe('Sam');
  expect(tutorPublicName({})).toBe('Tutor');
});
