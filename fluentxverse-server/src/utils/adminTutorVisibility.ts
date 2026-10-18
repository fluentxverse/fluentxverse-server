function timestamp(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = typeof (value as any).toStandardDate === 'function' ? (value as any).toStandardDate() : value;
  const ms = date instanceof Date ? date.getTime() : Date.parse(String(date));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export function adminTutorVisibility(user: Record<string, any>, now = Date.now()) {
  const blockExpiresAt = timestamp(user.blockExpiresAt);
  return {
    profilePicture: typeof user.profilePicture === 'string' ? user.profilePicture : undefined,
    isBlocked: Boolean(user.isBlocked) && (!blockExpiresAt || Date.parse(blockExpiresAt) > now),
    blockExpiresAt,
    penaltyBlockOverrideUntil: timestamp(user.penaltyBlockOverrideUntil),
  };
}
