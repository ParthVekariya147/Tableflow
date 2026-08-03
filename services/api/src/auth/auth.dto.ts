import {
  changePasswordRequestSchema,
  loginRequestSchema,
  selectTenantRequestSchema,
  updateLastPaymentMethodRequestSchema,
} from "@amber/domain";

/** Validates POST /auth/login bodies (re-exports the domain schema). */
export const LoginDto = loginRequestSchema;

/** Validates POST /auth/select-tenant bodies. */
export const SelectTenantDto = selectTenantRequestSchema;

/** Validates POST /auth/change-password bodies. */
export const ChangePasswordDto = changePasswordRequestSchema;

/** Validates PATCH /auth/me/last-payment-method bodies. */
export const UpdateLastPaymentMethodDto = updateLastPaymentMethodRequestSchema;
