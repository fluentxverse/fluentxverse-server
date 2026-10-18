import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../types/socket.types';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

interface HighlightStroke {
  id: string;
  pageIndex: number;
  points: { x: number; y: number }[];
  color: string;
}

// In-memory store for session highlights
const sessionHighlights: Map<string, HighlightStroke[]> = new Map();

export const highlightHandler = (io: TypedServer, socket: TypedSocket) => {
  // Handle new highlight stroke
  socket.on('highlight:stroke' as any, (data: { sessionId: string; stroke: HighlightStroke }) => {
    const { sessionId, stroke } = data;
    
    // Store the highlight
    if (!sessionHighlights.has(sessionId)) {
      sessionHighlights.set(sessionId, []);
    }
    const highlights = sessionHighlights.get(sessionId)!;
    
    // Avoid duplicates
    if (!highlights.some(h => h.id === stroke.id)) {
      highlights.push(stroke);
    }
    
    // Broadcast to others in the session (excluding sender)
    socket.to(sessionId).emit('highlight:stroke' as any, { stroke });
    
  });

  // Handle clear all highlights
  socket.on('highlight:clear' as any, (data: { sessionId: string }) => {
    const { sessionId } = data;
    
    // Clear stored highlights
    sessionHighlights.set(sessionId, []);
    
    // Broadcast to others in the session
    socket.to(sessionId).emit('highlight:clear' as any, {});
    
  });

  // Handle sync request (when user joins)
  socket.on('highlight:request-sync' as any, (data: { sessionId: string }) => {
    const { sessionId } = data;
    
    const highlights = sessionHighlights.get(sessionId) || [];
    
    // Send current highlights to the requesting socket
    socket.emit('highlight:sync' as any, { highlights });
    
  });

  // Clean up session highlights on disconnect (optional - could keep them)
  socket.on('disconnect', () => {
    // We don't clear highlights on disconnect to preserve them for the session
    // They could be cleared when the session ends instead
  });
};

// Utility to clear highlights for a session (call when session ends)
export const clearSessionHighlights = (sessionId: string) => {
  sessionHighlights.delete(sessionId);
};
