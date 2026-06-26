import { createApiClient } from "@amber/api-client";
import type { AuthUser } from "@amber/domain";
import { supabase, getCachedAccessToken } from "./lib/supabase";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const _client = createApiClient({ baseUrl, getToken: getCachedAccessToken });

/**
 * Extended api for super-admin: uses the Supabase access token (not our own
 * JWT) and adds `syncProfile` which reads the current Supabase user.
 */
export const api = {
  ..._client,
  auth: {
    ..._client.auth,
    syncProfile: async (): Promise<AuthUser> => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw new Error("Not authenticated");
      const u = data.user;
      return {
        id: u.id,
        email: u.email ?? "",
        name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? u.email ?? "Platform Admin",
        isSuperAdmin: true,
        tenantId: "",
        tenantSlug: "",
        roleId: "",
        roleName: "super-admin",
        roleProtected: true,
        permissions: [],
      };
    },
  },
};
