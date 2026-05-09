import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";

type Role = "student" | "teacher" | "admin" | null;

interface AuthUser {
  role: Role;
  userId: string;
  fullName: string;
  email: string;
  token: string;
  avatar?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  role: Role;
  login: (email: string, password: string) => Promise<Role>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_URL = import.meta.env.VITE_API_URL;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem("auth");
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      return {
        role: parsed.role ?? null,
        userId: parsed.userId ?? "",
        fullName: parsed.fullName ?? "",
        email: parsed.email ?? "",
        token: parsed.token ?? "",
        avatar: parsed.avatar ?? "",
      };
    } catch {
      return null;
    }
  });

  // Always re-fetch /me on mount to get fresh name from DB
  useEffect(() => {
    if (!user?.token) return;

    fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((meData) => {
        console.log("useEffect /me response:", JSON.stringify(meData));
        if (!meData) return;

        const freshName = meData.full_name?.trim() || user.email?.split("@")[0] || "User";
        const updated: AuthUser = {
          ...user,
          fullName: freshName,
          email: meData.email ?? user.email,
        };
        setUser(updated);
        localStorage.setItem("auth", JSON.stringify(updated));
      })
      .catch(() => { });
  }, []);

  const login = async (email: string, password: string): Promise<Role> => {
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail ?? "Login failed");
    }

    const data = await res.json();
    console.log("Login raw response:", JSON.stringify(data));

    const meRes = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const meData = meRes.ok ? await meRes.json() : null;
    console.log("Login /me response:", JSON.stringify(meData));

    const authUser: AuthUser = {
      role: data.role as Role,
      userId: data.user_id,
      fullName:
        meData?.full_name?.trim() ||
        data.full_name?.trim() ||
        data.email?.split("@")[0] ||
        "User",
      email: meData?.email ?? data.email ?? "",
      token: data.access_token,
      avatar: meData?.avatar ?? "",
    };

    console.log("authUser being stored:", JSON.stringify(authUser));

    setUser(authUser);
    localStorage.setItem("auth", JSON.stringify(authUser));

    return authUser.role;
  };

  const logout = async () => {
    if (user?.token) {
      try {
        await fetch(`${API_URL}/api/v1/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${user.token}` },
        });
      } catch {
        // Network error — still clear client state
      }
    }

    setUser(null);
    localStorage.removeItem("auth");
  };

  return (
    <AuthContext.Provider value={{ user, role: user?.role ?? null, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};