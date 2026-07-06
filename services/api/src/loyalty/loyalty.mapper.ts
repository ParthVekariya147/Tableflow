import type { LoyaltyAccount, LoyaltyTransaction } from "@amber/domain";
import type {
  LoyaltyAccount as PrismaLoyaltyAccount,
  LoyaltyTransaction as PrismaLoyaltyTransaction,
} from "@prisma/client";

export function toDomainLoyaltyAccount(row: PrismaLoyaltyAccount): LoyaltyAccount {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phone: row.phone,
    name: row.name ?? undefined,
    pointsBalance: row.pointsBalance,
    lifetimePoints: row.lifetimePoints,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDomainLoyaltyTransaction(
  row: PrismaLoyaltyTransaction,
): LoyaltyTransaction {
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    orderId: row.orderId,
    type: row.type,
    points: row.points,
    balanceAfter: row.balanceAfter,
    note: row.note ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}
