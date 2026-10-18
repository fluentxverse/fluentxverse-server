import { createHash } from 'node:crypto';
import { digest, screeningPolicy, validScore } from './policy';

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
  const content = written.content as any;
  if (!Array.isArray(content?.questions) || !content.questions.length || !Array.isArray(written.result.answers) || written.result.answers.length !== content.questions.length) throw new Error('Written answer evidence is incomplete');
  if (new Set(content.questions.map((question: any) => question.id)).size !== content.questions.length) throw new Error('Written question identifiers must be unique');
  let correct = 0;
  content.questions.forEach((question: any, index: number) => {
    const answer = written.result.answers[index];
    if (answer?.questionId !== question.id || !Number.isInteger(answer.selectedAnswer) || !Number.isInteger(question.correctAnswer)) throw new Error('Written answer/attempt binding is invalid');
    if (answer.selectedAnswer >= 0 && answer.selectedAnswer === question.correctAnswer) correct++;
  });
  if (Math.round(correct / content.questions.length * 100) !== written.score || written.result.percentage !== written.score) throw new Error('Written score does not match stored answers');

  const speaking = evidence.speaking;
  if (speaking.result.overallScore !== speaking.score || !Array.isArray(speaking.content?.tasks) || !speaking.content.tasks.length) throw new Error('Speaking attempt evidence is incomplete');
  const taskIds = speaking.content.tasks.map((task: any) => task.id);
  if (new Set(taskIds).size !== taskIds.length || speaking.audioEvidence?.length !== taskIds.length || speaking.result.taskScores?.length !== taskIds.length) throw new Error('Speaking task evidence is incomplete');
  const audioIds = new Set();
  if (speaking.result.taskScores.some((task: any) => !validScore(task.percentage))
    || Math.round(speaking.result.taskScores.reduce((sum: number, task: any) => sum + task.percentage, 0) / taskIds.length) !== speaking.score) throw new Error('Speaking score does not match task results');
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
