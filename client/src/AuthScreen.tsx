import { useState } from "react";
import { useAuth, ApiError } from "./AuthContext.tsx";

export function AuthScreen() {
  const { login, register, loginAsGuest } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuest = async () => {
    setError("");
    setSubmitting(true);
    try {
      await loginAsGuest();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="center">
      <div className="card">
        <h1 className="card__title">Minipaths</h1>
        <div className="tabs">
          <button
            type="button"
            className={`tab ${mode === "login" ? "tab--active" : ""}`}
            onClick={() => { setMode("login"); setError(""); }}
          >
            Login
          </button>
          <button
            type="button"
            className={`tab ${mode === "register" ? "tab--active" : ""}`}
            onClick={() => { setMode("register"); setError(""); }}
          >
            Register
          </button>
        </div>
        <form onSubmit={handleSubmit} className="form">
          <input
            className="input"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
          {error && <div className="error">{error}</div>}
          <button className="btn btn--primary btn--block" type="submit" disabled={submitting}>
            {submitting ? "..." : mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>
        <div className="divider">or</div>
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={handleGuest}
          disabled={submitting}
        >
          Play as Guest
        </button>
      </div>
    </div>
  );
}
