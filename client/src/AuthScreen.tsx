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

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>Minipaths</h1>
        <div style={styles.tabs}>
          <button
            style={mode === "login" ? styles.tabActive : styles.tab}
            onClick={() => { setMode("login"); setError(""); }}
          >
            Login
          </button>
          <button
            style={mode === "register" ? styles.tabActive : styles.tab}
            onClick={() => { setMode("register"); setError(""); }}
          >
            Register
          </button>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
          {error && <div style={styles.error}>{error}</div>}
          <button style={styles.button} type="submit" disabled={submitting}>
            {submitting ? "..." : mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>
        <div style={styles.divider}>
          <span style={styles.dividerText}>or</span>
        </div>
        <button
          style={styles.guestButton}
          onClick={async () => {
            setError("");
            setSubmitting(true);
            try {
              await loginAsGuest();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Something went wrong");
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
        >
          Play as Guest
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "#0f1923",
    fontFamily: "system-ui",
  },
  card: {
    background: "#1a2632",
    borderRadius: "12px",
    padding: "2rem",
    width: "340px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
  },
  title: {
    color: "#fff",
    textAlign: "center" as const,
    margin: "0 0 1.5rem",
    fontSize: "1.8rem",
    letterSpacing: "0.05em",
  },
  tabs: {
    display: "flex",
    gap: "4px",
    marginBottom: "1.2rem",
  },
  tab: {
    flex: 1,
    padding: "8px",
    border: "none",
    borderRadius: "6px",
    background: "transparent",
    color: "#8899aa",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },
  tabActive: {
    flex: 1,
    padding: "8px",
    border: "none",
    borderRadius: "6px",
    background: "#6c5ce7",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
  },
  input: {
    padding: "10px 14px",
    borderRadius: "6px",
    border: "1px solid #2a3a4a",
    background: "#0f1923",
    color: "#fff",
    fontSize: "14px",
    outline: "none",
  },
  error: {
    color: "#ff7b5c",
    fontSize: "13px",
    textAlign: "center" as const,
  },
  button: {
    padding: "10px",
    borderRadius: "6px",
    border: "none",
    background: "#6c5ce7",
    color: "#fff",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 600,
    marginTop: "4px",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "16px 0 4px",
  },
  dividerText: {
    color: "#8899aa",
    fontSize: "13px",
    flex: 1,
    textAlign: "center" as const,
  },
  guestButton: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    border: "1px solid #2a3a4a",
    background: "transparent",
    color: "#8899aa",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },
};
