import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serveStatic } from "hono/deno";
import { handleWebSocket } from "./messages.ts";
import {
  sessionMiddleware,
  requireAuth,
  register,
  login,
  logout,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  AuthError,
} from "./auth.ts";
import {
  saveGameSession,
  getUserGameHistory,
  getLeaderboard,
  deleteExpiredSessions,
} from "./db.ts";

type Env = {
  Variables: {
    userId: string;
    user: { id: string; username: string };
  };
};

const app = new Hono<Env>();

// Global session middleware — populates user context if valid cookie
app.use("*", sessionMiddleware);

// --- Auth routes ---

const auth = new Hono<Env>();

auth.post("/register", async (c) => {
  try {
    const { username, password } = await c.req.json();
    const { user, token } = await register(username, password);
    setSessionCookie(c, token);
    return c.json({ user: { id: user.id, username: user.username } }, 201);
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    throw e;
  }
});

auth.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json();
    const { user, token } = await login(username, password);
    setSessionCookie(c, token);
    return c.json({ user: { id: user.id, username: user.username } });
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    throw e;
  }
});

auth.post("/logout", (c) => {
  const token = getSessionToken(c);
  if (token) logout(token);
  clearSessionCookie(c);
  return c.json({});
});

auth.get("/me", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  return c.json({ user });
});

app.route("/api/auth", auth);

// --- Game routes (authenticated) ---

const game = new Hono<Env>();
game.use("*", requireAuth);

game.post("/sessions", async (c) => {
  const userId = c.get("userId") as string;
  const { score, durationSeconds, config } = await c.req.json();
  const session = saveGameSession(
    userId,
    score ?? 0,
    durationSeconds ?? null,
    config ? JSON.stringify(config) : null,
  );
  return c.json({ gameSession: session }, 201);
});

game.get("/sessions", (c) => {
  const userId = c.get("userId") as string;
  const limit = Number(c.req.query("limit") ?? 20);
  const sessions = getUserGameHistory(userId, limit);
  return c.json({ sessions });
});

app.route("/api/game", game);

// --- Public leaderboard ---

app.get("/api/leaderboard", (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  return c.json({ entries: getLeaderboard(limit) });
});

// --- Existing routes ---

app.get("/api/hello", (c) => {
  return c.json({ message: "Hello from Deno!" });
});

// WebSocket endpoint
app.get("/ws", (c) => {
  return handleWebSocket(c.req.raw);
});

// Serve static files in production
app.use("/*", serveStatic({ root: "./dist" }));

// SPA fallback — serve index.html for unmatched routes
app.get("*", async (c) => {
  try {
    const html = await Deno.readTextFile("./dist/index.html");
    return c.html(html);
  } catch {
    return c.text("Not found", 404);
  }
});

// --- Periodic cleanup ---
setInterval(() => deleteExpiredSessions(), 60 * 60 * 1000); // hourly

const port = Number(Deno.env.get("PORT") ?? 8000);
console.log(`Server running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
