import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { apiPost, apiGet, ApiError } from "./api.ts";

interface UserInfo {
  id: string;
  username: string;
}

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiPost("/api/auth/login", { username, password });
    setUser(data.user);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const data = await apiPost("/api/auth/register", { username, password });
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await apiPost("/api/auth/logout");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
