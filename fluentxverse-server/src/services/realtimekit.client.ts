import { createHash } from 'node:crypto';

export type ClassroomMediaProvider = 'webrtc' | 'realtimekit';
export type ClassroomRole = 'student' | 'tutor';
type Env = Record<string, string | undefined>;

export interface ProviderRecording {
  id: string;
  status: 'INVOKED' | 'RECORDING' | 'PAUSED' | 'UPLOADING' | 'UPLOADED' | 'ERRORED';
  invoked_time: string;
  started_time?: string;
  stopped_time?: string;
  download_url?: string;
  download_url_expiry?: string;
  file_size?: number;
  meeting?: { id: string };
}

export function desiredMediaProvider(bookingId: string, env: Env = process.env): ClassroomMediaProvider {
  const provider = env.CLASSROOM_MEDIA_PROVIDER || 'webrtc';
  if (!['webrtc', 'realtimekit'].includes(provider)) throw new Error('Invalid classroom media provider');
  const pilots = (env.CLOUDFLARE_RTK_PILOT_BOOKING_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  return provider === 'realtimekit' || pilots.includes(bookingId) ? 'realtimekit' : 'webrtc';
}

export function opaqueMediaId(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export class RealtimeKitClient {
  constructor(private env: () => Env = () => process.env,
    private request: (url: string, init: RequestInit) => Promise<Response> = fetch) {}

  private async call<T>(path: string, method: string, body?: unknown, allowMissing = false): Promise<T> {
    const env = this.env();
    const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_RTK_APP_ID: app, CLOUDFLARE_RTK_API_TOKEN: token } = env;
    if (!account || !app || !token) throw new Error('RealtimeKit server configuration is missing');
    let response: Response;
    try {
      response = await this.request(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/realtime/kit/${encodeURIComponent(app)}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error('RealtimeKit request failed or timed out');
    }
    if (allowMissing && response.status === 404) return undefined as T;
    if (!response.ok) throw new Error(`RealtimeKit request failed (HTTP ${response.status})`);
    let result: { success?: boolean; data?: T };
    try { result = await response.json() as typeof result; } catch { throw new Error('Invalid RealtimeKit response'); }
    if (result.success !== true || result.data === undefined) throw new Error('Invalid RealtimeKit response');
    return result.data;
  }

  async createMeeting(bookingId: string) {
    const result = await this.call<{ id: string }>('/meetings', 'POST', {
      title: `fxv-${opaqueMediaId(bookingId)}`, record_on_start: false,
      persist_chat: false, live_stream_on_start: false, summarize_on_end: false,
    });
    if (!result.id) throw new Error('RealtimeKit did not return a meeting ID');
    return result.id;
  }

  async ensureMeeting(bookingId: string) {
    const title = `fxv-${opaqueMediaId(bookingId)}`;
    const meetings = await this.call<Array<{ id: string; title: string; status: string }>>(`/meetings?search=${encodeURIComponent(title)}&per_page=100`, 'GET');
    if (!Array.isArray(meetings)) throw new Error('Invalid RealtimeKit meeting list');
    const matches = meetings.filter(meeting => meeting.title === title);
    if (matches.length > 1) throw new Error('RealtimeKit meeting mapping needs review');
    const existing = matches[0];
    if (existing && existing.status !== 'ACTIVE') throw new Error('This lesson call has ended');
    return existing?.id || this.createMeeting(bookingId);
  }

  async ensureParticipant(meetingId: string, userId: string, role: ClassroomRole) {
    const customId = opaqueMediaId(`${meetingId}:${role}:${userId}`);
    const participants = await this.call<Array<{ id: string; custom_participant_id: string }>>(`/meetings/${encodeURIComponent(meetingId)}/participants?per_page=100`, 'GET');
    if (!Array.isArray(participants)) throw new Error('Invalid RealtimeKit participant list');
    const existing = participants.find(participant => participant.custom_participant_id === customId);
    // Recover provider success followed by a timeout/DB failure without creating duplicates.
    return existing ? { id: existing.id, token: await this.refreshToken(meetingId, existing.id) }
      : this.addParticipant(meetingId, userId, role);
  }

  async addParticipant(meetingId: string, userId: string, role: ClassroomRole) {
    // Neither classroom role receives provider-admin or client-recording permissions.
    const env = this.env();
    const preset = env[role === 'tutor' ? 'CLOUDFLARE_RTK_TUTOR_PRESET' : 'CLOUDFLARE_RTK_STUDENT_PRESET'] || 'group_call_participant';
    const result = await this.call<{ id: string; token: string }>(`/meetings/${encodeURIComponent(meetingId)}/participants`, 'POST', {
      custom_participant_id: opaqueMediaId(`${meetingId}:${role}:${userId}`), preset_name: preset,
      name: role === 'tutor' ? 'Tutor' : 'Student',
    });
    if (!result.id || !result.token) throw new Error('RealtimeKit did not return participant credentials');
    return { id: result.id, token: result.token };
  }

  async refreshToken(meetingId: string, participantId: string) {
    const result = await this.call<{ token: string }>(`/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}/token`, 'POST');
    if (!result.token) throw new Error('RealtimeKit did not return a participant token');
    return result.token;
  }

  async closeMeeting(meetingId: string) {
    const id = encodeURIComponent(meetingId);
    await this.call(`/meetings/${id}`, 'PATCH', { status: 'INACTIVE' });
    await this.call(`/meetings/${id}/active-session/kick-all`, 'POST', undefined, true);
  }

  async liveParticipantIds(meetingId: string): Promise<string[]> {
    const session = await this.call<{ id: string; status: string }>(`/meetings/${encodeURIComponent(meetingId)}/active-session`, 'GET', undefined, true);
    if (!session || session.status !== 'LIVE') return [];
    const result = await this.call<{ participants?: Array<{ custom_participant_id?: string; joined_at?: string; left_at?: string }> }>(
      `/sessions/${encodeURIComponent(session.id)}/participants?per_page=100`, 'GET');
    if (!Array.isArray(result.participants)) throw new Error('Invalid RealtimeKit live participants');
    return result.participants.filter(p => p.joined_at && !p.left_at && p.custom_participant_id).map(p => p.custom_participant_id!);
  }

  async recordings(meetingId: string) {
    const result = await this.call<ProviderRecording[]>(`/recordings?meeting_id=${encodeURIComponent(meetingId)}&per_page=100&sort_order=DESC`, 'GET');
    if (!Array.isArray(result) || result.length >= 100) throw new Error('RealtimeKit recording list needs review');
    if (result.some(recording => !recording.id || (recording.meeting && recording.meeting.id !== meetingId)))
      throw new Error('Invalid RealtimeKit recording mapping');
    return result;
  }

  async recording(id: string) {
    const result = await this.call<ProviderRecording>(`/recordings/${encodeURIComponent(id)}`, 'GET');
    if (result.id !== id) throw new Error('Invalid RealtimeKit recording ID');
    return result;
  }

  startRecording(meetingId: string, seconds: number) {
    return this.call<ProviderRecording>('/recordings', 'POST', {
      meeting_id: meetingId, allow_multiple_recordings: false,
      max_seconds: Math.max(5, Math.min(3600, Math.ceil(seconds))),
      realtimekit_bucket_config: { enabled: true },
      video_config: { codec: 'H264', export_file: true, width: 1280, height: 720 },
    });
  }

  stopRecording(id: string) { return this.call(`/recordings/${encodeURIComponent(id)}`, 'PUT', { action: 'stop' }); }
}
