// Inbox/System Messages interfaces

export type MessageCategory = 'announcement' | 'update' | 'alert' | 'news' | 'promotion';
export type TargetAudience = 'all' | 'students' | 'tutors';
export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface SystemMessage {
  id: string;
  title: string;
  content: string;
  category: MessageCategory;
  targetAudience: TargetAudience;
  priority: MessagePriority;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemMessageWithStatus extends SystemMessage {
  isRead: boolean;
  isPinned: boolean;
  readAt: string | null;
}

export interface CreateSystemMessageParams {
  title: string;
  content: string;
  category: MessageCategory;
  targetAudience: TargetAudience;
  priority?: MessagePriority;
  createdBy: string;
}

export interface UpdateMessageStatusParams {
  messageId: string;
  userId: string;
  userType: 'tutor' | 'student';
  isRead?: boolean;
  isPinned?: boolean;
}

export interface GetUserMessagesParams {
  userId: string;
  userType: 'tutor' | 'student';
  category?: MessageCategory;
  isRead?: boolean;
  isPinned?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetAllMessagesParams {
  category?: MessageCategory;
  targetAudience?: TargetAudience;
  limit?: number;
  offset?: number;
}

export interface MessageStats {
  total: number;
  unread: number;
  pinned: number;
}
