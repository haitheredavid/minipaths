import { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { hashSync, compareSync } from "bcrypt";
import {
  createUser,
  findUserByUsername,
  findUserById,
  createSession,
  findSession,
  deleteSession,
  type User,
} from "./db.ts";

// --- Validation ---

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MIN_PASSWORD_LENGTH = 6;

function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return "Username must be 3-20 characters (letters, numbers, underscores)";
  }
  return null;
}

function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

// --- Auth functions ---

export async function register(
  username: string,
  password: string,
): Promise<{ user: User; token: string }> {
  const usernameErr = validateUsername(username);
  if (usernameErr) throw new AuthError(usernameErr, 400);

  const passwordErr = validatePassword(password);
  if (passwordErr) throw new AuthError(passwordErr, 400);

  const existing = findUserByUsername(username);
  if (existing) throw new AuthError("Username already taken", 409);

  const passwordHash = hashSync(password);
  const user = createUser(username, passwordHash);
  const session = createSession(user.id);
  return { user, token: session.token };
}

export async function login(
  username: string,
  password: string,
): Promise<{ user: User; token: string }> {
  const user = findUserByUsername(username);
  if (!user) throw new AuthError("Invalid username or password", 401);

  const valid = compareSync(password, user.password_hash);
  if (!valid) throw new AuthError("Invalid username or password", 401);

  const session = createSession(user.id);
  return { user, token: session.token };
}

export function logout(token: string): void {
  deleteSession(token);
}

// --- Cookie helpers ---

const COOKIE_NAME = "session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: false, // set true in production behind HTTPS
    sameSite: "Lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export function getSessionToken(c: Context): string | undefined {
  return getCookie(c, COOKIE_NAME);
}

// --- Middleware ---

// Global middleware: populates c.get("userId") and c.get("user") if valid session exists.
// Does NOT block unauthenticated requests.
export async function sessionMiddleware(c: Context, next: Next) {
  const token = getSessionToken(c);
  if (token) {
    const session = findSession(token);
    if (session) {
      const user = findUserById(session.user_id);
      if (user) {
        c.set("userId", user.id);
        c.set("user", { id: user.id, username: user.username });
      }
    }
  }
  await next();
}

// Guard middleware: returns 401 if no authenticated user.
export async function requireAuth(c: Context, next: Next) {
  if (!c.get("userId")) {
    return c.json({ error: "Authentication required" }, 401);
  }
  await next();
}

// --- Parse cookie from raw header (for WebSocket upgrade) ---

export function parseSessionFromCookieHeader(
  cookieHeader: string | null,
): { userId: string; username: string } | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;
  const token = match[1];
  const session = findSession(token);
  if (!session) return null;
  const user = findUserById(session.user_id);
  if (!user) return null;
  return { userId: user.id, username: user.username };
}

// --- Error class ---

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
