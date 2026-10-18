import { describe, expect, test } from 'bun:test';
import { buildLevelAssessment } from '../src/services/assessmentProfile';

describe('assessor level profile', () => {
  test('does not derive an assessment from the self-reported level', () => {
    expect(buildLevelAssessment(null, { currentProficiency: 'Level 3' })).toBeNull();
  });

  test('reads a linked assessment and preserves assessor details', () => {
    expect(buildLevelAssessment({
      studentLevel: 'Level 4', curriculum: 'Conversational Skills',
      dateAssessed: '2026-10-04', assessedBy: 'Assessor A', comprehensionScore: 2,
      remarks: ['Good listening']
    }, {})).toEqual({
      studentLevel: 'Level 4', curriculum: 'Conversational Skills',
      dateAssessed: '2026-10-04', assessedBy: 'Assessor A',
      scores: { comprehension: 2, pronunciation: null, grammar: null, maxScore: 3 },
      remarks: ['Good listening']
    });
  });

  test('reads a legacy stored assessment when no linked assessment exists', () => {
    expect(buildLevelAssessment(null, {
      studentLevelAssessment: JSON.stringify({ level: 'Beginner 2', assessor: 'Assessor B' })
    })).toMatchObject({ studentLevel: 'Beginner 2', assessedBy: 'Assessor B' });
  });
});
