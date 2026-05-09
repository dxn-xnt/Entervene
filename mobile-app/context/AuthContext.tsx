import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Role = 'student' | 'teacher' | 'admin' | null;

interface UserSession {
  token: string;
  role: Role;
  user_id: string;
  full_name: string;
  email: string;
}

interface AuthContextType {
  role: Role;
  session: UserSession | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<Role>;
  logout: () => Promise<void>;
}

const STORAGE_KEY = '@entervene_session';
const API_URL = process.env.EXPO_PUBLIC_API_URL;

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restore = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: UserSession = JSON.parse(stored);
          setSession(parsed);
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };
    restore();
  }, []);

  const login = async (email: string, password: string): Promise<Role> => {
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Login failed');
    }

    const data = await response.json();

    const newSession: UserSession = {
      token: data.access_token,
      role: data.role,
      user_id: data.user_id,
      full_name: data.full_name,
      email: email,
    };

    setSession(newSession);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    return data.role;
  };

  const logout = async () => {
    setSession(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ role: session?.role ?? null, session, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};