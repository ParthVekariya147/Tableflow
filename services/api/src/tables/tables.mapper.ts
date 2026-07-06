import type { Table, FloorTable, TableStatus, Order } from "@amber/domain";
import type {
  Table as PrismaTable,
  Room as PrismaRoom,
} from "@prisma/client";

type TableWithRoom = PrismaTable & { room: PrismaRoom | null };

/** Prisma table row -> domain Table. */
export function toDomainTable(row: TableWithRoom): Table {
  return {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    qrToken: row.qrToken,
    seats: row.seats ?? undefined,
    room: row.room?.name ?? undefined,
    sortOrder: row.sortOrder,
    isCounter: row.isCounter,
  };
}

/** Derive the floor status from the table's active order (if any). */
export function deriveStatus(activeOrder: Order | null): TableStatus {
  if (!activeOrder) return "free";
  if (activeOrder.status === "billed" || activeOrder.billRequestedAt)
    return "bill";
  const hasItems = activeOrder.rounds.some((r) =>
    r.items.some((i) => i.status !== "cancelled"),
  );
  return hasItems ? "ordering" : "seated";
}

/** Table + live session = what the floor view renders. */
export function toFloorTable(
  row: TableWithRoom,
  activeOrder: Order | null,
): FloorTable {
  return {
    ...toDomainTable(row),
    status: deriveStatus(activeOrder),
    activeOrder,
  };
}
