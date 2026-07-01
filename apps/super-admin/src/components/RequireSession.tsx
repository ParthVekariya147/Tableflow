import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { onSessionChange, supabase } from "../lib/supabase";
import { api } from "../api";

/** Redirects to /login when there's no active Supabase session. */
export function RequireSession() {
  const [status, setStatus] = useState<"checking" | "authed" | "anon">(
    "checking",
  );
  // `getSession()` below and `onSessionChange`'s subscription both resolve
  // with the SAME initial session on mount (onAuthStateChange fires an
  // INITIAL_SESSION event as soon as it's subscribed) — track the last
  // access token we've synced so that doesn't fire `syncProfile` twice.
  const syncedTokenRef = useRef<string | null>(null);
  const maybeSync = (session: { access_token: string } | null) => {
    if (!session || syncedTokenRef.current === session.access_token) return;
    syncedTokenRef.current = session.access_token;
    void api.auth.syncProfile().catch(() => {});
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? "authed" : "anon");
      maybeSync(data.session);
    });
    return onSessionChange((session) => {
      setStatus(session ? "authed" : "anon");
      maybeSync(session);
    });
  }, []);

  if (status === "checking") return null;
  if (status === "anon") return <Navigate to="/login" replace />;
  return <Outlet />;
}
