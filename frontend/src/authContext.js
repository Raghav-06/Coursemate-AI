import { createContext, useContext } from "react";
import { api } from "./api";

// The auth context and helpers (the provider is in auth.jsx).

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

/** Full-page redirect into Google OAuth; comes back to the current page. */
export function signInWithGoogle() {
  const returnTo = `/${window.location.hash || ""}`;
  window.location.href = `${api.base}/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
}
