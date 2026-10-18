import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { chatHandler } from '../src/socket/handlers/chat.handler';
import { resolveSharedClassroomMaterial } from '../src/services/sharedClassroomMaterial';
import { dispatchService } from '../src/services/dispatch.services/dispatch.service';
import { lessonMaterialService } from '../src/services/lessonMaterial.service';

const material = { id: 'lesson-1', courseId: 'conversational-skills' as const, title: 'Introducing yourself', level: 3, chapter: 1, lessonNumber: 1 };
const request = { sessionId: 'joined-room', courseId: material.courseId, materialId: material.id };

function setup(role = 'student', resolveMaterial = mock(async () => material)) {
  const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
  const rows: any[] = [];
  const service = {
    saveMessage: mock(async (data: any) => {
      const row = { id: 'msg-1', session_id: data.sessionId, sender_id: data.senderId,
        sender_type: data.senderType, message_text: data.text, material: data.material, created_at: new Date() };
      rows.push(row);
      return row;
    }),
    getSessionMessages: mock(async () => rows),
  };
  const emit = mock((..._args: any[]) => {});
  const socket = { data: { userType: role, userId: 'student-1', sessionId: request.sessionId, lessonStartsAt: Date.now() - 1000, lessonEndsAt: Date.now() + 1500000 },
    on: (event: string, handler: any) => { handlers[event] = handler; }, emit: mock((..._args: any[]) => {}) };
  const io = { to: mock(() => ({ emit })), sockets: { sockets: new Map() } };
  chatHandler(io as any, socket as any, { service: service as any, resolveMaterial });
  return { handlers, service, socket, io, emit, resolveMaterial };
}

describe('student material chat messages', () => {
  test('broadcasts canonical material metadata and retains it in chat history', async () => {
    const state = setup();
    const ack = mock((_result: any) => {});
    await state.handlers['chat:share-material']!({ ...request, title: 'Forged title', url: 'https://untrusted.test' }, ack);
    expect(ack).toHaveBeenCalledWith({ success: true });
    expect(state.service.saveMessage.mock.calls[0]![0]).toMatchObject({ senderType: 'student', senderId: 'student-1', material });
    expect(state.emit.mock.calls[0]).toMatchObject(['chat:message', { material, text: 'Shared material: Introducing yourself' }]);
    await state.handlers['chat:request-history']!({ sessionId: request.sessionId });
    expect(state.socket.emit.mock.calls[0]).toMatchObject(['chat:history', [{ material }]]);
    expect(state.service.saveMessage.mock.calls[0]![0].material).not.toHaveProperty('url');
  });

  test('rejects tutor sharing and cross-classroom requests', async () => {
    for (const [role, sessionId] of [['tutor', request.sessionId], ['student', 'another-room']]) {
      const state = setup(role);
      const ack = mock((_result: any) => {});
      await state.handlers['chat:share-material']!({ ...request, sessionId }, ack);
      expect(ack.mock.calls[0]![0]).toMatchObject({ success: false });
      expect(state.resolveMaterial).not.toHaveBeenCalled();
      expect(state.emit).not.toHaveBeenCalled();
    }
  });

  test('rejects missing IDs, unsupported courses and unavailable materials', async () => {
    const state = setup('student', mock(async () => null) as any);
    for (const data of [null, { ...request, materialId: '' }, { ...request, courseId: 'unknown' }, request]) {
      const ack = mock((_result: any) => {});
      await state.handlers['chat:share-material']!(data, ack);
      expect(ack.mock.calls[0]![0]).toMatchObject({ success: false });
    }
    expect(state.service.saveMessage).not.toHaveBeenCalled();
  });

  test('rechecks classroom membership after material lookup', async () => {
    const state = setup();
    state.resolveMaterial.mockImplementation(async () => {
      state.socket.data.sessionId = 'another-room';
      return material;
    });
    const ack = mock((_result: any) => {});
    await state.handlers['chat:share-material']!(request, ack);
    expect(ack.mock.calls[0]![0]).toMatchObject({ success: false });
    expect(state.service.saveMessage).not.toHaveBeenCalled();
  });

  test('keeps structured messages in the existing database-outage fallback', async () => {
    const state = setup();
    state.service.saveMessage.mockImplementation(async () => { throw new Error('DB unavailable'); });
    state.service.getSessionMessages.mockImplementation(async () => { throw new Error('DB unavailable'); });
    state.socket.data.sessionId = 'fallback-material-room';
    await state.handlers['chat:share-material']!({ ...request, sessionId: state.socket.data.sessionId }, mock((_result: any) => {}));
    await state.handlers['chat:request-history']!({ sessionId: state.socket.data.sessionId });
    expect(state.socket.emit.mock.calls[0]).toMatchObject(['chat:history', [{ material }]]);
  });

  test('regular chat cannot forge a structured material', async () => {
    const state = setup();
    await state.handlers['chat:send']!({ sessionId: request.sessionId, text: 'Hello', material });
    expect(state.service.saveMessage.mock.calls[0]![0]).not.toHaveProperty('material');
  });
});

describe('shared material validation', () => {
  afterEach(() => { mock.restore(); });

  test('resolves published articles from the classroom library', async () => {
    spyOn(dispatchService, 'classroomLibrary').mockResolvedValue([{ id: 'article-1', title: 'Science today', category: 'Science', postedDate: '2026-10-06', createdAt: '', status: 'published', topic: 'News' }] as any);
    expect(await resolveSharedClassroomMaterial('daily-dispatch', 'article-1')).toMatchObject({ id: 'article-1', title: 'Science today', courseId: 'daily-dispatch' });
    expect(await resolveSharedClassroomMaterial('daily-dispatch', 'missing')).toBeNull();
  });

  test('requires a published lesson from the requested course', async () => {
    const lookup = spyOn(lessonMaterialService, 'getById');
    lookup.mockResolvedValue({ id: 'lesson-1', course: 'conversational-skills', status: 'draft' } as any);
    expect(await resolveSharedClassroomMaterial('conversational-skills', 'lesson-1')).toBeNull();
    lookup.mockResolvedValue({ id: 'lesson-1', course: 'business-english', status: 'published' } as any);
    expect(await resolveSharedClassroomMaterial('conversational-skills', 'lesson-1')).toBeNull();
    lookup.mockResolvedValue({ id: 'lesson-1', course: 'conversational-skills', status: 'published', lessonTitle: material.title, level: 3, chapter: 1, lessonNumber: 1 } as any);
    expect(await resolveSharedClassroomMaterial('conversational-skills', 'lesson-1')).toEqual(material);
    expect(await resolveSharedClassroomMaterial('unknown', 'lesson-1')).toBeNull();
  });
});
