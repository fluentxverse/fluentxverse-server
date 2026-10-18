import type { Server as SocketIOServer, Socket } from 'socket.io';

// Track active editors per lesson
const activeEditors: Map<string, Set<{ odI: string; socketId: string; userName: string; startedAt: Date }>> = new Map();

/**
 * Lesson collaboration socket handler
 * Handles real-time editing indicators and presence
 */
export const lessonHandler = (io: SocketIOServer, socket: Socket) => {
  const userId = socket.data.userId;
  const userName = socket.data.userName || socket.data.userId;

  /**
   * Join a lesson room for real-time updates
   */
  socket.on('lesson:join', (lessonId: string) => {
    const roomName = `lesson:${lessonId}`;
    socket.join(roomName);
    
    // Get current editors for this lesson
    const editors = activeEditors.get(lessonId) || new Set();
    
    // Send current editors to the joining user
    socket.emit('lesson:editors', {
      lessonId,
      editors: Array.from(editors)
    });
    
  });

  /**
   * Leave a lesson room
   */
  socket.on('lesson:leave', (lessonId: string) => {
    const roomName = `lesson:${lessonId}`;
    socket.leave(roomName);
    
    // Remove from active editors if they were editing
    const editors = activeEditors.get(lessonId);
    if (editors) {
      const editor = Array.from(editors).find(e => e.socketId === socket.id);
      if (editor) {
        editors.delete(editor);
        // Notify others
        socket.to(roomName).emit('lesson:editor-left', {
          lessonId,
          odI: userId,
          userName
        });
      }
    }
    
  });

  /**
   * User started editing a lesson
   */
  socket.on('lesson:start-editing', (lessonId: string) => {
    const roomName = `lesson:${lessonId}`;
    
    // Add to active editors
    if (!activeEditors.has(lessonId)) {
      activeEditors.set(lessonId, new Set());
    }
    
    const editors = activeEditors.get(lessonId)!;
    
    // Check if already editing
    const existing = Array.from(editors).find(e => e.socketId === socket.id);
    if (!existing) {
      const editorInfo = {
        odI: userId,
        socketId: socket.id,
        userName,
        startedAt: new Date()
      };
      editors.add(editorInfo);
      
      // Notify others in the room
      socket.to(roomName).emit('lesson:editor-joined', {
        lessonId,
        odI: userId,
        userName,
        startedAt: new Date()
      });
      
    }
  });

  /**
   * User stopped editing a lesson
   */
  socket.on('lesson:stop-editing', (lessonId: string) => {
    const roomName = `lesson:${lessonId}`;
    const editors = activeEditors.get(lessonId);
    
    if (editors) {
      const editor = Array.from(editors).find(e => e.socketId === socket.id);
      if (editor) {
        editors.delete(editor);
        
        // Notify others
        socket.to(roomName).emit('lesson:editor-left', {
          lessonId,
          odI: userId,
          userName
        });
        
      }
    }
  });

  /**
   * User is actively editing (cursor/typing indicator)
   */
  socket.on('lesson:editing-activity', (data: { lessonId: string; section: string; action: string }) => {
    const roomName = `lesson:${data.lessonId}`;
    
    // Broadcast to others in the room
    socket.to(roomName).emit('lesson:activity', {
      lessonId: data.lessonId,
      odI: userId,
      userName,
      section: data.section,
      action: data.action,
      timestamp: new Date()
    });
  });

  /**
   * Lesson was saved - notify collaborators
   */
  socket.on('lesson:saved', (data: { lessonId: string; version: number }) => {
    const roomName = `lesson:${data.lessonId}`;
    
    // Broadcast to others in the room
    socket.to(roomName).emit('lesson:updated', {
      lessonId: data.lessonId,
      savedBy: userId,
      savedByName: userName,
      version: data.version,
      timestamp: new Date()
    });
    
  });

  /**
   * Handle disconnect - clean up editing state
   */
  socket.on('disconnect', () => {
    // Remove from all lesson rooms
    for (const [lessonId, editors] of activeEditors.entries()) {
      const editor = Array.from(editors).find(e => e.socketId === socket.id);
      if (editor) {
        editors.delete(editor);
        
        // Notify others
        const roomName = `lesson:${lessonId}`;
        socket.to(roomName).emit('lesson:editor-left', {
          lessonId,
          odI: userId,
          userName
        });
      }
    }
  });
};

/**
 * Get active editors for a lesson
 */
export const getActiveEditors = (lessonId: string) => {
  const editors = activeEditors.get(lessonId);
  return editors ? Array.from(editors) : [];
};
