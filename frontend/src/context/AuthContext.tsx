import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";

type Role = "student" | "teacher" | "admin" | null;

interface AuthUser {
  role: Role;
  userId: string;
  fullName: string;
  email: string;
  avatar?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  role: Role;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<Role>;
  acceptInvitation: (token: string, password: string, confirmPassword: string) => Promise<Role>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  updateAvatar: (avatarPath: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function userFromAuthResponse(data: {
  role: Role;
  user_id: string;
  full_name?: string;
  email?: string;
  avatar?: string;
}): AuthUser {
  const storedAvatar = localStorage.getItem(`avatar_${data.user_id}`);
  const defaultAvatar = data.role === "student"
    ? "/avatars/student-avatars/1.svg"
    : "/avatars/teacher-avatars/12.svg";
  return {
    role: data.role,
    userId: data.user_id,
    fullName: data.full_name?.trim() || data.email?.split("@")[0] || "User",
    email: data.email ?? "",
    avatar: data.avatar || storedAvatar || defaultAvatar,
  };
}

async function userWithSavedAvatar(data: Parameters<typeof userFromAuthResponse>[0]): Promise<AuthUser> {
  const storedAvatar = localStorage.getItem(`avatar_${data.user_id}`);
  if (!data.avatar && storedAvatar) {
    try {
      const res = await apiFetch("/api/v1/auth/me/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: storedAvatar }),
      });
      if (res.ok) data.avatar = storedAvatar;
    } catch {
      // The local avatar remains visible until it can be saved to the account.
    }
  }
  return userFromAuthResponse(data);
}

function getErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (Array.isArray(err)) {
    return err
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String(item.msg);
        }
        return String(item);
      })
      .join(", ");
  }
  return "Login failed";
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async (): Promise<boolean> => {
    const res = await apiFetch("/api/v1/auth/refresh", { method: "POST" });
    if (!res.ok) {
      setUser(null);
      return false;
    }

    const data = await res.json();
    setUser(await userWithSavedAvatar(data));
    return true;
  };

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        let res = await apiFetch("/api/v1/auth/me");
        if (res.status === 401) {
          const refreshed = await refresh();
          if (!refreshed) return;
          res = await apiFetch("/api/v1/auth/me");
        }
        if (!cancelled && res.ok) {
          const meData = await res.json();
          setUser(await userWithSavedAvatar(meData));
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string): Promise<Role> => {
    const res = await apiFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(err.detail));
    }

    const data = await res.json();
    const authUser = await userWithSavedAvatar(data);
    setUser(authUser);
    return authUser.role;
  };

  const acceptInvitation = async (
    token: string,
    password: string,
    confirmPassword: string,
  ): Promise<Role> => {
    const res = await apiFetch("/api/v1/auth/accept-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, confirm_password: confirmPassword }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? "Unable to activate account");
    }

    const data = await res.json();
    const refreshed = await refresh();
    if (refreshed) return data.role;

    const authUser = await userWithSavedAvatar(data);
    setUser(authUser);
    return authUser.role;
  };

  const logout = async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  };

  const updateAvatar = async (avatarPath: string): Promise<void> => {
    if (user) {
      const res = await apiFetch("/api/v1/auth/me/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: avatarPath }),
      });
      if (!res.ok) throw new Error("Unable to save avatar. Please try again.");
      localStorage.setItem(`avatar_${user.userId}`, avatarPath);
      setUser((current) => current ? { ...current, avatar: avatarPath } : current);
    }
  };

  return (
    <AuthContext.Provider value={{ user, role: user?.role ?? null, isLoading, login, acceptInvitation, logout, refresh, updateAvatar }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
