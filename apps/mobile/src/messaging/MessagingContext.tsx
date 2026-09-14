import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { connectSocket, type RelaySocket } from "./socket";

interface MessagingState {
  socket: RelaySocket | null;
  isConnected: boolean;
}

const MessagingContext = createContext<MessagingState>({ socket: null, isConnected: false });

/** Owns exactly one socket.io connection for the lifetime of a signed-in
 *  session — created when a token appears (sign-in or restored session),
 *  torn down on sign-out or unmount. Sits inside AuthProvider (needs
 *  useAuth) and wraps the navigator in App.tsx, so every screen shares one
 *  connection via useMessaging() instead of racing separate ones. */
export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState<RelaySocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setIsConnected(false);
      return;
    }

    const nextSocket = connectSocket(token);
    nextSocket.on("connect", () => setIsConnected(true));
    nextSocket.on("disconnect", () => setIsConnected(false));
    nextSocket.on("connect_error", (err) => {
      console.warn("[messaging] connect_error", err.message);
      setIsConnected(false);
    });
    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, [token]);

  const value = useMemo<MessagingState>(() => ({ socket, isConnected }), [socket, isConnected]);

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging(): MessagingState {
  return useContext(MessagingContext);
}
