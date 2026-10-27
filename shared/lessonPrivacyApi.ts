import type { EvidenceField, LessonEvidenceOptions, LessonEvidenceRecord, LessonPrivacyRole } from './lessonPrivacy';

interface PrivacyClient {
  request(config: { url: string; method: 'get' | 'post' | 'put' | 'delete'; data?: unknown; signal?: AbortSignal }): Promise<{ data: any }>;
}
export function createLessonPrivacyApi(client: PrivacyClient) {
  async function request<T>(path: string, method: 'get' | 'post' | 'put' | 'delete' = 'get', body?: unknown, signal?: AbortSignal): Promise<T> {
    const { data } = await client.request({ url: `/lesson-privacy${path}`, method, data: body, signal });
    if (!data.success) throw new Error(data.error || 'Private lesson information is unavailable.');
    return data.data;
  }
  const lesson = (role: LessonPrivacyRole, id: string) => `/${role}/${encodeURIComponent(id)}`;
  return {
    evidenceOptions: (role: LessonPrivacyRole, id: string, signal?: AbortSignal) => request<LessonEvidenceOptions>(`${lesson(role,id)}/evidence`,'get',undefined,signal),
    createEvidence: (role: LessonPrivacyRole, id: string, fields: EvidenceField[]) => request<LessonEvidenceRecord>(`${lesson(role,id)}/evidence`,'post',{fields}),
    supportConsent: (role: LessonPrivacyRole, booking: string, id: string, shared: boolean) => request<void>(`${lesson(role,booking)}/evidence/${encodeURIComponent(id)}/support`,'put',{shared}),
  };
}
export type LessonPrivacyApi = ReturnType<typeof createLessonPrivacyApi>;
