import type { Order } from "@amber/domain";
import type {
  Order as PrismaOrder,
  Round as PrismaRound,
  OrderItem as PrismaOrderItem,
} from "@prisma/client";

type OrderWithRounds = PrismaOrder & {
  rounds: (PrismaRound & { items: PrismaOrderItem[] })[];
};

/** Map a Prisma order graph to the shared domain Order (dates -> ISO). */
export function toDomainOrder(row: OrderWithRounds): Order {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tableId: row.tableId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString(),
    rounds: row.rounds.map((r) => ({
      id: r.id,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((i) => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.name,
        unitPrice: i.unitPrice,
        qty: i.qty,
        status: i.status,
        notes: i.notes ?? undefined,
      })),
    })),
  };
}
