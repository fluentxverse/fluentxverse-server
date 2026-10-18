import { describe, expect, test } from 'bun:test';
import { studentIssueReportWindow } from '../src/services/studentLessonIssueReport.service';
import { studentTutorIssues, studentTutorIssueLabel, validateStudentTutorIssue } from '../src/utils/studentTutorIssues';
import { studentTutorIssues as studentChoices } from '../../fluentxverse-student-solid-prototype/student/data/studentTutorIssues';
describe('student lesson issue reporting window', () => {
  const start = '2026-10-07T07:00:00.000Z';
  const deadline = Date.parse(start) + (25 * 60 + 48 * 60 * 60) * 1000;
  test('opens after three minutes for a missing tutor and closes exactly 48 hours after the scheduled end', () => {
    expect(studentIssueReportWindow(start, 25, 'confirmed', Date.parse(start) - 1).eligible).toBe(false);
    expect(studentIssueReportWindow(start, 25, 'confirmed', Date.parse(start)).eligible).toBe(false);
    expect(studentIssueReportWindow(start, 25, 'confirmed', Date.parse(start) + 180000, false).eligible).toBe(true);
    const window = studentIssueReportWindow(start, 25, 'completed', deadline - 1);
    expect(window.eligible).toBe(true); expect(window.closesAt).toBe(new Date(deadline).toISOString());
    expect(studentIssueReportWindow(start, 25, 'completed', deadline).eligible).toBe(false);
  });
  test('cancelled lessons are not reportable', () => {
    expect(studentIssueReportWindow(start, 25, 'cancelled', Date.parse(start)).eligible).toBe(false);
  });
});
describe('tutor-related report choices', () => {
  test('every displayed choice has the same saved code and label', () => {
    expect(studentChoices.map(({ value, label }): [string, string] => [value, label])).toEqual(Object.entries(studentTutorIssues));
    for (const issue of Object.keys(studentTutorIssues)) {
      expect(() => validateStudentTutorIssue('tutor', issue, issue === 'other' ? 'Another issue occurred.' : '')).not.toThrow();
    }
  });
  test('tutor-related reports require a recognized subtype', () => {
    for (const issue of [undefined, '', 'unknown', 'toString']) expect(() => validateStudentTutorIssue('tutor', issue, 'Details')).toThrow('Choose what happened');
    expect(studentTutorIssueLabel(undefined)).toBeNull();
    expect(studentTutorIssueLabel('unknown')).toBeNull();
  });
  test('during the lesson, only the missing-tutor choice is accepted', () => {
    expect(() => validateStudentTutorIssue('tutor', 'no_show', '', true)).not.toThrow();
    expect(() => validateStudentTutorIssue('tutor', 'left_early', '', true, 'left_early')).not.toThrow();
    expect(() => validateStudentTutorIssue('tutor', 'no_show', '', true, 'left_early')).toThrow('current tutor absence');
    for (const issue of Object.keys(studentTutorIssues).filter(key => key !== 'no_show')) expect(() => validateStudentTutorIssue('tutor', issue, 'Details', true)).toThrow('only tutor-related report');
  });
  test('other requires a non-whitespace explanation and unrelated reports cannot carry a tutor issue', () => {
    for (const details of ['', '   \n ']) {
      expect(() => validateStudentTutorIssue('tutor', 'other', details)).toThrow('briefly explain');
      expect(() => validateStudentTutorIssue('other', undefined, details)).toThrow('briefly explain');
    }
    expect(() => validateStudentTutorIssue('other', undefined, 'My other issue')).not.toThrow();
    expect(() => validateStudentTutorIssue('audio', undefined, '')).not.toThrow();
    expect(() => validateStudentTutorIssue('audio', 'no_show', '')).toThrow('only be selected');
  });
});
