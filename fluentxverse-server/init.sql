-- FluentXVerse Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  tier INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table (tutoring sessions - for scheduled sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id UUID REFERENCES users(id),
  student_id UUID REFERENCES users(id),
  scheduled_at TIMESTAMP NOT NULL,
  duration_minutes INTEGER DEFAULT 25,
  status VARCHAR(50) DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Session participants (for tracking who joined - uses string session IDs for dynamic sessions)
CREATE TABLE IF NOT EXISTS session_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  socket_id VARCHAR(255),
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('tutor', 'student')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  left_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS session_participants_one_active_user_idx
  ON session_participants (session_id, user_id) WHERE is_active = true;

-- Chat messages table (uses string session IDs for dynamic sessions)
CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(50) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  sender_id VARCHAR(255) NOT NULL,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('tutor', 'student')),
  message_text TEXT NOT NULL,
  correction_text TEXT,
  is_system_message BOOLEAN DEFAULT false,
  timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  edited_message_text TEXT,
  edited_at TIMESTAMP,
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP
);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_message_text TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS material JSONB;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_session_participants_session_id ON session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tutor_id ON sessions(tutor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_student_id ON sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at ON sessions(scheduled_at);

-- Classroom activity logs (join/leave/end lesson history)
CREATE TABLE IF NOT EXISTS classroom_activity_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('tutor', 'student')),
  event_type TEXT NOT NULL CHECK (event_type IN ('entered', 'left', 'lesson_ended')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS classroom_activity_logs_session_created_idx
  ON classroom_activity_logs (session_id, created_at DESC);

-- Tutor schedules table
CREATE TABLE IF NOT EXISTS tutor_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id UUID REFERENCES users(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES sessions(id),
  student_id UUID REFERENCES users(id),
  tutor_id UUID REFERENCES users(id),
  booked_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'confirmed',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- System Messages (Inbox) table - for admin-to-user communications
CREATE TABLE IF NOT EXISTS admin_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('task', 'suggestion')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  created_by VARCHAR(255) NOT NULL,
  assignee_id VARCHAR(255),
  updated_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_tasks ADD COLUMN IF NOT EXISTS assignee_id VARCHAR(255);
UPDATE admin_tasks SET assignee_id = created_by WHERE assignee_id IS NULL;
CREATE INDEX IF NOT EXISTS admin_tasks_status_created_idx ON admin_tasks (status, created_at DESC);

CREATE TABLE IF NOT EXISTS system_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'announcement' CHECK (category IN ('announcement', 'update', 'alert', 'news', 'promotion')),
  target_audience VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (target_audience IN ('all', 'students', 'tutors')),
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_by VARCHAR(255),  -- External auth user ID (not UUID)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- System Message Recipients - tracks read/pinned status per user
CREATE TABLE IF NOT EXISTS system_message_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES system_messages(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,  -- External auth user ID (not UUID)
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('tutor', 'student')),
  is_read BOOLEAN DEFAULT false,
  is_pinned BOOLEAN DEFAULT false,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Indexes for system messages
CREATE INDEX IF NOT EXISTS idx_system_messages_category ON system_messages(category);
CREATE INDEX IF NOT EXISTS idx_system_messages_target ON system_messages(target_audience);
CREATE INDEX IF NOT EXISTS idx_system_messages_created_at ON system_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_message_recipients_user ON system_message_recipients(user_id, user_type);
CREATE INDEX IF NOT EXISTS idx_system_message_recipients_read ON system_message_recipients(user_id, is_read);

-- ===========================================
-- MIGRATIONS: Fix existing deployments
-- These are idempotent and safe to run multiple times
-- ===========================================

-- Fix: system_messages.created_by should be VARCHAR, not UUID (external auth user IDs are strings)
-- Drop FK constraint if it exists (from older schema versions)
ALTER TABLE system_messages DROP CONSTRAINT IF EXISTS system_messages_created_by_fkey;

-- Fix column types if they were created as UUID (older schema)
DO $$
BEGIN
  -- Fix created_by column type if needed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'system_messages' 
    AND column_name = 'created_by' 
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE system_messages ALTER COLUMN created_by TYPE VARCHAR(255) USING created_by::text;
  END IF;
  
  -- Fix user_id column type if needed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'system_message_recipients' 
    AND column_name = 'user_id' 
    AND data_type = 'uuid'
  ) THEN
    -- Drop indexes first
    DROP INDEX IF EXISTS idx_system_message_recipients_user;
    DROP INDEX IF EXISTS idx_system_message_recipients_read;
    -- Alter column
    ALTER TABLE system_message_recipients ALTER COLUMN user_id TYPE VARCHAR(255) USING user_id::text;
    -- Recreate indexes
    CREATE INDEX idx_system_message_recipients_user ON system_message_recipients(user_id, user_type);
    CREATE INDEX idx_system_message_recipients_read ON system_message_recipients(user_id, is_read);
  END IF;
END $$;

-- ===========================================
-- LESSON MATERIALS (Fork/Merge System)
-- ===========================================

-- Main lessons table - tracks all lessons and their forks
CREATE TABLE IF NOT EXISTS lessons (
  id VARCHAR(255) PRIMARY KEY,  -- slug-timestamp format
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finished', 'published', 'archived')),
  
  -- Fork tracking
  parent_id VARCHAR(255) REFERENCES lessons(id) ON DELETE SET NULL,  -- NULL for original lessons
  fork_of VARCHAR(255) REFERENCES lessons(id) ON DELETE SET NULL,    -- The lesson this was forked from
  is_fork BOOLEAN DEFAULT false,
  
  -- Authorship
  created_by VARCHAR(255) NOT NULL,  -- Admin user ID
  created_by_name VARCHAR(255),       -- Admin display name (for UI)
  
  -- Storage paths in SeaweedFS
  storage_path VARCHAR(500) NOT NULL,  -- e.g., /lessons/lesson-id
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  published_at TIMESTAMP
);

-- Lesson versions (history)
CREATE TABLE IF NOT EXISTS lesson_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  
  -- Snapshot of lesson data at this version
  lesson_data JSONB NOT NULL,  -- Full LessonMaterial JSON
  
  -- Change tracking
  change_summary VARCHAR(500),  -- Brief description of changes
  changed_by VARCHAR(255) NOT NULL,  -- Admin user ID
  changed_by_name VARCHAR(255),
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(lesson_id, version_number)
);

-- Merge requests (for forked lessons)
CREATE TABLE IF NOT EXISTS lesson_merge_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Source (the fork requesting merge)
  source_lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  source_version INTEGER NOT NULL,  -- Which version of the fork to merge
  
  -- Target (the original lesson)
  target_lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  
  -- Request details
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
  
  -- Author of the merge request
  requested_by VARCHAR(255) NOT NULL,
  requested_by_name VARCHAR(255),
  
  -- Review
  reviewed_by VARCHAR(255),
  reviewed_by_name VARCHAR(255),
  review_comment TEXT,
  reviewed_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for lessons
CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
CREATE INDEX IF NOT EXISTS idx_lessons_created_by ON lessons(created_by);
CREATE INDEX IF NOT EXISTS idx_lessons_parent_id ON lessons(parent_id);
CREATE INDEX IF NOT EXISTS idx_lessons_fork_of ON lessons(fork_of);
CREATE INDEX IF NOT EXISTS idx_lessons_is_fork ON lessons(is_fork);
CREATE INDEX IF NOT EXISTS idx_lesson_versions_lesson_id ON lesson_versions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_merge_requests_source ON lesson_merge_requests(source_lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_merge_requests_target ON lesson_merge_requests(target_lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_merge_requests_status ON lesson_merge_requests(status);

-- Merge request comments (discussion thread)
CREATE TABLE IF NOT EXISTS lesson_merge_request_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merge_request_id UUID NOT NULL REFERENCES lesson_merge_requests(id) ON DELETE CASCADE,
  
  -- Comment content
  comment TEXT NOT NULL,
  
  -- Author
  author_id VARCHAR(255) NOT NULL,
  author_name VARCHAR(255),
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mr_comments_merge_request ON lesson_merge_request_comments(merge_request_id);
CREATE INDEX IF NOT EXISTS idx_mr_comments_author ON lesson_merge_request_comments(author_id);

COMMENT ON TABLE lessons IS 'Stores lesson material metadata with fork/merge tracking';
COMMENT ON TABLE lesson_versions IS 'Version history for lesson materials';
COMMENT ON TABLE lesson_merge_requests IS 'Merge requests from forked lessons to original';
COMMENT ON TABLE lesson_merge_request_comments IS 'Discussion comments on merge requests';

-- ===========================================
-- LESSON CATEGORIES AND TAGS
-- ===========================================

-- Lesson categories (hierarchical)
CREATE TABLE IF NOT EXISTS lesson_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  parent_id UUID REFERENCES lesson_categories(id) ON DELETE SET NULL,
  icon VARCHAR(50),  -- Remix icon class
  color VARCHAR(20),  -- Hex color code
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Lesson tags (flat, many-to-many)
CREATE TABLE IF NOT EXISTS lesson_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  slug VARCHAR(50) NOT NULL UNIQUE,
  color VARCHAR(20),  -- Hex color for UI
  usage_count INTEGER DEFAULT 0,  -- How many lessons use this tag
  created_at TIMESTAMP DEFAULT NOW()
);

-- Many-to-many: Lessons <-> Tags
CREATE TABLE IF NOT EXISTS lesson_tag_assignments (
  lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES lesson_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (lesson_id, tag_id)
);

-- Add category and metadata columns to lessons
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES lesson_categories(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'ja';  -- Target language code
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS skill_level VARCHAR(20) DEFAULT 'beginner' CHECK (skill_level IN ('beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced', 'native'));
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS estimated_duration INTEGER;  -- Estimated time in minutes
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500);

-- Indexes for categories and tags
CREATE INDEX IF NOT EXISTS idx_lesson_categories_parent ON lesson_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_lesson_categories_slug ON lesson_categories(slug);
CREATE INDEX IF NOT EXISTS idx_lesson_tags_slug ON lesson_tags(slug);
CREATE INDEX IF NOT EXISTS idx_lesson_tag_assignments_lesson ON lesson_tag_assignments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_tag_assignments_tag ON lesson_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category_id);
CREATE INDEX IF NOT EXISTS idx_lessons_language ON lessons(language);
CREATE INDEX IF NOT EXISTS idx_lessons_skill_level ON lessons(skill_level);
CREATE INDEX IF NOT EXISTS idx_lessons_is_template ON lessons(is_template);

-- Insert default categories
INSERT INTO lesson_categories (name, slug, description, icon, color, sort_order) VALUES
  ('Conversational Skills', 'conversational-skills', 'Everyday conversation practice', 'ri-chat-3-line', '#3b82f6', 1),
  ('Grammar', 'grammar', 'Grammar structures and patterns', 'ri-book-2-line', '#8b5cf6', 2),
  ('Vocabulary', 'vocabulary', 'Word building and vocabulary expansion', 'ri-text', '#10b981', 3),
  ('Reading', 'reading', 'Reading comprehension and practice', 'ri-file-text-line', '#f59e0b', 4),
  ('Writing', 'writing', 'Writing skills and composition', 'ri-edit-line', '#ef4444', 5),
  ('Listening', 'listening', 'Listening comprehension exercises', 'ri-headphone-line', '#06b6d4', 6),
  ('Culture', 'culture', 'Cultural context and etiquette', 'ri-global-line', '#ec4899', 7),
  ('Business', 'business', 'Business language and formal speech', 'ri-briefcase-line', '#64748b', 8)
ON CONFLICT (slug) DO NOTHING;

-- Insert default tags
INSERT INTO lesson_tags (name, slug, color) VALUES
  ('N5', 'jlpt-n5', '#22c55e'),
  ('N4', 'jlpt-n4', '#84cc16'),
  ('N3', 'jlpt-n3', '#eab308'),
  ('N2', 'jlpt-n2', '#f97316'),
  ('N1', 'jlpt-n1', '#ef4444'),
  ('Hiragana', 'hiragana', '#8b5cf6'),
  ('Katakana', 'katakana', '#a855f7'),
  ('Kanji', 'kanji', '#6366f1'),
  ('Keigo', 'keigo', '#64748b'),
  ('Casual', 'casual', '#06b6d4'),
  ('Travel', 'travel', '#0ea5e9'),
  ('Food', 'food', '#f59e0b'),
  ('Self-Introduction', 'self-introduction', '#10b981'),
  ('Numbers', 'numbers', '#3b82f6'),
  ('Time', 'time', '#6366f1'),
  ('Shopping', 'shopping', '#ec4899')
ON CONFLICT (slug) DO NOTHING;

-- ===========================================
-- LESSON MEDIA MANAGEMENT
-- ===========================================

-- Media files associated with lessons
CREATE TABLE IF NOT EXISTS lesson_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  
  -- Media details
  type VARCHAR(20) NOT NULL CHECK (type IN ('audio', 'video', 'image', 'document')),
  filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,  -- Path in SeaweedFS
  mime_type VARCHAR(100),
  file_size INTEGER,  -- Size in bytes
  
  -- Metadata
  title VARCHAR(255),
  description TEXT,
  duration INTEGER,  -- Duration in seconds for audio/video
  
  -- Pronunciation audio specific
  vocabulary_item_id VARCHAR(255),  -- Reference to vocab item in lesson JSON
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lesson_media_lesson ON lesson_media(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_media_type ON lesson_media(type);

-- ===========================================
-- LESSON ANALYTICS
-- ===========================================

-- Lesson view tracking
CREATE TABLE IF NOT EXISTS lesson_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  user_id VARCHAR(255),  -- NULL for anonymous views
  user_type VARCHAR(20),  -- 'student', 'tutor', 'admin'
  
  -- Session info
  session_id VARCHAR(255),  -- Browser session ID
  
  -- Timestamps
  viewed_at TIMESTAMP DEFAULT NOW(),
  time_spent INTEGER DEFAULT 0,  -- Seconds spent on lesson
  
  -- Progress
  completed BOOLEAN DEFAULT false,
  completion_percentage INTEGER DEFAULT 0
);

-- Lesson progress (detailed per-user progress)
CREATE TABLE IF NOT EXISTS lesson_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  
  -- Progress tracking
  started_at TIMESTAMP DEFAULT NOW(),
  last_accessed_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  
  -- Section progress (JSON)
  sections_completed JSONB DEFAULT '[]'::jsonb,  -- Array of completed section IDs
  vocabulary_mastered JSONB DEFAULT '[]'::jsonb,  -- Array of mastered vocab IDs
  exercises_completed JSONB DEFAULT '[]'::jsonb,  -- Array of completed exercise results
  
  -- Scores
  vocabulary_score INTEGER,  -- 0-100
  grammar_score INTEGER,     -- 0-100
  exercise_score INTEGER,    -- 0-100
  overall_score INTEGER,     -- 0-100
  
  -- Review scheduling (spaced repetition)
  next_review_date DATE,
  review_count INTEGER DEFAULT 0,
  
  UNIQUE(lesson_id, user_id)
);

-- Aggregated lesson statistics (updated periodically)
CREATE TABLE IF NOT EXISTS lesson_stats (
  lesson_id VARCHAR(255) PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  
  -- View counts
  total_views INTEGER DEFAULT 0,
  unique_viewers INTEGER DEFAULT 0,
  
  -- Completion metrics
  total_starts INTEGER DEFAULT 0,
  total_completions INTEGER DEFAULT 0,
  completion_rate DECIMAL(5,2) DEFAULT 0,  -- Percentage
  
  -- Average scores
  avg_vocabulary_score DECIMAL(5,2),
  avg_grammar_score DECIMAL(5,2),
  avg_exercise_score DECIMAL(5,2),
  avg_overall_score DECIMAL(5,2),
  
  -- Time metrics
  avg_time_spent INTEGER DEFAULT 0,  -- Seconds
  
  -- Engagement
  bookmark_count INTEGER DEFAULT 0,
  
  -- Last updated
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User lesson bookmarks
CREATE TABLE IF NOT EXISTS lesson_bookmarks (
  user_id VARCHAR(255) NOT NULL,
  lesson_id VARCHAR(255) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, lesson_id)
);

-- Indexes for analytics
CREATE INDEX IF NOT EXISTS idx_lesson_views_lesson ON lesson_views(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_views_user ON lesson_views(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_views_date ON lesson_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON lesson_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_bookmarks_user ON lesson_bookmarks(user_id);

COMMENT ON TABLE lesson_categories IS 'Hierarchical categories for organizing lessons';
COMMENT ON TABLE lesson_tags IS 'Flat tags for lesson discovery and filtering';
COMMENT ON TABLE lesson_media IS 'Audio, video, and other media files for lessons';
COMMENT ON TABLE lesson_views IS 'Tracks individual lesson view events';
COMMENT ON TABLE lesson_progress IS 'Detailed per-user lesson progress and scores';
COMMENT ON TABLE lesson_stats IS 'Aggregated lesson statistics for dashboards';
COMMENT ON TABLE lesson_bookmarks IS 'User bookmarked/saved lessons';

-- ===========================================
-- END MIGRATIONS
-- ===========================================

COMMENT ON TABLE chat_messages IS 'Stores chat messages exchanged during tutoring sessions';
COMMENT ON TABLE session_participants IS 'Tracks users who join tutoring sessions via WebSocket';
COMMENT ON TABLE system_messages IS 'Stores system-wide announcements and messages from FluentXVerse admin';
COMMENT ON TABLE system_message_recipients IS 'Tracks which users have read/pinned system messages';

-- NOTE: Ticket Types and Student Favorites are stored in Memgraph (graph database) instead of PostgreSQL
-- Student Favorites use a FAVORITES relationship: (Student)-[:FAVORITES]->(Tutor)
-- See fluentxverse-server/src/services/ticket.services/ticket.service.ts
-- See fluentxverse-server/src/services/favorites.services/favorites.service.ts
