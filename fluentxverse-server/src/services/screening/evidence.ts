import { createHash } from 'node:crypto';
import { digest, screeningPolicy, validScore } from './policy';
import { validateWrittenContent, validateSpeakingContent } from '../exam.services/applicationPolicy';

export interface ScreeningEvidence {
  tutorId: string;
  written: { attemptId: string; tutorId: string; score: number; completedAt: string; content: unknown; result: any };
  speaking: { attemptId: string; tutorId: string; score: number; completedAt: string; content: any; result: any; audioEvidence: any[] };
  profile: { approved: boolean; reviewerId: string; reviewedAt: string; record: unknown };
  interview: { passed: boolean; reviewerId: string; completedAt: string; attemptId: string; record: unknown };
}

export function assertScreeningEvidence(evidence: ScreeningEvidence): void {
  for (const exam of [evidence.written, evidence.speaking]) {
    if (!exam.attemptId || exam.tutorId !== evidence.tutorId || exam.result?.tutorId !== evidence.tutorId || exam.result?.examId !== exam.attemptId) throw new Error('Assessment does not belong to this tutor/attempt');
    if (!Number.isFinite(Date.parse(exam.completedAt))) throw new Error('Missing assessment completion time');
    if (!validScore(exam.score)) throw new Error('Assessment score must be an integer in [0,100]');
  }
  if (evidence.written.score < screeningPolicy.writtenThreshold || evidence.speaking.score < screeningPolicy.speakingThreshold) throw new Error('Screening score thresholds not met');
  const written = evidence.written;
  const content = validateWrittenContent(written.content);
  if (!Array.isArray(content?.questions) || !content.questions.length || !Array.isArray(written.result.answers) || written.result.answers.length !== content.questions.length) throw new Error('Written answer evidence is incomplete');
  if (new Set(content.questions.map((question: any) => question.id)).size !== content.questions.length) throw new Error('Written question identifiers must be unique');
  let correct = 0;
  content.questions.forEach((question: any, index: number) => {
    const answer = written.result.answers[index];
    if (answer?.questionId !== question.id || !Number.isInteger(answer.selectedAnswer) || answer.selectedAnswer < -1 || answer.selectedAnswer > 3) throw new Error('Written answer/attempt binding is invalid');
    if (answer.selectedAnswer >= 0 && answer.selectedAnswer === question.correctAnswer) correct++;
  });
  if (Math.round(correct / content.questions.length * 100) !== written.score || written.result.percentage !== written.score || written.result.passed !== true) throw new Error('Written score does not match stored answers');

  const speaking = evidence.speaking;
  if (speaking.result.rubricVersion !== screeningPolicy.rubric || speaking.result.assessmentMode !== 'transcript-content'
    || speaking.result.audioReviewRequired !== true) throw new Error('Speaking evidence must use the approved content rubric and require human audio review');
  const oralContent = validateSpeakingContent(speaking.content);
  if (oralContent.tasks.every(task => task.type === 'read-aloud'))
    throw new Error('Read-aloud-only screening is not approved by the broader certification policy');
  if (speaking.result.overallScore !== speaking.score || speaking.result.passed !== true) throw new Error('Speaking attempt evidence is incomplete');
  const taskIds = oralContent.tasks.map(task => task.id);
  if (new Set(taskIds).size !== taskIds.length || speaking.audioEvidence?.length !== taskIds.length || speaking.result.taskScores?.length !== taskIds.length) throw new Error('Speaking task evidence is incomplete');
  const audioIds = new Set();
  if (speaking.result.taskScores.some((task: any) => !validScore(task.percentage))
    || Math.floor(speaking.result.taskScores.reduce((sum: number, task: any) => sum + task.percentage, 0) / taskIds.length) !== speaking.score) throw new Error('Speaking score does not match task results');
  for (const grade of speaking.result.taskScores) {
    const task = oralContent.tasks.find(task => task.id === grade.taskId);
    const dimensions = ['vocabulary', 'grammar', 'coherence', 'taskCompletion'];
    if (!task || grade.taskType !== task.type || typeof grade.transcription !== 'string' || !grade.scores
      || grade.scores.pronunciation !== null || grade.scores.fluency !== null
      || Object.keys(grade.scores).some(key => ![...dimensions, 'pronunciation', 'fluency'].includes(key))) throw Error('Speaking score dimensions do not match the approved rubric');
    const silent = !grade.transcription.trim();
    if (dimensions.some(name => !Number.isInteger(grade.scores[name]) || (silent ? grade.scores[name] !== 0 : grade.scores[name] < 1 || grade.scores[name] > 5))) throw Error('Invalid oral dimension score');
    const sum = dimensions.reduce((sum, name) => sum + grade.scores[name], 0);
    if (grade.percentage !== sum * 5 || grade.averageScore !== sum / 4) throw Error('Oral percentage does not match dimension scores');
  }
  for (const audio of speaking.audioEvidence) {
    const task = speaking.result.taskScores.find((score: any) => score.taskId === audio.taskId);
    if (audioIds.has(audio.taskId) || !taskIds.includes(audio.taskId) || !task || audio.examId !== speaking.attemptId || audio.tutorId !== evidence.tutorId
      || audio.source !== 'server-transcription' || !/^[a-f0-9]{64}$/.test(audio.audioHash) || audio.transcriptHash !== digest(task.transcription)) throw new Error('Speaking transcript is not bound to authenticated recording evidence');
    audioIds.add(audio.taskId);
  }
  if (!evidence.profile.approved || !evidence.profile.reviewerId || !Number.isFinite(Date.parse(evidence.profile.reviewedAt))) throw new Error('Authorized profile approval required');
  if (!evidence.interview.passed || !evidence.interview.reviewerId || !evidence.interview.attemptId || !Number.isFinite(Date.parse(evidence.interview.completedAt))) throw new Error('Authorized interview pass required');
}

export function decodeSubmittedAudio(url: string): Buffer {
  const match = /^data:audio\/(?:webm|ogg|wav|mpeg|mp4)(?:;codecs=[\w.,-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match || match[1]!.length > 8 * 1024 * 1024) throw new Error('Invalid or oversized audio recording');
  const audio = Buffer.from(match[1]!, 'base64');
  if (audio.length < 64 || audio.toString('base64') !== match[1]) throw new Error('Invalid audio encoding');
  return audio;
}

export async function transcribeBoundRecording(
  tutorId: string, examId: string, taskId: number, audioUrl: string,
  transcribe: (audio: Buffer) => Promise<string>,
) {
  const audio = decodeSubmittedAudio(audioUrl);
  const transcription = await transcribe(audio);
  return {
    transcription,
    evidence: { tutorId, examId, taskId, source: 'server-transcription',
      audioHash: createHash('sha256').update(audio).digest('hex'), transcriptHash: digest(transcription) },
  };
}
