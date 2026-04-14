import { useState, useEffect } from "react";
import { apiGet } from "./api.ts";

interface LeaderboardEntry {
  username: string;
  score: number;
  started_at: string;
}

interface GameSession {
  id: string;
  score: number;
  duration_seconds: number | null;
  started_at: string;
}

export function Leaderboard({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"top" | "history">("top");
  const [topScores, setTopScores] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<GameSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (tab === "top") {
      apiGet("/api/leaderboard?limit=10")
        .then((d) => setTopScores(d.entries))
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      apiGet("/api/game/sessions?limit=20")
        .then((d) => setHistory(d.sessions))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [tab]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Leaderboard</h2>
          <button style={styles.closeBtn} onClick={onClose}>x</button>
        </div>
        <div style={styles.tabs}>
          <button
            style={tab === "top" ? styles.tabActive : styles.tab}
            onClick={() => setTab("top")}
          >
            Top Scores
          </button>
          <button
            style={tab === "history" ? styles.tabActive : styles.tab}
            onClick={() => setTab("history")}
          >
            My Games
          </button>
        </div>
        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading...</div>
          ) : tab === "top" ? (
            topScores.length === 0 ? (
              <div style={styles.empty}>No scores yet</div>
            ) : (
              topScores.map((e, i) => (
                <div key={i} style={styles.row}>
                  <span style={styles.rank}>#{i + 1}</span>
                  <span style={styles.name}>{e.username}</span>
                  <span style={styles.score}>{e.score}</span>
                </div>
              ))
            )
          ) : history.length === 0 ? (
            <div style={styles.empty}>No games played yet</div>
          ) : (
            history.map((g) => (
              <div key={g.id} style={styles.row}>
                <span style={styles.name}>
                  {new Date(g.started_at).toLocaleDateString()}
                </span>
                <span style={styles.score}>
                  {g.score} pts
                  {g.duration_seconds != null && ` (${Math.floor(g.duration_seconds / 60)}m ${g.duration_seconds % 60}s)`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  panel: {
    background: "#1a2632",
    borderRadius: "12px",
    padding: "1.5rem",
    width: "380px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem",
  },
  title: {
    color: "#fff",
    margin: 0,
    fontSize: "1.3rem",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#8899aa",
    fontSize: "18px",
    cursor: "pointer",
  },
  tabs: {
    display: "flex",
    gap: "4px",
    marginBottom: "1rem",
  },
  tab: {
    flex: 1,
    padding: "6px",
    border: "none",
    borderRadius: "6px",
    background: "transparent",
    color: "#8899aa",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
  },
  tabActive: {
    flex: 1,
    padding: "6px",
    border: "none",
    borderRadius: "6px",
    background: "#6c5ce7",
    color: "#fff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
  },
  list: {
    flex: 1,
    overflowY: "auto",
  },
  row: {
    display: "flex",
    alignItems: "center",
    padding: "8px 4px",
    borderBottom: "1px solid #2a3a4a",
    gap: "8px",
  },
  rank: {
    color: "#6c5ce7",
    fontWeight: 700,
    width: "30px",
    fontSize: "13px",
  },
  name: {
    flex: 1,
    color: "#ccd6e0",
    fontSize: "13px",
  },
  score: {
    color: "#fff",
    fontWeight: 600,
    fontSize: "13px",
  },
  empty: {
    color: "#8899aa",
    textAlign: "center",
    padding: "2rem 0",
    fontSize: "13px",
  },
};
