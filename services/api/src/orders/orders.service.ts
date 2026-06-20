import { Injectable, NotFoundException } from "@nestjs/common";
import type { Order } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainOrder } from "./orders.mapper.js";
import type { AddRoundDto, CreateOrderDto } from "./orders.dto.js";

const ROUND_INCLUDE = { rounds: { include: { items: true } } } as const;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Load an order, scoped to the tenant so cross-tenant access is impossible. */
  async get(tenantId: string, id: string): Promise<Order> {
    const row = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: ROUND_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Order not found: ${id}`);
    return toDomainOrder(row);
  }

  /** Open a new dine-in session for one of the tenant's tables. */
  async createForTable(tenantId: string, dto: CreateOrderDto): Promise<Order> {
    const table = await this.prisma.table.findFirst({
      where: { id: dto.tableId, tenantId },
    });
    if (!table) throw new NotFoundException(`Table not found: ${dto.tableId}`);

    const row = await this.prisma.order.create({
      data: {
        tenantId,
        tableId: dto.tableId,
        status: "open",
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
      },
      include: ROUND_INCLUDE,
    });
    return toDomainOrder(row);
  }

  /** Append a round (instant or bundled) to an open order. */
  async addRound(
    tenantId: string,
    orderId: string,
    dto: AddRoundDto,
  ): Promise<Order> {
    await this.assertOrder(tenantId, orderId);
    await this.prisma.round.create({
      data: {
        tenantId,
        orderId,
        type: dto.type,
        items: {
          create: dto.items.map((i) => ({
            tenantId,
            menuItemId: i.menuItemId,
            name: i.name,
            unitPrice: i.unitPrice,
            qty: i.qty,
            notes: i.notes,
          })),
        },
      },
    });
    return this.get(tenantId, orderId);
  }

  /** Mark an order as bill-requested. */
  async requestBill(tenantId: string, orderId: string): Promise<Order> {
    await this.assertOrder(tenantId, orderId);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: "billed", billRequestedAt: new Date() },
    });
    return this.get(tenantId, orderId);
  }

  private async assertOrder(tenantId: string, orderId: string): Promise<void> {
    const exists = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Order not found: ${orderId}`);
  }
}
