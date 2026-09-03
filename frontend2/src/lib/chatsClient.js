import { apiFetch, MOCK_INITIAL_CHATS, MOCK_INITIAL_MESSAGES } from "@/lib/api";

const SNAKE_TO_CAMEL = {
  created_at: "createdAt",
  updated_at: "updatedAt",
  pinned_at: "pinnedAt",
  archived_at: "archivedAt",
  file_ids: "fileIds",
  chat_id: "chatId",
  user_id: "userId",
  folder_id: "folderId",
};

function toCamelCase(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase);
  }

  const transformed = {};
  for (const [key, value] of Object.entries(obj)) {
    transformed[SNAKE_TO_CAMEL[key] ?? key] = toCamelCase(value);
  }
  return transformed;
}

const STORAGE_CHATS_KEY = "faster_chat_local_chats";
const STORAGE_MSGS_KEY = "faster_chat_local_messages";

function getLocalChats() {
  try {
    const raw = localStorage.getItem(STORAGE_CHATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [...MOCK_INITIAL_CHATS];
}

function saveLocalChats(chats) {
  try {
    localStorage.setItem(STORAGE_CHATS_KEY, JSON.stringify(chats));
  } catch {}
}

function getLocalMessages(chatId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_MSGS_KEY}_${chatId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  if (chatId === "welcome-chat") {
    return [...MOCK_INITIAL_MESSAGES];
  }
  return [];
}

function saveLocalMessages(chatId, messages) {
  try {
    localStorage.setItem(`${STORAGE_MSGS_KEY}_${chatId}`, JSON.stringify(messages));
  } catch {}
}

const chatsFetch = async (endpoint, options) =>
  toCamelCase(await apiFetch(`/api/chats${endpoint}`, options));

export const chatsClient = {
  async getChats() {
    try {
      const data = await chatsFetch("");
      return data.chats;
    } catch {
      return getLocalChats();
    }
  },

  async getChat(chatId) {
    try {
      return await chatsFetch(`/${chatId}`);
    } catch {
      const chats = getLocalChats();
      const found = chats.find((c) => c.id === chatId);
      if (found) return found;
      return {
        id: chatId,
        title: "New Chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  },

  async createChat(id = null, title = null, folderId = null) {
    try {
      return await chatsFetch("", {
        method: "POST",
        body: JSON.stringify({ id, title, folder_id: folderId }),
      });
    } catch {
      const newChat = {
        id: id || `chat-${Date.now()}`,
        title: title || "New Chat",
        folderId: folderId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pinnedAt: null,
        archivedAt: null,
      };
      const chats = [newChat, ...getLocalChats()];
      saveLocalChats(chats);
      return newChat;
    }
  },

  async updateChat(chatId, updates) {
    try {
      return await chatsFetch(`/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    } catch {
      const chats = getLocalChats().map((c) =>
        c.id === chatId ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
      );
      saveLocalChats(chats);
      return chats.find((c) => c.id === chatId);
    }
  },

  async deleteChat(chatId) {
    try {
      return await chatsFetch(`/${chatId}`, {
        method: "DELETE",
      });
    } catch {
      const chats = getLocalChats().filter((c) => c.id !== chatId);
      saveLocalChats(chats);
      return { success: true };
    }
  },

  async getMessages(chatId) {
    try {
      const data = await chatsFetch(`/${chatId}/messages`);
      return data.messages;
    } catch {
      return getLocalMessages(chatId);
    }
  },

  async createMessage(chatId, message) {
    try {
      return await chatsFetch(`/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify(message),
      });
    } catch {
      const msgs = getLocalMessages(chatId);
      const newMsg = {
        id: message.id || `msg-${Date.now()}`,
        chatId,
        role: message.role || "user",
        content: message.content || "",
        parts: message.parts || [{ type: "text", text: message.content || "" }],
        createdAt: new Date().toISOString(),
      };
      msgs.push(newMsg);
      saveLocalMessages(chatId, msgs);
      return newMsg;
    }
  },

  async deleteMessage(chatId, messageId) {
    try {
      return await chatsFetch(`/${chatId}/messages/${messageId}`, {
        method: "DELETE",
      });
    } catch {
      const msgs = getLocalMessages(chatId).filter((m) => m.id !== messageId);
      saveLocalMessages(chatId, msgs);
      return { success: true };
    }
  },

  async pinChat(chatId) {
    try {
      return await chatsFetch(`/${chatId}/pin`, {
        method: "POST",
      });
    } catch {
      return this.updateChat(chatId, { pinnedAt: new Date().toISOString() });
    }
  },

  async unpinChat(chatId) {
    try {
      return await chatsFetch(`/${chatId}/pin`, {
        method: "DELETE",
      });
    } catch {
      return this.updateChat(chatId, { pinnedAt: null });
    }
  },

  async archiveChat(chatId) {
    try {
      return await chatsFetch(`/${chatId}/archive`, {
        method: "POST",
      });
    } catch {
      return this.updateChat(chatId, { archivedAt: new Date().toISOString() });
    }
  },

  async unarchiveChat(chatId) {
    try {
      return await chatsFetch(`/${chatId}/archive`, {
        method: "DELETE",
      });
    } catch {
      return this.updateChat(chatId, { archivedAt: null });
    }
  },
};
