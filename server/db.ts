const kv = await Deno.openKv();

// --- Types ---

export interface User {
  id: string;
  username: string;
  password_hash: string;
  is_guest: boolean;
  created_at: string;
}

export interface Session {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface GameSession {
  id: string;
  user_id: string;
  score: number;
  duration_seconds: number | null;
  config_json: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface LeaderboardEntry {
  username: string;
  score: number;
  started_at: string;
}

// --- User queries ---

export async function createUser(username: string, passwordHash: string): Promise<User> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const user: User = { id, username, password_hash: passwordHash, is_guest: false, created_at: now };

  const result = await kv.atomic()
    .check({ key: ["users_by_username", username.toLowerCase()], versionstamp: null })
    .set(["users", id], user)
    .set(["users_by_username", username.toLowerCase()], id)
    .commit();

  if (!result.ok) throw new Error("Username already taken");
  return user;
}

export async function createGuestUser(): Promise<User> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const suffix = id.slice(0, 6);
  const username = `Guest_${suffix}`;
  const now = new Date().toISOString();
  const user: User = { id, username, password_hash: "", is_guest: true, created_at: now };

  await kv.atomic()
    .set(["users", id], user)
    .set(["users_by_username", username.toLowerCase()], id)
    .commit();

  return user;
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const idEntry = await kv.get<string>(["users_by_username", username.toLowerCase()]);
  if (!idEntry.value) return null;
  const userEntry = await kv.get<User>(["users", idEntry.value]);
  return userEntry.value;
}

export async function findUserById(id: string): Promise<User | null> {
  const entry = await kv.get<User>(["users", id]);
  return entry.value;
}

// --- Session queries ---

const SESSION_DURATION_DAYS = 7;
const GUEST_SESSION_DURATION_DAYS = 1;

export async function createSession(userId: string, isGuest = false): Promise<Session> {
  const token = crypto.randomUUID();
  const now = new Date();
  const days = isGuest ? GUEST_SESSION_DURATION_DAYS : SESSION_DURATION_DAYS;
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const session: Session = {
    token,
    user_id: userId,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  await kv.atomic()
    .set(["sessions", token], session, { expireIn: days * 24 * 60 * 60 * 1000 })
    .commit();

  return session;
}

export async function findSession(token: string): Promise<Session | null> {
  const entry = await kv.get<Session>(["sessions", token]);
  if (!entry.value) return null;
  if (new Date(entry.value.expires_at) <= new Date()) {
    await kv.delete(["sessions", token]);
    return null;
  }
  return entry.value;
}

export async function deleteSession(token: string): Promise<void> {
  await kv.delete(["sessions", token]);
}

export async function deleteExpiredSessions(): Promise<void> {
  // KV expireIn handles this automatically — no-op
}

// --- Game session queries ---

// Pad score for lexicographic DESC ordering: 999999999 - score
function invertScore(score: number): string {
  return String(999999999 - score).padStart(9, "0");
}

export async function saveGameSession(
  userId: string,
  score: number,
  durationSeconds: number | null,
  configJson: string | null,
): Promise<GameSession> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const session: GameSession = {
    id,
    user_id: userId,
    score,
    duration_seconds: durationSeconds,
    config_json: configJson,
    started_at: now,
    ended_at: now,
  };

  const user = await findUserById(userId);
  const username = user?.username ?? "Unknown";

  await kv.atomic()
    .set(["game_sessions", id], session)
    .set(["game_sessions_by_user", userId, now, id], id)
    .set(["leaderboard", invertScore(score), id], { username, score, started_at: now } satisfies LeaderboardEntry)
    .commit();

  return session;
}

export async function getUserGameHistory(userId: string, limit = 20): Promise<GameSession[]> {
  const sessions: GameSession[] = [];
  const iter = kv.list<string>({ prefix: ["game_sessions_by_user", userId] }, { reverse: true, limit });
  for await (const entry of iter) {
    const gs = await kv.get<GameSession>(["game_sessions", entry.value]);
    if (gs.value) sessions.push(gs.value);
  }
  return sessions;
}

export async function getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const entries: LeaderboardEntry[] = [];
  const iter = kv.list<LeaderboardEntry>({ prefix: ["leaderboard"] }, { limit });
  for await (const entry of iter) {
    entries.push(entry.value);
  }
  return entries;
}

export { kv };
