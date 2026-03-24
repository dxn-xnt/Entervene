import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

type Role = "student" | "teacher" | "admin" | null;

interface AuthContextType {
  role: Role;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

const USERS = [
  { username: "student", password: "student123", role: "student" as Role },
  { username: "teacher", password: "teacher123", role: "teacher" as Role },
  { username: "admin", password: "admin123", role: "admin" as Role },
];

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [role, setRole] = useState<Role>(null);

  const login = (username: string, password: string): boolean => {
    const match = USERS.find(
      (u) => u.username === username && u.password === password,
    );
    if (match) {
      setRole(match.role);
      return true;
    }
    return false;
  };

  const logout = () => setRole(null);

  return (
    <AuthContext.Provider value={{ role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
