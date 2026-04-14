import { Database } from "@db/sqlite";

const DB_PATH = "./data/minipaths.db";

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// --- Migrations ---

db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`);

const migrations: string[] = [
  // v1: core tables
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE game_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    config_json TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );
  CREATE INDEX idx_game_sessions_user ON game_sessions(user_id);
  CREATE INDEX idx_game_sessions_score ON game_sessions(score DESC);

  CREATE TABLE rooms (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    max_players INTEGER NOT NULL DEFAULT 4,
    state TEXT NOT NULL DEFAULT 'waiting',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (room_id, user_id)
  );
  `,
];

function runMigrations() {
  const row = db.prepare("SELECT MAX(version) as v FROM _migrations").get() as
    | { v: number | null }
    | undefined;
  const current = row?.v ?? 0;

  for (let i = current; i < migrations.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[i]);
      db.exec(`INSERT INTO _migrations VALUES (${i + 1})`);
      db.exec("COMMIT");
      console.log(`Migration ${i + 1} applied`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

runMigrations();

// --- Types ---

export interface User {
  id: string;
  username: string;
  password_hash: string;
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

export function createUser(username: string, passwordHash: string): User {
  const id = crypto.randomUUID().replace(/-/g, "");
  db.prepare(
    "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
  ).run(id, username, passwordHash);
  return findUserById(id)!;
}

export function findUserByUsername(username: string): User | null {
  return (
    (db
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(username) as User | undefined) ?? null
  );
}

export function findUserById(id: string): User | null {
  return (
    (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | User
      | undefined) ?? null
  );
}

// --- Session queries ---

const SESSION_DURATION_DAYS = 7;

export function createSession(userId: string): Session {
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(token, userId, expiresAt);
  return { token, user_id: userId, created_at: new Date().toISOString(), expires_at: expiresAt };
}

export function findSession(token: string): Session | null {
  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .get(token) as Session | undefined;
  return session ?? null;
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function deleteExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// --- Game session queries ---

export function saveGameSession(
  userId: string,
  score: number,
  durationSeconds: number | null,
  configJson: string | null,
): GameSession {
  const id = crypto.randomUUID().replace(/-/g, "");
  db.prepare(
    `INSERT INTO game_sessions (id, user_id, score, duration_seconds, config_json, ended_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(id, userId, score, durationSeconds, configJson);
  return db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(id) as GameSession;
}

export function getUserGameHistory(userId: string, limit = 20): GameSession[] {
  return db
    .prepare(
      "SELECT * FROM game_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(userId, limit) as GameSession[];
}

export function getLeaderboard(limit = 10): LeaderboardEntry[] {
  return db
    .prepare(
      `SELECT u.username, g.score, g.started_at
       FROM game_sessions g JOIN users u ON g.user_id = u.id
       ORDER BY g.score DESC LIMIT ?`,
    )
    .all(limit) as LeaderboardEntry[];
}

export { db };
