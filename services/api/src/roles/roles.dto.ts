import { z } from "zod";
import { permissionSchema } from "@amber/domain";

/** Create a custom, Admin-named role. */
export const CreateRoleDto = z.object({
  name: z.string().min(1).max(60),
  permissions: z.array(permissionSchema).default([]),
});

/** Rename a role and/or change its permission bundle. */
export const UpdateRoleDto = z.object({
  name: z.string().min(1).max(60).optional(),
  permissions: z.array(permissionSchema).optional(),
});
