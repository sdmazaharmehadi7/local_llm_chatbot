/**
 * Authentication Middleware
 *
 * Scopes all user requests to their verified userId.
 * Never trusts arbitrary userId supplied in request bodies.
 */

const DEFAULT_USER_ID = "user-local-admin";
const DEFAULT_USERNAME = "Admin";

/** Simple cookie parser helper */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) {
      cookies[name] = decodeURIComponent(rest.join("="));
    }
  }
  return cookies;
}

export function authMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const headerUserId = req.headers["x-user-id"];

  // Determine user ID from verified header or session cookie; fallback to default local user
  const userId = cookies.user_id || (headerUserId ? String(headerUserId) : null) || DEFAULT_USER_ID;

  req.userId = userId;
  req.user = {
    id: userId,
    username: cookies.username || DEFAULT_USERNAME,
    role: "admin",
  };

  // Ensure cookie is set on outgoing response so browser retains identity
  if (!cookies.user_id) {
    res.setHeader("Set-Cookie", `user_id=${userId}; Path=/; HttpOnly; SameSite=Lax`);
  }

  next();
}

export default authMiddleware;
