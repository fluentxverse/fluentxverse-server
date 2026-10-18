import { describe, expect, test } from 'bun:test';
import neo4j from 'neo4j-driver';
import { readFileSync } from 'node:fs';
import { adminActivityTimestamp, newestActivityFirst } from '../src/utils/adminActivityTimestamp';

describe('admin activity timestamps', () => {
  const instant = '2026-10-12T01:30:00.000Z';
  test('normalizes persisted integers, Date values, and explicit time zones without changing the instant', () => {
    const milliseconds = Date.parse(instant);
    for (const value of [milliseconds, String(milliseconds), neo4j.int(milliseconds), new Date(instant), '2026-10-12T09:30:00+08:00']) {
      expect(adminActivityTimestamp(value)).toBe(instant);
    }
    const temporal = new neo4j.types.DateTime(2026, 10, 12, 9, 30, 0, 0, 28800);
    expect(adminActivityTimestamp(temporal)).toBe(instant);
    for (const microseconds of [milliseconds*1000,neo4j.int(milliseconds*1000),String(milliseconds*1000+123)]) {
      expect(adminActivityTimestamp(microseconds)).toBe(instant);
    }
  });
  test('never invents a new timestamp for missing, invalid, or unsupported values', () => {
    for (const value of [undefined, null, '', 'invalid', NaN, Infinity, 1e20, {}, '2026-10-12T09:30:00', {toNumber:()=>{throw new Error('invalid')}}]) {
      expect(adminActivityTimestamp(value)).toBeNull();
      expect(adminActivityTimestamp(value)).toBeNull();
    }
    expect(adminActivityTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  });
  test('sorts by event time with unknown dates last', () => {
    const rows = [{timestamp:null},{timestamp:instant},{timestamp:'2026-10-13T01:30:00.000Z'},{timestamp:null}];
    expect(rows.sort(newestActivityFirst).map(row=>row.timestamp)).toEqual(['2026-10-13T01:30:00.000Z',instant,null,null]);
  });
  test('all student creation flows persist an immutable registration field', () => {
    const auth = readFileSync(new URL('../src/services/auth.services/student.service.ts', import.meta.url),'utf8');
    expect(auth.match(/registeredAt: \$signUpdate/g)).toHaveLength(3);
    expect(auth).not.toMatch(/SET s\.registeredAt/);
    const admin = readFileSync(new URL('../src/services/admin.services/admin.service.ts',import.meta.url),'utf8');
    const activity = admin.slice(admin.indexOf('async getRecentActivity'),admin.indexOf('async login'));
    expect(activity).toContain('coalesce(s.registeredAt, s.createdAt)');
    expect(activity).not.toContain('s.signUpdate as timestamp');
    expect(activity).not.toContain('new Date().toISOString()');
    expect(activity).not.toContain('Math.ceil(limit / 2)');
  });
});
