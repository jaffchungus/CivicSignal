import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { PublicUser, SessionResponse, SetupStatus } from "../../shared/contracts";
import { api, errorDetails } from "./api";

type SignUpInput = {
  displayName: string;
  email: string;
  password: string;
  role?: "RESIDENT" | "OFFICIAL" | "LAW_ENFORCEMENT";
  organizationId?: string;
};

type AuthContextValue = {
  user: PublicUser | null;
  setupRequired: boolean;
  loading: boolean;
  loadError: string | null;
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<PublicUser>;
  signUp: (input: SignUpInput) => Promise<PublicUser>;
  completeSetup: (user: PublicUser) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [session, setup] = await Promise.all([
        api.get<SessionResponse>("/api/auth/session"),
        api.get<SetupStatus>("/api/setup/status"),
      ]);
      setUser(session.user);
      setSetupRequired(setup.setupRequired);
      setSessionExpired(false);
    } catch (error) {
      setLoadError(errorDetails(error).message);
      throw error;
    }
  }, []);

  useEffect(() => {
    const expireSession = () => {
      setUser(null);
      setSessionExpired(true);
    };
    window.addEventListener("civicsignal:session-expired", expireSession);
    return () => window.removeEventListener("civicsignal:session-expired", expireSession);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => {
        setUser(null);
        setSetupRequired(false);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const body = await api.post<{ user: PublicUser }>("/api/auth/login", {
      email,
      password,
    });
    setUser(body.user);
    setSessionExpired(false);
    return body.user;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const body = await api.post<{ user: PublicUser }>("/api/auth/register", input);
    setUser(body.user);
    setSessionExpired(false);
    return body.user;
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUser(null);
    setSessionExpired(false);
  }, []);

  const completeSetup = useCallback((nextUser: PublicUser) => {
    setUser(nextUser);
    setSetupRequired(false);
    setLoadError(null);
    setSessionExpired(false);
  }, []);

  const value = useMemo(
    () => ({ user, setupRequired, loading, loadError, sessionExpired, signIn, signUp, signOut, completeSetup, refresh }),
    [user, setupRequired, loading, loadError, sessionExpired, signIn, signUp, signOut, completeSetup, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider.");
  }
  return context;
}
