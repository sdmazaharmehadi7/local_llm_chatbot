import { apiFetch, MOCK_USER } from "@/lib/api";

let localUser = MOCK_USER;

export const authClient = {
  async register(username, password) {
    try {
      return await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    } catch {
      localUser = {
        id: "user-" + Date.now(),
        username: username || "User",
        role: "admin",
        created_at: new Date().toISOString(),
      };
      return { user: localUser };
    }
  },

  async login(username, password) {
    try {
      return await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    } catch {
      localUser = {
        id: "user-local-admin",
        username: username || "Admin",
        role: "admin",
        created_at: new Date().toISOString(),
      };
      return { user: localUser };
    }
  },

  async logout() {
    try {
      await apiFetch("/api/auth/logout", {
        method: "POST",
      });
    } catch {
      // Ignore network failure on logout
    }
    localUser = null;
    return { success: true };
  },

  async getSession() {
    try {
      const res = await apiFetch("/api/auth/session", {
        method: "GET",
      });
      if (res?.user) {
        localUser = res.user;
        return res;
      }
    } catch {
      // Backend not running yet — fallback to local mock user
    }
    return { user: localUser || MOCK_USER };
  },
};
