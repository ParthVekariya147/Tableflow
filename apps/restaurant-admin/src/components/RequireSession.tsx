import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { onSessionChange, supabase } from "../lib/supabase";
import { isImpersonating } from "../lib/auth";
import { api } from "../lib/api";

/**
 * Redirects to /login when there's no active Supabase session AND no active
 * impersonation token (an impersonation token is a complete bearer on its
 * own — see lib/auth.ts — so it satisfies this guard without a Supabase
 * session ever existing in this tab).
 */
export function RequireSession() {
  const [status, setStatus] = useState<"checking" | "authed" | "anon">(
    "checking",
  );

  useEffect(() => {
    if (isImpersonating()) {
      setStatus("authed");
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? "authed" : "anon");
      if (data.session) void api.auth.syncProfile().catch(() => {});
    });
    return onSessionChange((session) => {
      setStatus(session ? "authed" : "anon");
      if (session) void api.auth.syncProfile().catch(() => {});
    });
  }, []);

  if (status === "checking") return null;
  if (status === "anon") return <Navigate to="/login" replace />;
  return <Outlet />;
}
