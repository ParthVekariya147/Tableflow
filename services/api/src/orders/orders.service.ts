import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { Order, OrderStatus, Payment, Sale, ItemStatus } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainOrder, toDomainPayment, toSale } from "./orders.mapper.js";
import type {
  AddRoundDto,
  CreateOrderDto,
  AddItemDto,
  UpdateItemDto,
  CapturePaymentDto,
} from "./orders.dto.js";

const ROUND_INCLUDE = { rounds: { include: { items: true } } } as const;
const LIVE_STATUSES: OrderStatus[] = ["open", "billed"];

/** Maps a kitchen status to the timestamp column that records reaching it. */
const STATUS_STAMP: Record<ItemStatus, string | null> = {
  placed: null,
  preparing: "preparingAt",
  ready: "readyAt",
  served: "servedAt",
  cancelled: "cancelledAt",
};

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

  /** List sessions for the floor / KDS. Defaults to live (open + billed). */
  async list(tenantId: string, status?: OrderStatus): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: { tenantId, status: status ? status : { in: LIVE_STATUSES } },
      orderBy: { createdAt: "desc" },
      include: ROUND_INCLUDE,
    });
    return rows.map(toDomainOrder);
  }

  /**
   * Append one item to a session: bump the matching `placed` line in the latest
   * still-open round, else add a new line / open a fresh instant round. Mirrors
   * the customer "bring it" flow so staff can add on a guest's behalf.
   */
  async addItem(
    tenantId: string,
    orderId: string,
    dto: AddItemDto,
  ): Promise<Order> {
    await this.assertOrder(tenantId, orderId);
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: dto.menuItemId, tenantId },
    });
    if (!menuItem)
      throw new BadRequestException(`Menu item not found: ${dto.menuItemId}`);

    const rounds = await this.prisma.round.findMany({
      where: { tenantId, orderId },
      orderBy: { createdAt: "asc" },
      include: { items: true },
    });
    const latest = rounds[rounds.length - 1];
    const isOpen =
      latest &&
      latest.items.some(
        (i) => i.status === "placed" || i.status === "preparing",
      );

    const existing = isOpen
      ? latest.items.find(
          (i) => i.menuItemId === menuItem.id && i.status === "placed",
        )
      : undefined;

    if (existing) {
      await this.prisma.orderItem.update({
        where: { id: existing.id },
        data: { qty: existing.qty + dto.qty },
      });
    } else if (isOpen) {
      await this.prisma.orderItem.create({
        data: {
          tenantId,
          roundId: latest.id,
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPrice: menuItem.price,
          qty: dto.qty,
        },
      });
    } else {
      await this.prisma.round.create({
        data: {
          tenantId,
          orderId,
          type: "instant",
          items: {
            create: {
              tenantId,
              menuItemId: menuItem.id,
              name: menuItem.name,
              unitPrice: menuItem.price,
              qty: dto.qty,
            },
          },
        },
      });
    }
    return this.get(tenantId, orderId);
  }

  /** Change a line's quantity (0 removes it) and/or advance its kitchen status. */
  async updateItem(
    tenantId: string,
    orderId: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<Order> {
    await this.assertOrder(tenantId, orderId);
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, tenantId, round: { orderId } },
      select: { id: true },
    });
    if (!item) throw new NotFoundException(`Order item not found: ${itemId}`);

    if (dto.qty === 0) {
      await this.prisma.orderItem.delete({ where: { id: itemId } });
      return this.get(tenantId, orderId);
    }

    const data: Record<string, unknown> = {};
    if (dto.qty !== undefined) data.qty = dto.qty;
    if (dto.status !== undefined) {
      data.status = dto.status;
      const stamp = STATUS_STAMP[dto.status];
      if (stamp) data[stamp] = new Date();
    }
    await this.prisma.orderItem.update({ where: { id: itemId }, data });
    return this.get(tenantId, orderId);
  }

  /** Abandon a session without payment (walkout / mistake). Frees the table. */
  async cancel(tenantId: string, orderId: string): Promise<Order> {
    await this.assertOrder(tenantId, orderId);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: "closed", closedAt: new Date() },
    });
    return this.get(tenantId, orderId);
  }

  /** Settle the bill: snapshot totals, record the payment, close the session. */
  async capturePayment(
    tenantId: string,
    orderId: string,
    taxRate: number,
    dto: CapturePaymentDto,
  ): Promise<Payment> {
    const order = await this.get(tenantId, orderId);
    if (order.status === "paid")
      throw new BadRequestException("Order already paid");

    const subtotal = order.rounds.reduce(
      (sum, r) =>
        sum +
        r.items
          .filter((i) => i.status !== "cancelled")
          .reduce((s, i) => s + i.unitPrice * i.qty, 0),
      0,
    );
    const tax = Math.round(subtotal * taxRate);
    const tip = dto.tip;
    const total = subtotal + tax + tip;

    const [payment] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          tenantId,
          orderId,
          method: dto.method,
          subtotal,
          tax,
          tip,
          total,
          tendered: dto.tendered,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: "paid", closedAt: new Date() },
      }),
    ]);
    return toDomainPayment(payment);
  }

  /** Recent completed sales for dashboards (most recent first). */
  async listSales(tenantId: string, limit = 50): Promise<Sale[]> {
    const rows = await this.prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { order: { include: { table: true } } },
    });
    return rows.map(toSale);
  }

  private async assertOrder(tenantId: string, orderId: string): Promise<void> {
    const exists = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Order not found: ${orderId}`);
  }
}
