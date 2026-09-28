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
import { api } from "./api";

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
  signIn: (email: string, password: string) => Promise<PublicUser>;
  signUp: (input: SignUpInput) => Promise<PublicUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [session, setup] = await Promise.all([
      api.get<SessionResponse>("/api/auth/session"),
      api.get<SetupStatus>("/api/setup/status"),
    ]);
    setUser(session.user);
    setSetupRequired(setup.setupRequired);
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
    return body.user;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const body = await api.post<{ user: PublicUser }>("/api/auth/register", input);
    setUser(body.user);
    return body.user;
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setupRequired, loading, signIn, signUp, signOut, refresh }),
    [user, setupRequired, loading, signIn, signUp, signOut, refresh],
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
