// Socket event types

export interface ServerToClientEvents {
  // Chat events
  'chat:message': (data: ChatMessageData) => void;
  'chat:message-updated': (data: ChatMessageData) => void;
  'chat:message-deleted': (data: { sessionId: string; messageId: string }) => void;
  'chat:history': (data: ChatMessageData[]) => void;
  'chat:typing': (data: { userId: string; isTyping: boolean }) => void;
  'chat:error': (data: { message: string }) => void;
  
  // Session events
  'session:user-joined': (data: { userId: string; userType: string }) => void;
  'session:user-left': (data: { userId: string; userType: string }) => void;
  'session:state': (data: SessionState) => void;
  'session:lesson-ended': (data: { tutorId: string; message?: string }) => void;
  'session:survey-ready': (data: { sessionId: string; reason: 'ended' | 'left' }) => void;
  'session:classroom-closed': (data: { sessionId: string; message: string }) => void;
  'session:error': (data: { message: string }) => void;
  'classroom:video-state': (data: { sessionId: string; userId: string; userType: 'tutor' | 'student'; enabled: boolean }) => void;
  'classroom:activity-history': (data: ClassroomActivityLogData[]) => void;
  'classroom:activity-log': (data: ClassroomActivityLogData) => void;
  
  // WebRTC signaling events
  'webrtc:offer': (data: { offer: any; from: string }) => void;
  'webrtc:answer': (data: { answer: any; from: string }) => void;
  'webrtc:ice-candidate': (data: { candidate: any; from: string }) => void;
  'webrtc:peer-left': () => void;
  'webrtc:ready': (data: { from: string }) => void;
  
  // Interview events
  'interview:joined': (data: { roomId: string; configuration: { iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> }; peerPresent: boolean; peerId?: string }) => void;
  'interview:renegotiate': () => void;
  'interview:recording-status': (data: { recording: boolean }) => void;
  'interview:admin-joined': () => void;
  'interview:tutor-joined': () => void;
  'interview:offer': (data: { offer: any }) => void;
  'interview:answer': (data: { answer: any }) => void;
  'interview:ice-candidate': (data: { candidate: any }) => void;
  'interview:ended': () => void;
  'interview:tutor-left': () => void;
  'interview:admin-left': () => void;
  'interview:error': (data: { message: string }) => void;
  'webrtc:ice-configuration': (configuration: { iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> }) => void;
  
  // Schedule events
  'schedule:slot-booked': (data: { tutorId: string; slotKey: string; bookingId?: string; studentId: string; studentName?: string; date: string; time: string }) => void;
  'schedule:slot-cancelled': (data: { tutorId: string; slotKey: string; date: string; time: string }) => void;
  
  // Ticket events
  'ticket:received': (data: TicketReceivedData) => void;
  'ticket:balance-updated': (data: TicketBalanceData) => void;
  
  // Notification events
  'notification:new': (data: NotificationData) => void;
  'notification:list': (data: { notifications: NotificationData[]; unreadCount: number }) => void;
  'notification:read': (data: { notificationId: string; unreadCount: number }) => void;
  'notification:read-all': (data: { unreadCount: number }) => void;
}

export interface ClientToServerEvents {
  'classroom:call-state': (data: { connected: boolean }) => void;
  'classroom:media-token': (callback: (result: { provider?: 'realtimekit'; token?: string; closesAt?: string; serverNow?: string; error?: string }) => void) => void;
  'classroom:recording-state': (callback: (result: any) => void) => void;
  'classroom:recording-consent': (decision: {accepted: boolean; authority: boolean; version: string}, callback: (result: any) => void) => void;
  // Chat events
  'chat:send': (data: SendMessageData) => void;
  'chat:share-material': (data: ShareMaterialData, callback?: (result: ShareMaterialResult) => void) => void;
  'chat:edit': (data: EditMessageData) => void;
  'chat:delete': (data: DeleteMessageData, callback?: (result: DeleteMessageResult) => void) => void;
  'chat:typing': (data: { isTyping: boolean }) => void;
  'chat:request-history': (data: { sessionId: string }) => void;
  
  // Session events
  'session:join': (data: { sessionId: string }) => void;
  'session:leave': () => void;
  'session:end-lesson': (data: { message?: string }) => void;
  'classroom:video-state': (data: { sessionId: string; enabled: boolean }) => void;
  'classroom:request-activity-history': (data: { sessionId: string }) => void;
  
  // WebRTC signaling events
  'webrtc:offer': (data: { offer: any; to: string }, callback?: (result: { delivered: boolean }) => void) => void;
  'webrtc:answer': (data: { answer: any; to: string }) => void;
  'webrtc:ice-candidate': (data: { candidate: any; to: string }) => void;
  'webrtc:ready': () => void;
  'webrtc:ice-config': (callback: (config: { iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>; error?: string }) => void) => void;
  
  // Interview events
  'interview:join': (data: { roomId: string; odIuser?: string; role: 'tutor' | 'admin' }) => void;
  'interview:renegotiate': (data: { roomId: string }) => void;
  'interview:recording-status': (data: { roomId: string; recording: boolean }) => void;
  'interview:offer': (data: { roomId: string; offer: any }) => void;
  'interview:answer': (data: { roomId: string; answer: any }) => void;
  'interview:ice-candidate': (data: { roomId: string; candidate: any }) => void;
  'interview:end': (data: { roomId: string }) => void;
  
  // Schedule events
  'schedule:subscribe': (data: { tutorId: string }) => void;
  'schedule:unsubscribe': () => void;
  
  // Ticket events
  'ticket:subscribe': () => void;
  'ticket:unsubscribe': () => void;
  
  // Notification events
  'notification:subscribe': () => void;
  'notification:get-all': (data?: { limit?: number; offset?: number }) => void;
  'notification:mark-read': (notificationId: string) => void;
  'notification:mark-all-read': () => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  callState?: 'connected' | 'disconnected';
  callUpdatedAt?: string;
  mediaProvider?: 'webrtc' | 'realtimekit';
  userId: string;
  userType: 'tutor' | 'student' | 'admin';
  sessionId?: string;
  lessonStartsAt?: number;
  lessonEndsAt?: number;
  interviewRoomId?: string;
  interviewRole?: 'tutor' | 'admin';
  scheduleSubscribedTo?: string; // Tutor ID for schedule subscription
}

// Data structures
export interface SharedClassroomMaterial {
  id: string;
  courseId: 'daily-dispatch' | 'conversational-skills' | 'business-english';
  title: string;
  level?: number;
  chapter?: number;
  lessonNumber?: number;
  category?: string;
  postedDate?: string;
  createdAt?: string;
}

export interface ShareMaterialData {
  sessionId: string;
  courseId: SharedClassroomMaterial['courseId'];
  materialId: string;
}

export interface ShareMaterialResult {
  success: boolean;
  message?: string;
}

export interface ChatMessageData {
  id: string;
  sessionId: string;
  senderId: string;
  senderType: 'tutor' | 'student';
  text: string;
  timestamp: string;
  material?: SharedClassroomMaterial;
  correction?: string;
  isSystemMessage?: boolean;
  isEdited?: boolean;
  editedAt?: string;
  isDeleted?: boolean;
  // File attachment support
  fileUrl?: string;
  fileName?: string;
  fileType?: 'image' | 'file';
  fileSize?: number;
}

export interface SendMessageData {
  sessionId: string;
  text: string;
  correction?: string;
  // File attachment support
  fileUrl?: string;
  fileName?: string;
  fileType?: 'image' | 'file';
  fileSize?: number;
}

export interface EditMessageData {
  sessionId: string;
  messageId: string;
  text: string;
}

export interface DeleteMessageData {
  sessionId: string;
  messageId: string;
}

export interface DeleteMessageResult {
  success: boolean;
  message?: string;
}

export interface SessionState {
  sessionId: string;
  mediaProvider?: 'webrtc' | 'realtimekit';
  startsAt?: string;
  endsAt?: string;
  serverNow?: string;
  participants: {
    tutorId?: string;
    studentId?: string;
    tutorSocketId?: string;
    studentSocketId?: string;
  };
  status: 'active' | 'waiting';
}

export interface ClassroomActivityLogData {
  id: string;
  sessionId: string;
  userId: string;
  userType: 'tutor' | 'student';
  eventType: 'entered' | 'left' | 'lesson_ended';
  message: string;
  createdAt: string;
}

// Ticket notification data
export interface TicketReceivedData {
  userId: string;
  tier: 'basic' | 'premium' | 'trial';
  quantity: number;
  transactionId: string;
  timestamp: string;
}

export interface TicketBalanceData {
  userId: string;
  balance: {
    basic: number;
    premium: number;
    trial: number;
    total: number;
  };
}

// Notification data
export interface NotificationData {
  id: string;
  userId: string;
  type: 'ticket_received' | 'booking_confirmed' | 'lesson_reminder' | 'system';
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}
