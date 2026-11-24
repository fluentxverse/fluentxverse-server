/** Reject missing required authored data instead of silently producing an incomplete lesson. */
export function requireDefined<T>(value: T, context: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(`Missing required value: ${context}`);
  return value;
}
