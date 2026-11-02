export function validateTutorNickname(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter your preferred nickname.');
  const nickname = value.trim().normalize('NFC');
  if (nickname.length < 2 || nickname.length > 24 || nickname.normalize('NFKC') !== nickname || !/^[\p{Script=Latin}]+(?:[ '-][\p{Script=Latin}]+)*$/u.test(nickname)) {
    throw new Error('Use 2-24 letters, with single spaces, hyphens, or apostrophes between names. No numbers, emoji, or decorative characters.');
  }
  return nickname;
}

// Legacy displayName values may contain a surname. Never use them as a public fallback.
export function tutorPublicName(tutor: { nickname?: string | null; firstName?: string | null; givenName?: string | null }): string {
  return tutor.nickname?.trim() || tutor.firstName?.trim() || tutor.givenName?.trim() || 'Tutor';
}
