import { z } from "zod";
import { permissionSchema } from "@amber/domain";

/** Add a person to the restaurant (creates the user if new). */
export const AddMemberDto = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  roleId: z.string().min(1),
  /** Optional per-user override; empty = inherit the role. */
  permissions: z.array(permissionSchema).default([]),
});

/** Change a member's role, per-user permission override, or active state. */
export const UpdateMemberDto = z.object({
  roleId: z.string().min(1).optional(),
  permissions: z.array(permissionSchema).optional(),
  active: z.boolean().optional(),
});
