import {
  createPlanSchema,
  setSubscriptionSchema,
  updatePlanSchema,
  updateSubscriptionStatusSchema,
  type CreatePlanInput,
  type SetSubscriptionInput,
  type UpdatePlanInput,
  type UpdateSubscriptionStatusInput,
} from "@amber/domain";

export {
  createPlanSchema,
  setSubscriptionSchema,
  updatePlanSchema,
  updateSubscriptionStatusSchema,
};
export type CreatePlanDto = CreatePlanInput;
export type UpdatePlanDto = UpdatePlanInput;
export type SetSubscriptionDto = SetSubscriptionInput;
export type UpdateSubscriptionStatusDto = UpdateSubscriptionStatusInput;
