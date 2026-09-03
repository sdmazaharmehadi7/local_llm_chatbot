/**
 * Centralized API service layer for communicating with the Node.js/Express backend.
 * Architecture:
 * React -> api/service layer -> http://localhost:5000 (Express) -> Ollama (http://localhost:11434)
 */

export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "http://localhost:5000" : "");

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
    id: "ollama-llama3.2",
    model_id: "llama3.2:latest",
    name: "Llama 3.2",
    display_name: "Llama 3.2 (Local)",
    provider: "ollama",
    provider_id: "ollama",
    type: "text",
    enabled: true,
    is_default: true,
    context_window: 128000,
    metadata: {
      supports_tools: true,
      description: "Meta Llama 3.2 local model via Ollama",
    },
  },
  {
    id: "ollama-deepseek-r1",
    model_id: "deepseek-r1:latest",
    name: "DeepSeek R1",
    display_name: "DeepSeek R1 (Reasoning)",
    provider: "ollama",
    provider_id: "ollama",
    type: "text",
    enabled: true,
    is_default: false,
    context_window: 64000,
    metadata: {
      supports_tools: false,
      description: "DeepSeek R1 reasoning model with <think> block parsing",
    },
  },
  {
    id: "ollama-mistral",
    model_id: "mistral:latest",
    name: "Mistral",
    display_name: "Mistral 7B (Local)",
    provider: "ollama",
    provider_id: "ollama",
    type: "text",
    enabled: true,
    is_default: false,
    context_window: 32000,
    metadata: {
      supports_tools: true,
      description: "Mistral 7B local model via Ollama",
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
      "# Welcome to Local Chat!\n\nThis frontend is running on **React + Vite + Tailwind CSS**.\n\n### Status\n- Ready to connect to your Node.js/Express backend on `http://localhost:5000`.\n- Designed for local Ollama open-weight models (`llama3.2`, `deepseek-r1`, etc.).\n- All Local Chat UI components, dark/light themes, markdown rendering, code syntax highlighting, and responsive layouts are active.",
    created_at: new Date().toISOString(),
    parts: [
      {
        type: "text",
        text: "# Welcome to Local Chat!\n\nThis frontend is running on **React + Vite + Tailwind CSS**.\n\n### Status\n- Ready to connect to your Node.js/Express backend on `http://localhost:5000`.\n- Designed for local Ollama open-weight models (`llama3.2`, `deepseek-r1`, etc.).\n- All Local Chat UI components, dark/light themes, markdown rendering, code syntax highlighting, and responsive layouts are active.",
      },
    ],
  },
];
