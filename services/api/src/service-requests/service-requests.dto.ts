import { z } from "zod";
import { serviceRequestTypeSchema, serviceRequestStatusSchema } from "@amber/domain";

/** POST /service-requests — guest taps a Quick Action on the Welcome screen. */
export const createServiceRequestSchema = z.object({
  tableId: z.string().min(1),
  type: serviceRequestTypeSchema,
});
export type CreateServiceRequestDto = z.infer<typeof createServiceRequestSchema>;

/** PATCH /service-requests/:id — staff acknowledge/resolve. */
export const updateServiceRequestStatusSchema = z.object({
  status: serviceRequestStatusSchema,
});
export type UpdateServiceRequestStatusDto = z.infer<
  typeof updateServiceRequestStatusSchema
>;
