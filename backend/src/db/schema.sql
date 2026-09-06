-- ==============================================================================
-- Neon PostgreSQL Database Schema for Local LLM Chatbot
-- ==============================================================================

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(128) PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Folders table (used for organizing chat sessions)
CREATE TABLE IF NOT EXISTS folders (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(50) DEFAULT '#6B7280',
  position INT DEFAULT 0,
  is_collapsed INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Chats table (chat sessions / conversations)
CREATE TABLE IF NOT EXISTS chats (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE SET NULL,
  folder_id VARCHAR(128) REFERENCES folders(id) ON DELETE SET NULL,
  title VARCHAR(500) DEFAULT 'New Chat',
  pinned_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Messages table (individual turns in conversations)
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(128) PRIMARY KEY,
  chat_id VARCHAR(128) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  parts JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_folder_id ON chats(folder_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at ASC);

-- Default local user seed (matches frontend MOCK_USER)
INSERT INTO users (id, username, role)
VALUES ('user-local-admin', 'Admin', 'admin')
ON CONFLICT (id) DO NOTHING;
