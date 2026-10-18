function parseJsonValue(value: any) {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toPlainNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value === 'object' && typeof value.toInt === 'function') return value.toInt();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringArray(value: any): string[] {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof parsed === 'string') {
    return parsed
      .split(/\r?\n|;/)
      .map(item => item.replace(/^[-\u2022]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

export function buildLevelAssessment(rawAssessment: any, studentData: any) {
  const assessment = parseJsonValue(rawAssessment || studentData.studentLevelAssessment || studentData.assessmentResult);
  const source = assessment && typeof assessment === 'object' ? assessment : {};

  const studentLevel = source.studentLevel || source.student_level || source.level || source.levelName || studentData.assessedLevel;
  const curriculum = source.curriculum || source.curriculumName || source.course || source.courseName;
  const dateAssessed = source.dateAssessed || source.assessmentDate || source.assessedAt || source.createdAt || source.updatedAt;
  const assessedBy = source.assessedBy || source.assessor || source.assessorName || source.conductedBy || source.tutorName;
  const maxScore = toPlainNumber(source.maxScore || source.scoreMax || source.score_max) || 3;

  const comprehension = toPlainNumber(source.comprehension ?? source.comprehensionScore ?? source.comprehension_score);
  const pronunciation = toPlainNumber(source.pronunciation ?? source.pronunciationScore ?? source.pronunciation_score);
  const grammar = toPlainNumber(source.grammar ?? source.grammarScore ?? source.grammar_score);
  const remarks = toStringArray(source.remarks || source.assessmentRemarks || source.assessment_remarks);

  const hasAssessmentData = [
    studentLevel,
    curriculum,
    dateAssessed,
    assessedBy,
    comprehension,
    pronunciation,
    grammar,
    ...remarks
  ].some(value => value !== null && value !== undefined && value !== '');

  if (!hasAssessmentData) return null;

  return {
    studentLevel: studentLevel || '',
    curriculum: curriculum || '',
    dateAssessed: dateAssessed || '',
    scores: { comprehension, pronunciation, grammar, maxScore },
    remarks,
    assessedBy: assessedBy || ''
  };
}
