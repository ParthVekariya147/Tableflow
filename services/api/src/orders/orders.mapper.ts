import type { Order, Payment, Sale } from "@amber/domain";
import type {
  Order as PrismaOrder,
  Round as PrismaRound,
  OrderItem as PrismaOrderItem,
  Payment as PrismaPayment,
  Table as PrismaTable,
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
    customerName: row.customerName ?? undefined,
    customerPhone: row.customerPhone ?? undefined,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString(),
    billRequestedAt: row.billRequestedAt?.toISOString(),
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

/** Prisma payment row -> domain Payment. */
export function toDomainPayment(row: PrismaPayment): Payment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderId: row.orderId,
    method: row.method,
    subtotal: row.subtotal,
    tax: row.tax,
    tip: row.tip,
    total: row.total,
    tendered: row.tendered ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Payment (+ its order's table) -> denormalized Sale for dashboards. */
export function toSale(
  row: PrismaPayment & { order: { table: PrismaTable } },
): Sale {
  return {
    id: row.id,
    orderId: row.orderId,
    tableLabel: row.order.table.label,
    method: row.method,
    total: row.total,
    createdAt: row.createdAt.toISOString(),
  };
}
