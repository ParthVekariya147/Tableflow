import { z } from "zod";
import { idSchema } from "./common.js";
import { permissionSchema } from "./permission.js";
import { roleSchema } from "./role.js";

/**
 * A platform person, public shape (never carries passwordHash). The same human
 * can belong to several tenants via Memberships.
 */
export const userSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().min(1),
  isSuperAdmin: z.boolean().default(false),
  active: z.boolean().default(true),
});

/**
 * A user's place at one tenant: their role plus optional per-user permission
 * overrides. When `permissions` is set (non-empty) it is the user's COMPLETE
 * effective set (the Admin tuned them individually — supports both grant and
 * revoke vs. the role); otherwise the role's permissions apply. See
 * `effectivePermissions`.
 */
export const membershipSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  roleId: idSchema,
  /** Per-user override of the role's permissions; empty/absent = use the role. */
  permissions: z.array(permissionSchema).default([]),
  active: z.boolean().default(true),
  /** Joined for convenience in management lists. */
  user: userSchema.optional(),
  role: roleSchema.optional(),
});

/**
 * The authenticated "current user" the frontend reads after login: identity +
 * the active tenant + their role + RESOLVED effective permissions. This is what
 * drives nav filtering and route guards.
 */
export const authUserSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().min(1),
  isSuperAdmin: z.boolean().default(false),
  tenantId: idSchema,
  roleId: idSchema,
  roleName: z.string(),
  permissions: z.array(permissionSchema),
});

export type User = z.infer<typeof userSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;

/**
 * Resolve a membership's effective permissions: a non-empty per-user override
 * wins (full give-and-take), else the role's permissions. Central so the API
 * guard and the frontend `can()` always agree.
 */
export function effectivePermissions(
  rolePermissions: readonly z.infer<typeof permissionSchema>[],
  overridePermissions?: readonly z.infer<typeof permissionSchema>[] | null,
): z.infer<typeof permissionSchema>[] {
  return overridePermissions && overridePermissions.length > 0
    ? [...overridePermissions]
    : [...rolePermissions];
}
