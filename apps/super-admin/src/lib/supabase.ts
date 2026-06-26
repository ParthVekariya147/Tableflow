import { createClient, type Session } from "@supabase/supabase-js";

/**
 * Auth = Supabase Auth (see PLATFORM_PLAN.md "Architecture decisions").
 * Login itself is a direct supabase-js call from the UI — there is no
 * `POST /auth/login` on our API. `@amber/api-client`'s `request()` just
 * needs a synchronous bearer token getter, so we cache the current
 * session's access_token here and refresh it via `onAuthStateChange`
 * instead of awaiting `getSession()` on every call.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — auth calls will fail. See .env.example.",
  );
}

// `createClient` throws on an empty/invalid URL, which would otherwise
// white-screen the whole app before the warning above is even useful.
// Fall back to a syntactically-valid placeholder so the app still renders;
// real auth calls just fail at runtime until the env vars are set.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
);

let cachedToken: string | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token ?? null;
});

// Seed the cache on boot (onAuthStateChange only fires on the next change).
supabase.auth.getSession().then(({ data }) => {
  cachedToken = data.session?.access_token ?? null;
});

/** Synchronous accessor for `@amber/api-client`'s `getToken` config. */
export function getCachedAccessToken(): string | null {
  return cachedToken;
}

export function onSessionChange(
  handler: (session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) =>
    handler(session),
  );
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data.session;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
