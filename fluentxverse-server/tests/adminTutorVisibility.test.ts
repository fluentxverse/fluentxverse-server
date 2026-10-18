import { expect, test } from 'bun:test';
import neo4j from 'neo4j-driver';
import { adminTutorVisibility } from '../src/utils/adminTutorVisibility';

const now = Date.parse('2026-10-15T00:00:00Z');
test('tutor list exposes the photo and active block with graph timestamps as ISO strings', () => {
  const until = '2026-10-20T00:00:00.000Z';
  expect(adminTutorVisibility({ profilePicture: '/user/photo.png', isBlocked: true, blockExpiresAt: neo4j.types.DateTime.fromStandardDate(new Date(until)) }, now))
    .toEqual({ profilePicture: '/user/photo.png', isBlocked: true, blockExpiresAt: until, penaltyBlockOverrideUntil: undefined });
});
test('expired booking blocks are not shown as active, including the exact expiry boundary', () => {
  for (const until of ['2026-10-14T23:59:59Z', '2026-10-15T00:00:00Z']) {
    expect(adminTutorVisibility({ isBlocked: true, blockExpiresAt: until }, now).isBlocked).toBe(false);
  }
});
test('indefinite blocks remain active; missing flags never invent a block', () => {
  expect(adminTutorVisibility({ isBlocked: true }, now).isBlocked).toBe(true);
  expect(adminTutorVisibility({ isBlocked: true, blockExpiresAt: 'invalid' }, now).isBlocked).toBe(true);
  expect(adminTutorVisibility({}, now).isBlocked).toBe(false);
  expect(adminTutorVisibility({ isBlocked: false, blockExpiresAt: '2026-10-20' }, now).isBlocked).toBe(false);
});
test('waiver and suspension metadata cannot override the actual booking flag in this read-only view', () => {
  const result = adminTutorVisibility({ isBlocked: true, penaltyBlockOverrideUntil: new Date('2026-10-22T00:00:00Z'), suspendedUntil: '2026-11-01', password: 'secret' }, now);
  expect(result.isBlocked).toBe(true);
  expect(result.penaltyBlockOverrideUntil).toBe('2026-10-22T00:00:00.000Z');
  expect(Object.keys(result).sort()).toEqual(['blockExpiresAt', 'isBlocked', 'penaltyBlockOverrideUntil', 'profilePicture']);
});
