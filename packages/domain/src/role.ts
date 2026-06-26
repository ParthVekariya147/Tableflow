import { z } from "zod";
import { idSchema } from "./common.js";
import { permissionSchema } from "./permission.js";

/**
 * A custom, Admin-named role: a label + a bundle of permission keys, scoped to
 * one tenant. Roles are NOT a fixed enum — the Admin creates/renames/edits them
 * freely (Microsoft-style custom roles). The only fixed vocabulary is the
 * permission set (see permission.ts). See SETTINGS.md §B.
 */
export const roleSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  /** Free-text label chosen by the Admin, e.g. "Manager", "Head Chef". */
  name: z.string().min(1).max(60),
  /** The permission keys this role grants. */
  permissions: z.array(permissionSchema),
  /**
   * Protected roles can't be deleted and must keep `team.manage` — this is the
   * last-Admin lockout guard (a tenant can never strip its own admin access).
   */
  protected: z.boolean().default(false),
});

export type Role = z.infer<typeof roleSchema>;
