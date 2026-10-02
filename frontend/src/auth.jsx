import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, UNAUTHORIZED_EVENT } from "./api";

const AuthContext = createContext(null);

/**
 * Holds the signed-in Google user. `user` is undefined while loading, null
 * when signed out. Any API call that returns 401 signs the app out.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.me().then(setUser, (err) => {
      setUser(null);
      if (err.status !== 401) setError(err.message);
    });
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      window.location.hash = "/";
    }
  }, []);

  return <AuthContext.Provider value={{ user, error, signOut, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Full-page redirect into Google OAuth; comes back to the current page. */
export function signInWithGoogle() {
  const returnTo = `/${window.location.hash || ""}`;
  window.location.href = `${api.base}/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
}
