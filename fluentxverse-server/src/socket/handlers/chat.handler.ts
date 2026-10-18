import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData, SharedClassroomMaterial } from '../types/socket.types';
import { ChatService } from '../../services/chat.services/chat.service';
import { resolveSharedClassroomMaterial } from '../../services/sharedClassroomMaterial';
import { canCommunicateInClassroom } from '../classroomTiming';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const defaultChatService = new ChatService();

// In-memory fallback for chat messages when DB is unavailable
interface InMemoryMessage {
  id: string;
  sessionId: string;
  senderId: string;
  senderType: 'tutor' | 'student';
  text: string;
  material?: SharedClassroomMaterial;
  timestamp: string;
  correction?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: 'image' | 'file';
  fileSize?: number;
  editedAt?: string;
  isEdited?: boolean;
  isDeleted?: boolean;
}
const memChatMessages: Record<string, InMemoryMessage[]> = {};

const toClientMessage = (message: Awaited<ReturnType<ChatService['saveMessage']>>): InMemoryMessage => ({
  id: message.id,
  sessionId: message.session_id,
  senderId: message.sender_id,
  senderType: message.sender_type,
  text: message.display_text || message.edited_message_text || message.message_text,
  material: message.material || undefined,
  timestamp: message.created_at.toISOString(),
  correction: message.correction_text || undefined,
  editedAt: message.edited_at?.toISOString(),
  isEdited: Boolean(message.edited_at),
  isDeleted: Boolean(message.is_deleted)
});

export const chatHandler = (io: TypedServer, socket: TypedSocket, dependencies: {
  service?: ChatService;
  resolveMaterial?: typeof resolveSharedClassroomMaterial;
} = {}) => {
  if (socket.data.userType === 'admin') return;
  const chatService = dependencies.service || defaultChatService;
  const resolveMaterial = dependencies.resolveMaterial || resolveSharedClassroomMaterial;
  const loadSessionHistory = async (sessionId: string): Promise<InMemoryMessage[]> => {
    try {
      const messages = await chatService.getSessionMessages(sessionId);
      return messages.map(toClientMessage);
    } catch (dbError) {
      console.warn('⚠️ Using in-memory chat history due to DB error');
      return (memChatMessages[sessionId] || []).filter(message => !message.isDeleted);
    }
  };

  const emitSessionHistory = async (sessionId: string) => {
    const historyMessages = await loadSessionHistory(sessionId);

    io.to(sessionId).emit('chat:history', historyMessages);
    io.sockets.sockets.forEach((clientSocket) => {
      if (clientSocket.data.sessionId === sessionId) {
        clientSocket.emit('chat:history', historyMessages);
      }
    });
  };

  socket.on('chat:share-material', async (data, callback) => {
    const fail = (message: string) => {
      callback?.({ success: false, message });
      if (!callback) socket.emit('chat:error', { message });
    };
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) { fail('Chat opens when the scheduled lesson starts.'); return; }
    if (socket.data.userType !== 'student' || !data || typeof data.sessionId !== 'string'
      || socket.data.sessionId !== data.sessionId) {
      fail('Only the student in this classroom can share a material.');
      return;
    }
    if (typeof data.materialId !== 'string' || !data.materialId.trim() || data.materialId.length > 256
      || !['daily-dispatch', 'conversational-skills', 'business-english'].includes(data.courseId)) {
      fail('Invalid lesson material.');
      return;
    }
    const { sessionId, materialId, courseId } = data;
    const senderId = socket.data.userId;
    try {
      const material = await resolveMaterial(courseId, materialId);
      if (!material) { fail('This material is not available to share.'); return; }
      if (socket.data.sessionId !== sessionId) { fail('The classroom session changed.'); return; }
      const text = `Shared material: ${material.title}`;
      let messageData: InMemoryMessage;
      try {
        messageData = toClientMessage(await chatService.saveMessage({
          sessionId, senderId, senderType: 'student', text, material,
        }));
      } catch {
        messageData = { id: `mem-${crypto.randomUUID()}`, sessionId, senderId,
          senderType: 'student', text, material, timestamp: new Date().toISOString() };
        (memChatMessages[sessionId] ||= []).push(messageData);
      }
      io.to(sessionId).emit('chat:message', messageData);
      callback?.({ success: true });
    } catch (error) {
      console.error('Failed to share classroom material:', error);
      fail('Could not share this material. Please open it again to retry.');
    }
  });

  // Send chat message
  socket.on('chat:send', async (data) => {
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) { socket.emit('chat:error', { message: 'Chat opens when the scheduled lesson starts.' }); return; }
    try {
      const { sessionId, text, correction, fileUrl, fileName, fileType, fileSize } = data;
      if (!sessionId || socket.data.sessionId !== sessionId) return;
      const userId = socket.data.userId;
      const userType = socket.data.userType as 'tutor' | 'student';

      let messageData: InMemoryMessage;

      try {
        // Try to save message to database
        const message = await chatService.saveMessage({
          sessionId,
          senderId: userId,
          senderType: userType,
          text,
          correction
        });

        messageData = {
          ...toClientMessage(message),
          fileUrl,
          fileName,
          fileType,
          fileSize
        };
      } catch (dbError) {
        // Fallback: use in-memory storage
        console.warn('⚠️ Using in-memory chat storage due to DB error');
        messageData = {
          id: `mem-${crypto.randomUUID()}`,
          sessionId,
          senderId: userId,
          senderType: userType,
          text,
          timestamp: new Date().toISOString(),
          correction,
          fileUrl,
          fileName,
          fileType,
          fileSize
        };
        
        // Store in memory
        if (!memChatMessages[sessionId]) {
          memChatMessages[sessionId] = [];
        }
        memChatMessages[sessionId].push(messageData);
      }

      // Broadcast message to all users in the session
      io.to(sessionId).emit('chat:message', messageData);

    } catch (error) {
      console.error('Error handling chat:send:', error);
      socket.emit('chat:message', {
        id: 'error',
        sessionId: data.sessionId,
        senderId: 'system',
        senderType: 'tutor',
        text: 'Failed to send message',
        timestamp: new Date().toISOString(),
        isSystemMessage: true
      });
    }
  });

  socket.on('chat:edit', async (data) => {
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) { socket.emit('chat:error', { message: 'Chat opens when the scheduled lesson starts.' }); return; }
    try {
      const { sessionId, messageId, text } = data;
      if (!sessionId || socket.data.sessionId !== sessionId) return;
      const nextText = text.trim();

      if (!nextText) {
        socket.emit('chat:error', { message: 'Message text is required' });
        return;
      }

      const userId = socket.data.userId;
      const userType = socket.data.userType as 'tutor' | 'student';
      let updatedMessage: InMemoryMessage | null = null;

      try {
        const message = await chatService.editMessage(messageId, sessionId, userId, userType, nextText);
        if (message) {
          updatedMessage = toClientMessage(message);
        }
      } catch (dbError) {
        console.warn('⚠️ Editing in-memory chat message due to DB error');
        const sessionMessages = memChatMessages[sessionId] || [];
        const message = sessionMessages.find(item =>
          item.id === messageId &&
          item.senderId === userId &&
          item.senderType === userType &&
          !item.material &&
          !item.isDeleted
        );

        if (message) {
          message.text = nextText;
          message.editedAt = new Date().toISOString();
          message.isEdited = true;
          updatedMessage = message;
        }
      }

      if (!updatedMessage) {
        socket.emit('chat:error', { message: 'Unable to edit message' });
        return;
      }

      socket.emit('chat:message-updated', updatedMessage);
      socket.to(sessionId).emit('chat:message-updated', updatedMessage);
    } catch (error) {
      console.error('Error handling chat:edit:', error);
      socket.emit('chat:error', { message: 'Failed to edit message' });
    }
  });

  socket.on('chat:delete', async (data, callback) => {
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) { callback?.({ success: false, message: 'Chat opens when the scheduled lesson starts.' }); return; }
    try {
      const { sessionId, messageId } = data;
      const userId = socket.data.userId;
      const userType = socket.data.userType as 'tutor' | 'student';
      let deleted = false;

      if (!sessionId || !messageId) {
        callback?.({ success: false, message: 'Missing message data' });
        socket.emit('chat:error', { message: 'Missing message data' });
        return;
      }

      if (socket.data.sessionId !== sessionId) {
        callback?.({ success: false, message: 'You are not in this classroom session' });
        socket.emit('chat:error', { message: 'You are not in this classroom session' });
        return;
      }

      try {
        deleted = await chatService.softDeleteMessage(messageId, sessionId, userId, userType);
      } catch (dbError) {
        console.warn('⚠️ Deleting in-memory chat message due to DB error');
        const sessionMessages = memChatMessages[sessionId] || [];
        const message = sessionMessages.find(item =>
          item.id === messageId &&
          item.senderId === userId &&
          item.senderType === userType &&
          !item.isDeleted
        );

        if (message) {
          message.isDeleted = true;
          deleted = true;
        }
      }

      if (!deleted) {
        callback?.({ success: false, message: 'Unable to delete message' });
        socket.emit('chat:error', { message: 'Unable to delete message' });
        return;
      }

      const payload = { sessionId, messageId };
      const deletedMessageUpdate: InMemoryMessage = {
        id: messageId,
        sessionId,
        senderId: userId,
        senderType: userType,
        text: '',
        timestamp: new Date().toISOString(),
        isDeleted: true
      };

      io.to(sessionId).emit('chat:message', deletedMessageUpdate);
      io.to(sessionId).emit('chat:message-updated', deletedMessageUpdate);
      io.to(sessionId).emit('chat:message-deleted', payload);

      // Some classroom clients can have session state before room membership settles.
      // Directly notify sockets scoped to this session so receivers update immediately.
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.data.sessionId === sessionId) {
          clientSocket.emit('chat:message', deletedMessageUpdate);
          clientSocket.emit('chat:message-updated', deletedMessageUpdate);
          clientSocket.emit('chat:message-deleted', payload);
        }
      });

      await emitSessionHistory(sessionId);
      callback?.({ success: true });
    } catch (error) {
      console.error('Error handling chat:delete:', error);
      callback?.({ success: false, message: 'Failed to delete message' });
      socket.emit('chat:error', { message: 'Failed to delete message' });
    }
  });

  // Typing indicator
  socket.on('chat:typing', async (data) => {
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) return;
    try {
      const { isTyping } = data;
      const userId = socket.data.userId;
      const sessionId = socket.data.sessionId;

      if (sessionId) {
        // Broadcast typing status to other users in the session
        socket.to(sessionId).emit('chat:typing', {
          userId,
          isTyping
        });
      }
    } catch (error) {
      console.error('Error handling chat:typing:', error);
    }
  });

  // Request chat history
  socket.on('chat:request-history', async (data) => {
    try {
      const { sessionId } = data;
      if (!sessionId || socket.data.sessionId !== sessionId) return;
      const historyMessages = await loadSessionHistory(sessionId);

      // Send history to requesting client
      socket.emit('chat:history', historyMessages);

    } catch (error) {
      console.error('Error handling chat:request-history:', error);
      socket.emit('chat:history', []);
    }
  });
};
