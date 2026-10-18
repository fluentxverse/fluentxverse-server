export function adminActivityTimestamp(value: unknown): string | null {
  try {
    if (value == null || value === '') return null;
    let date: Date;
    if (value instanceof Date) date = value;
    else if (typeof value === 'object') {
      const stored = value as { toStandardDate?: () => Date; toNumber?: () => number };
      if (typeof stored.toStandardDate === 'function') date = stored.toStandardDate();
      else if (typeof stored.toNumber === 'function') date = numericDate(stored.toNumber());
      else return null;
    } else if (typeof value === 'number' && Number.isFinite(value)) date = numericDate(value);
    else if (typeof value === 'string') {
      if (/^\d{12,16}$/.test(value)) date = numericDate(Number(value));
      else if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) date = new Date(value);
      else return null;
    } else return null;
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch {
    return null;
  }
}

function numericDate(value: number): Date {
  if (!Number.isSafeInteger(value)) return new Date(NaN);
  // Current Memgraph timestamp() values have 16 digits (microseconds);
  // application Date.now() fields have 13 (milliseconds).
  return new Date(Math.abs(value) >= 100_000_000_000_000 ? Math.trunc(value / 1000) : value);
}

export function newestActivityFirst(a: { timestamp: string | null }, b: { timestamp: string | null }): number {
  const time = (value: string | null) => value == null ? -Infinity : Date.parse(value);
  const first = time(a.timestamp), second = time(b.timestamp);
  return first === second ? 0 : second > first ? 1 : -1;
}
