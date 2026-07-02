import { Injectable, NotFoundException } from "@nestjs/common";
import type { ServiceRequest, ServiceRequestStatus } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { ServiceRequestsEvents } from "./service-requests.events.js";
import { toDomainServiceRequest } from "./service-requests.mapper.js";
import type {
  CreateServiceRequestDto,
  UpdateServiceRequestStatusDto,
} from "./service-requests.dto.js";

const INCLUDE = { table: { select: { label: true } } } as const;
const OPEN_STATUSES: ServiceRequestStatus[] = ["pending", "acknowledged"];

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ServiceRequestsEvents,
  ) {}

  /**
   * Create a request, scoped to the tenant's table. Dedupes: a table can only
   * have one PENDING request of a given type at a time — a guest mashing the
   * button re-returns the existing row instead of piling up duplicates. This
   * is the authoritative guard (the customer's 4s "sent" cooldown is only a
   * UX debounce on top of it).
   */
  async create(
    tenantId: string,
    dto: CreateServiceRequestDto,
  ): Promise<ServiceRequest> {
    const table = await this.prisma.table.findFirst({
      where: { id: dto.tableId, tenantId },
      select: { id: true },
    });
    if (!table) throw new NotFoundException(`Table not found: ${dto.tableId}`);

    const existing = await this.prisma.serviceRequest.findFirst({
      where: { tenantId, tableId: dto.tableId, type: dto.type, status: "pending" },
      include: INCLUDE,
    });
    if (existing) return toDomainServiceRequest(existing);

    // Best-effort link to the table's live session — not required, and never
    // blocks the request if there isn't one (e.g. staff hasn't opened it yet).
    const liveOrder = await this.prisma.order.findFirst({
      where: { tenantId, tableId: dto.tableId, status: { in: ["open", "billed"] } },
      select: { id: true },
    });

    const row = await this.prisma.serviceRequest.create({
      data: {
        tenantId,
        tableId: dto.tableId,
        orderId: liveOrder?.id,
        type: dto.type,
      },
      include: INCLUDE,
    });
    const request = toDomainServiceRequest(row);
    this.events.emit(tenantId, { type: "created", request });
    return request;
  }

  /** Staff-only: open requests (defaults to pending + acknowledged). */
  async list(
    tenantId: string,
    status?: ServiceRequestStatus,
  ): Promise<ServiceRequest[]> {
    const rows = await this.prisma.serviceRequest.findMany({
      where: { tenantId, status: status ? status : { in: OPEN_STATUSES } },
      orderBy: { createdAt: "desc" },
      include: INCLUDE,
    });
    return rows.map(toDomainServiceRequest);
  }

  /** Staff-only: acknowledge/resolve, stamping the matching timestamp. */
  async updateStatus(
    tenantId: string,
    id: string,
    dto: UpdateServiceRequestStatusDto,
  ): Promise<ServiceRequest> {
    const existing = await this.prisma.serviceRequest.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Service request not found: ${id}`);

    const row = await this.prisma.serviceRequest.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === "acknowledged" ? { acknowledgedAt: new Date() } : {}),
        ...(dto.status === "resolved" ? { resolvedAt: new Date() } : {}),
      },
      include: INCLUDE,
    });
    const request = toDomainServiceRequest(row);
    this.events.emit(tenantId, { type: "updated", request });
    return request;
  }
}
