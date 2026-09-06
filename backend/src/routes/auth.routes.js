/**
 * Auth Routes
 *
 * Provides session status, login, register, and logout endpoints.
 */

import { Router } from "express";

const router = Router();

router.get("/session", (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});

router.post("/login", (req, res) => {
  const { username } = req.body || {};
  const user = {
    id: req.userId || "user-local-admin",
    username: username || "Admin",
    role: "admin",
  };
  res.setHeader("Set-Cookie", `user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ success: true, user });
});

router.post("/register", (req, res) => {
  const { username } = req.body || {};
  const user = {
    id: "user-" + Date.now(),
    username: username || "User",
    role: "admin",
  };
  res.setHeader("Set-Cookie", `user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ success: true, user });
});

router.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "user_id=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
  res.json({ success: true });
});

export default router;
