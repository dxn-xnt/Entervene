import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Role = 'student' | 'teacher' | null;

interface AuthContextType {
  role: Role;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<Role>;
  logout: () => Promise<void>;
}

// Same credentials as the frontend (minus admin — mobile is teachers & students only)
const USERS = [
  { username: 'student', password: 'student123', role: 'student' as Role },
  { username: 'teacher', password: 'teacher123', role: 'teacher' as Role },
];

const STORAGE_KEY = '@entervene_role';

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [role, setRole] = useState<Role>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore persisted session on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'student' || stored === 'teacher') {
          setRole(stored);
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };
    restore();
  }, []);

  const login = async (username: string, password: string): Promise<Role> => {
    const match = USERS.find(
      (u) => u.username === username && u.password === password,
    );
    if (match) {
      setRole(match.role);
      await AsyncStorage.setItem(STORAGE_KEY, match.role as string);
      return match.role;
    }
    return null;
  };

  const logout = async () => {
    setRole(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ role, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
