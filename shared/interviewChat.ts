export const INTERVIEW_MESSAGE_LIMIT = 2000;
export interface InterviewMessage { id: string; text: string; mine: boolean; }

export function interviewText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text || text.length > INTERVIEW_MESSAGE_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

export function decodeInterviewMessage(value: unknown): { id: string; text: string } | null {
  if (typeof value !== 'string' || value.length > 14000) return null;
  try {
    const data = JSON.parse(value);
    if (data?.type !== 'text' || typeof data.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(data.id)) return null;
    const text = interviewText(data.text);
    return text ? { id: data.id, text } : null;
  } catch { return null; }
}
