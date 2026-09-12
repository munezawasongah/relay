import type { User } from "@relay/shared";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe } from "../api/auth";
import { ensureKeysPublished } from "../crypto/bootstrap";

const TOKEN_KEY = "relay.session.token";

interface AuthState {
  isLoading: boolean;
  token: string | null;
  user: User | null;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // On launch, restore a previously saved session and confirm it's still valid.
  useEffect(() => {
    (async () => {
      try {
        const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (savedToken) {
          const me = await fetchMe(savedToken);
          setToken(savedToken);
          setUser(me);
          // Best-effort: a stale identity key or thin one-time-key pool
          // shouldn't block sign-in restoration. ensureKeysPublished is
          // idempotent, so the next successful launch/sign-in retries it.
          ensureKeysPublished(savedToken).catch((err) => {
            console.warn("[auth] ensureKeysPublished failed on restore", err);
          });
        }
      } catch {
        // Expired/invalid token, or auth-service unreachable — fall through to signed-out state.
        await SecureStore.deleteItemAsync(TOKEN_KEY);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isLoading,
      token,
      user,
      async signIn(newToken: string, newUser: User) {
        await SecureStore.setItemAsync(TOKEN_KEY, newToken);
        setToken(newToken);
        setUser(newUser);
        // Same best-effort reasoning as the restore path above.
        ensureKeysPublished(newToken).catch((err) => {
          console.warn("[auth] ensureKeysPublished failed on sign-in", err);
        });
      },
      async signOut() {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken(null);
        setUser(null);
      },
    }),
    [isLoading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
