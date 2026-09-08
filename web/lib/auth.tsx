import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Me, Role } from "@shared/types";
import { hasRole } from "@shared/types";
import { api, ApiError, setCsrfToken } from "./api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  setMe: (me: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (min: Role) => boolean;
}

const AuthContext = createContext<AuthState>({
  me: null,
  loading: true,
  setMe: () => undefined,
  refresh: async () => undefined,
  logout: async () => undefined,
  can: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/api/auth/me");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (query.data?.csrf_token) setCsrfToken(query.data.csrf_token);
    if (query.data?.language) localStorage.setItem("ff_lang", query.data.language);
  }, [query.data]);

  const value = useMemo<AuthState>(
    () => ({
      me: query.data ?? null,
      loading: query.isLoading,
      setMe: (me) => {
        if (me?.csrf_token) setCsrfToken(me.csrf_token);
        qc.setQueryData(["me"], me);
      },
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: ["me"] });
      },
      logout: async () => {
        try {
          await api.post("/api/auth/logout");
        } finally {
          setCsrfToken("");
          qc.clear();
          qc.setQueryData(["me"], null);
        }
      },
      can: (min) => !!query.data && hasRole(query.data.role, min),
    }),
    [query.data, query.isLoading, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
