import { describe, expect, mock, test } from 'bun:test';
import { canEnterClassroom, canCommunicateInClassroom } from '../src/socket/classroomTiming';
import { chatHandler } from '../src/socket/handlers/chat.handler';
import { webrtcHandler } from '../src/socket/handlers/webrtc.handler';

describe('classroom schedule boundaries', () => {
  const start = Date.parse('2026-10-08T10:00:00Z');
  const end = start + 25 * 60000;
  test('entry opens exactly five minutes before start and closes three minutes after lesson end', () => {
    expect(canEnterClassroom(start, end, start - 5 * 60000 - 1)).toBe(false);
    expect(canEnterClassroom(start, end, start - 5 * 60000)).toBe(true);
    expect(canEnterClassroom(start, end, start)).toBe(true);
    expect(canEnterClassroom(start, end, end - 1)).toBe(true);
    expect(canEnterClassroom(start, end, end)).toBe(true);
    expect(canEnterClassroom(start, end, end + 180000 - 1)).toBe(true);
    expect(canEnterClassroom(start, end, end + 180000)).toBe(false);
    expect(canEnterClassroom(NaN, end, start)).toBe(false);
  });
  test('communication opens at the actual start and fails closed without schedule metadata', () => {
    expect(canCommunicateInClassroom(start, end, start - 1)).toBe(false);
    expect(canCommunicateInClassroom(start, end, start)).toBe(true);
    expect(canCommunicateInClassroom(start, end, end + 179999)).toBe(true);
    expect(canCommunicateInClassroom(start, end, end + 180000)).toBe(false);
    expect(canCommunicateInClassroom(undefined, end, start)).toBe(false);
    expect(canCommunicateInClassroom(start, undefined, start)).toBe(false);
    expect(canCommunicateInClassroom(NaN, end, start)).toBe(false);
  });
});

function sockets(role: 'tutor' | 'student') {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const emit = mock((..._args: any[]) => {});
  const broadcast = mock((..._args: any[]) => {});
  const remote = { data: { userId: 'other' }, emit: mock((..._args: any[]) => {}) };
  const fetchSockets = mock(async () => [remote]);
  const socket = { data: { userId: role, userType: role, sessionId: 'room', lessonStartsAt: Date.now() + 60000, lessonEndsAt: Date.now() + 1500000 },
    rooms: new Set(['room']), on: (event: string, fn: any) => { handlers[event] = fn; }, emit,
    to: () => ({ emit: broadcast }) };
  const io = { in: () => ({ fetchSockets }), to: () => ({ emit: broadcast }), sockets: { sockets: new Map() } };
  return { handlers, socket, io, emit, broadcast, remote, fetchSockets };
}

for (const role of ['tutor', 'student'] as const) describe(`${role} waiting-room enforcement`, () => {
  test('chat, files, material messages, edits, deletes and typing are blocked before start', async () => {
    const state = sockets(role);
    const saveMessage = mock(async (data: any) => ({ id: 'message', session_id: data.sessionId, sender_id: data.senderId, sender_type: role, message_text: data.text, created_at: new Date() }));
    const resolveMaterial = mock(async () => null);
    chatHandler(state.io as any, state.socket as any, { service: { saveMessage } as any, resolveMaterial });
    const ack = mock((_result: any) => {});
    await state.handlers['chat:send']!({ sessionId: 'room', text: 'Early hello', fileUrl: '/file.pdf' });
    await state.handlers['chat:edit']!({ sessionId: 'room', messageId: 'message', text: 'Early edit' });
    await state.handlers['chat:delete']!({ sessionId: 'room', messageId: 'message' }, ack);
    await state.handlers['chat:share-material']!({ sessionId: 'room', courseId: 'daily-dispatch', materialId: 'article' }, ack);
    await state.handlers['chat:typing']!({ isTyping: true });
    expect(saveMessage).not.toHaveBeenCalled();
    expect(resolveMaterial).not.toHaveBeenCalled();
    expect(state.broadcast).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ success: false, message: 'Chat opens when the scheduled lesson starts.' });
    state.socket.data.lessonStartsAt = Date.now() - 1000;
    await state.handlers['chat:send']!({ sessionId: 'room', text: 'Hello after start' });
    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(state.broadcast).toHaveBeenCalledWith('chat:message', expect.objectContaining({ text: 'Hello after start' }));
    state.socket.data.lessonEndsAt = Date.now() - 60000;
    await state.handlers['chat:send']!({ sessionId: 'room', text: 'Wrap-up hello' });
    expect(saveMessage).toHaveBeenCalledTimes(2);
    state.socket.data.lessonEndsAt = Date.now() - 180000;
    await state.handlers['chat:send']!({ sessionId: 'room', text: 'Too late' });
    expect(saveMessage).toHaveBeenCalledTimes(2);
  });
  test('WebRTC cannot negotiate or relay media before start, then unlocks without rejoining', async () => {
    const state = sockets(role);
    webrtcHandler(state.io as any, state.socket as any);
    const ack = mock((_result: any) => {});
    state.handlers['webrtc:ready']!();
    await state.handlers['webrtc:offer']!({ to: 'other', offer: {} }, ack);
    await state.handlers['webrtc:answer']!({ to: 'other', answer: {} });
    await state.handlers['webrtc:ice-candidate']!({ to: 'other', candidate: {} });
    expect(state.fetchSockets).not.toHaveBeenCalled();
    expect(state.remote.emit).not.toHaveBeenCalled();
    expect(state.broadcast).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ delivered: false });
    state.socket.data.lessonStartsAt = Date.now() - 1000;
    await state.handlers['webrtc:offer']!({ to: 'other', offer: {} }, ack);
    expect(state.remote.emit).toHaveBeenCalledWith('webrtc:offer', { offer: {}, from: role });
    expect(ack).toHaveBeenCalledWith({ delivered: true });
    state.socket.data.lessonEndsAt = Date.now() - 180000;
    await state.handlers['webrtc:offer']!({ to: 'other', offer: {} }, ack);
    await state.handlers['webrtc:answer']!({ to: 'other', answer: {} });
    await state.handlers['webrtc:ice-candidate']!({ to: 'other', candidate: {} });
    expect(state.remote.emit).toHaveBeenCalledTimes(1);
  });
});
