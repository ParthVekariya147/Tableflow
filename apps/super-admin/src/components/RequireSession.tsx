import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { onSessionChange, supabase } from "../lib/supabase";
import { api } from "../api";

/** Redirects to /login when there's no active Supabase session. */
export function RequireSession() {
  const [status, setStatus] = useState<"checking" | "authed" | "anon">(
    "checking",
  );

  useEffect(() => {
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
