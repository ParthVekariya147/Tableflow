import type { ServiceRequest } from "@amber/domain";
import type { ServiceRequest as PrismaServiceRequest, Table as PrismaTable } from "@prisma/client";

type ServiceRequestWithTable = PrismaServiceRequest & { table: Pick<PrismaTable, "label"> };

/** Map a Prisma ServiceRequest row (+ its table's label) to the domain shape. */
export function toDomainServiceRequest(row: ServiceRequestWithTable): ServiceRequest {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tableId: row.tableId,
    tableLabel: row.table.label,
    orderId: row.orderId,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
  };
}
