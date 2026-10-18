import { afterAll, describe, expect, test } from 'bun:test';
import { ChatService } from '../src/services/chat.services/chat.service';
import { query } from '../src/db/postgres';

const suite = process.env.CHAT_MATERIAL_DB_TEST === 'true' ? describe : describe.skip;
const sessionId = `share-test-${crypto.randomUUID()}`;
const service = new ChatService();
const material = { id: 'published-material', courseId: 'business-english' as const, title: 'At work', level: 1, chapter: 2, lessonNumber: 3 };

suite('material messages in Postgres', () => {
  afterAll(async () => { await query('DELETE FROM chat_messages WHERE session_id = $1', [sessionId]); });

  test('stores structured metadata, restores it from history, and disallows text editing', async () => {
    const saved = await service.saveMessage({ sessionId, senderId: 'fixture-student', senderType: 'student', text: 'Shared material: At work', material });
    expect(saved.material).toEqual(material);
    const history = await new ChatService().getSessionMessages(sessionId);
    expect(history.find(message => message.id === saved.id)?.material).toEqual(material);
    expect(await service.editMessage(saved.id, sessionId, 'fixture-student', 'student', 'Changed')).toBeNull();
    expect(await service.softDeleteMessage(saved.id, sessionId, 'fixture-student', 'student')).toBe(true);
    expect(await service.getSessionMessages(sessionId)).toHaveLength(0);
  });

  test('normal chat remains editable and has no material', async () => {
    const saved = await service.saveMessage({ sessionId, senderId: 'fixture-student', senderType: 'student', text: 'Hello' });
    expect(saved.material).toBeNull();
    expect((await service.editMessage(saved.id, sessionId, 'fixture-student', 'student', 'Hello again'))?.display_text).toBe('Hello again');
  });
});
