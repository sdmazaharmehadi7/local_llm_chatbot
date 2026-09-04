/**
 * Centralized API service layer for communicating with the Node.js/Express backend.
 * Architecture:
 * React -> api/service layer -> http://localhost:5000 (Express) -> Ollama (http://localhost:11434)
 */

export const API_BASE = import.meta.env.VITE_API_BASE || "";

/**
 * Perform a centralized API fetch with credentials and JSON defaults.
 */
export async function apiFetch(endpoint, options = {}) {
  const { headers: optionHeaders, ...restOptions } = options;

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...restOptions,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...optionHeaders,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.error || `Server unreachable (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * Mock data used when the Node.js/Express backend is not running yet,
 * so the Faster Chat UI loads, renders, and can be fully tested without errors.
 */
export const MOCK_USER = {
  id: "user-local-admin",
  username: "Admin",
  role: "admin",
  created_at: new Date().toISOString(),
};

export const MOCK_MODELS = [
  {
    id: "qwen3:8b",
    model_id: "qwen3:8b",
    name: "Qwen3 8B",
    display_name: "Qwen3 8B",
    provider: "ollama",
    provider_id: "ollama",
    provider_display_name: "Ollama",
    type: "text",
    enabled: true,
    is_default: true,
    context_window: 40960,
    metadata: {
      supports_tools: false,
      description: "General reasoning and chat",
    },
  },
  {
    id: "qwen2.5-coder:7b",
    model_id: "qwen2.5-coder:7b",
    name: "Qwen2.5 Coder 7B",
    display_name: "Qwen2.5 Coder 7B",
    provider: "ollama",
    provider_id: "ollama",
    provider_display_name: "Ollama",
    type: "text",
    enabled: true,
    is_default: false,
    context_window: 32768,
    metadata: {
      supports_tools: true,
      description: "Coding and debugging",
    },
  },
  {
    id: "qwen2.5vl:7b",
    model_id: "qwen2.5vl:7b",
    name: "Qwen2.5 VL 7B",
    display_name: "Qwen2.5 VL 7B",
    provider: "ollama",
    provider_id: "ollama",
    provider_display_name: "Ollama",
    type: "text",
    enabled: true,
    is_default: false,
    context_window: 128000,
    metadata: {
      supports_tools: false,
      description: "Images and visual documents",
    },
  },
];

export const MOCK_INITIAL_CHATS = [
  {
    id: "welcome-chat",
    title: "Welcome to Local Chat",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pinned_at: null,
    archived_at: null,
    folder_id: null,
  },
];

export const MOCK_INITIAL_MESSAGES = [
  {
    id: "msg-welcome-1",
    chat_id: "welcome-chat",
    role: "assistant",
    content:
      "# Welcome to Local Chat!\n\nThis frontend is running on **React + Vite + Tailwind CSS**.\n\n### Status\n- Ready to connect to your Node.js/Express backend on `http://localhost:5000`.\n- Designed for local Ollama open-weight models (`qwen3:8b`, `qwen2.5-coder:7b`, `qwen2.5vl:7b`).\n- All Local Chat UI components, dark/light themes, markdown rendering, code syntax highlighting, and responsive layouts are active.",
    created_at: new Date().toISOString(),
    parts: [
      {
        type: "text",
        text: "# Welcome to Local Chat!\n\nThis frontend is running on **React + Vite + Tailwind CSS**.\n\n### Status\n- Ready to connect to your Node.js/Express backend on `http://localhost:5000`.\n- Designed for local Ollama open-weight models (`qwen3:8b`, `qwen2.5-coder:7b`, `qwen2.5vl:7b`).\n- All Local Chat UI components, dark/light themes, markdown rendering, code syntax highlighting, and responsive layouts are active.",
      },
    ],
  },
];
