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
    <div className="modal" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">Leaderboard</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="tabs">
          <button
            className={`tab ${tab === "top" ? "tab--active" : ""}`}
            onClick={() => setTab("top")}
          >
            Top Scores
          </button>
          <button
            className={`tab ${tab === "history" ? "tab--active" : ""}`}
            onClick={() => setTab("history")}
          >
            My Games
          </button>
        </div>
        <div className="modal__list">
          {loading ? (
            <div className="modal__empty">Loading...</div>
          ) : tab === "top" ? (
            topScores.length === 0 ? (
              <div className="modal__empty">No scores yet</div>
            ) : (
              topScores.map((e, i) => (
                <div key={i} className="modal__row">
                  <span className="modal__rank">#{i + 1}</span>
                  <span className="modal__name">{e.username}</span>
                  <span className="modal__score">{e.score}</span>
                </div>
              ))
            )
          ) : history.length === 0 ? (
            <div className="modal__empty">No games played yet</div>
          ) : (
            history.map((g) => (
              <div key={g.id} className="modal__row">
                <span className="modal__name">
                  {new Date(g.started_at).toLocaleDateString()}
                </span>
                <span className="modal__score">
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
