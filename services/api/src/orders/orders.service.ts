import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type {
  Order,
  OrderStatus,
  Payment,
  Sale,
  ItemStatus,
  AnalyticsSummary,
  AnalyticsBucket,
} from "@amber/domain";
import { orderItemUnitPrice } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { OrdersEvents } from "./orders.events.js";
import { toDomainOrder, toDomainPayment, toSale } from "./orders.mapper.js";
import type {
  AddRoundDto,
  CreateOrderDto,
  AddItemDto,
  UpdateItemDto,
  CapturePaymentDto,
} from "./orders.dto.js";

const ROUND_INCLUDE = {
  rounds: { include: { items: { include: { modifiers: true } } } },
} as const;
const LIVE_STATUSES: OrderStatus[] = ["open", "billed"];

type RoundItemModifier = NonNullable<
  AddRoundDto["items"][number]["modifiers"]
>[number];

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrdersEvents,
  ) {}

  /**
   * Re-load an order and broadcast it on the tenant's live stream, then return
   * it. Every mutation funnels through here so all three clients (admin,
   * customer, KDS) see the change in real time without polling.
   */
  private async refreshAndEmit(
    tenantId: string,
    orderId: string,
    type: "created" | "updated" | "closed",
  ): Promise<Order> {
    const order = await this.get(tenantId, orderId);
    this.events.emit(tenantId, { type, orderId, order });
    return order;
  }

  /**
   * Load an order, scoped to the tenant so cross-tenant access is impossible.
   * If `deviceId` is supplied (a guest device) and the order is device-bound,
   * it must match — so a guest can't read/resume another device's session.
   */
  async get(tenantId: string, id: string, deviceId?: string): Promise<Order> {
    const row = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: ROUND_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Order not found: ${id}`);
    this.assertDevice(row.deviceId, deviceId);
    return toDomainOrder(row);
  }

  /** Open a new dine-in session for one of the tenant's tables. */
  async createForTable(
    tenantId: string,
    dto: CreateOrderDto,
    deviceId?: string,
  ): Promise<Order> {
    const table = await this.prisma.table.findFirst({
      where: { id: dto.tableId, tenantId },
    });
    if (!table) throw new NotFoundException(`Table not found: ${dto.tableId}`);

    // Occupancy guard (trust boundary): a table may hold only ONE live session.
    // Refuse if one is already open/billed so a second guest (or a stale client)
    // can't spawn a duplicate session on the same table.
    const live = await this.prisma.order.findFirst({
      where: { tenantId, tableId: dto.tableId, status: { in: ["open", "billed"] } },
      select: { id: true },
    });
    if (live)
      throw new ConflictException(
        `Table ${table.label} already has an active session.`,
      );

    const row = await this.prisma.order.create({
      data: {
        tenantId,
        tableId: dto.tableId,
        status: "open",
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        deviceId,
      },
      include: ROUND_INCLUDE,
    });
    const order = toDomainOrder(row);
    this.events.emit(tenantId, { type: "created", orderId: order.id, order });
    return order;
  }

  /** Append a round (instant or bundled) to an open order. Modifiers are
   *  re-validated + re-priced server-side before they're persisted. */
  async addRound(
    tenantId: string,
    orderId: string,
    dto: AddRoundDto,
    deviceId?: string,
  ): Promise<Order> {
    await this.assertOrder(tenantId, orderId, deviceId);

    // Resolve each line's modifiers up front (async DB lookups).
    const lines = await Promise.all(
      dto.items.map(async (i) => ({
        // Honour a client-supplied id (shared id space with the KDS ticket); else
        // Prisma mints a cuid.
        ...(i.id ? { id: i.id } : {}),
        tenantId,
        menuItemId: i.menuItemId,
        name: i.name,
        unitPrice: i.unitPrice,
        qty: i.qty,
        notes: i.notes,
        modifiers: {
          create: await this.resolveItemModifiers(
            tenantId,
            i.menuItemId,
            i.modifiers ?? [],
          ),
        },
      })),
    );

    await this.prisma.round.create({
      data: {
        ...(dto.id ? { id: dto.id } : {}),
        tenantId,
        orderId,
        type: dto.type,
        items: { create: lines },
      },
    });
    return this.refreshAndEmit(tenantId, orderId, "updated");
  }

  /**
   * Validate a line's submitted modifiers against the menu item's groups and
   * return the rows to persist (price/name snapshotted from the DB, not the
   * client). Enforces option validity + availability, text-group existence, and
   * required / min / max counts. The trust boundary for modifier pricing.
   */
  private async resolveItemModifiers(
    tenantId: string,
    menuItemId: string,
    mods: RoundItemModifier[],
  ): Promise<
    {
      tenantId: string;
      optionId: string | null;
      groupName: string;
      name: string;
      priceDelta: number;
      textValue: string | null;
    }[]
  > {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId },
      include: { modifierGroups: { include: { options: true } } },
    });
    // Unknown/deleted item: nothing to validate against — reject if mods were sent.
    if (!item) {
      if (mods.length)
        throw new BadRequestException(`Menu item not found: ${menuItemId}`);
      return [];
    }

    const optionMap = new Map(
      item.modifierGroups.flatMap((g) =>
        g.options.map((o) => [o.id, { option: o, group: g }] as const),
      ),
    );
    const textGroupByName = new Map(
      item.modifierGroups
        .filter((g) => g.inputType === "text")
        .map((g) => [g.name, g] as const),
    );

    const rows: {
      tenantId: string;
      optionId: string | null;
      groupName: string;
      name: string;
      priceDelta: number;
      textValue: string | null;
    }[] = [];
    const countByGroup = new Map<string, number>();
    const textByGroup = new Map<string, boolean>();

    for (const m of mods) {
      if (m.optionId) {
        const hit = optionMap.get(m.optionId);
        if (!hit || !hit.option.available)
          throw new BadRequestException(`Invalid option: ${m.optionId}`);
        rows.push({
          tenantId,
          optionId: hit.option.id,
          groupName: hit.group.name,
          name: hit.option.name,
          priceDelta: hit.option.priceDelta, // recomputed from DB
          textValue: null,
        });
        countByGroup.set(
          hit.group.id,
          (countByGroup.get(hit.group.id) ?? 0) + 1,
        );
      } else {
        const grp = textGroupByName.get(m.groupName);
        if (!grp)
          throw new BadRequestException(`Unknown modifier: ${m.groupName}`);
        const text = (m.textValue ?? "").trim();
        if (!text) continue; // empty optional text → skip
        rows.push({
          tenantId,
          optionId: null,
          groupName: grp.name,
          name: "",
          priceDelta: 0,
          textValue: text,
        });
        textByGroup.set(grp.id, true);
      }
    }

    // Per-group count / required enforcement.
    for (const g of item.modifierGroups) {
      const n = countByGroup.get(g.id) ?? 0;
      if (g.inputType === "text") {
        if (g.required && !textByGroup.get(g.id))
          throw new BadRequestException(`${g.name} is required.`);
        continue;
      }
      if (g.inputType === "single" && n > 1)
        throw new BadRequestException(`${g.name}: pick only one.`);
      if (g.maxSelect != null && n > g.maxSelect)
        throw new BadRequestException(`${g.name}: too many selected.`);
      const min = g.required ? Math.max(g.minSelect, 1) : g.minSelect;
      if (n < min) throw new BadRequestException(`${g.name}: pick at least ${min}.`);
    }

    return rows;
  }

  /** Mark an order as bill-requested. */
  async requestBill(
    tenantId: string,
    orderId: string,
    deviceId?: string,
  ): Promise<Order> {
    await this.assertOrder(tenantId, orderId, deviceId);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: "billed", billRequestedAt: new Date() },
    });
    return this.refreshAndEmit(tenantId, orderId, "updated");
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
    return this.refreshAndEmit(tenantId, orderId, "updated");
  }

  /** Change a line's quantity (0 removes it) and/or advance its kitchen status. */
  async updateItem(
    tenantId: string,
    orderId: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException(`Order not found: ${orderId}`);
    // A cancelled/paid session is terminal. Refuse item edits — including the
    // KDS status write-through — so a stale kitchen board can't resurrect a dead
    // order (e.g. mark "preparing" after staff cancelled it, which would wrongly
    // reach the guest's phone). The relay ticket should already be gone too.
    if (order.status === "closed" || order.status === "paid")
      throw new ConflictException(
        "This session is closed; its items can no longer be changed.",
      );

    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, tenantId, round: { orderId } },
      select: { id: true },
    });
    if (!item) throw new NotFoundException(`Order item not found: ${itemId}`);

    if (dto.qty === 0) {
      await this.prisma.orderItem.delete({ where: { id: itemId } });
      return this.refreshAndEmit(tenantId, orderId, "updated");
    }

    const data: Record<string, unknown> = {};
    if (dto.qty !== undefined) data.qty = dto.qty;
    if (dto.status !== undefined) {
      data.status = dto.status;
      const stamp = STATUS_STAMP[dto.status];
      if (stamp) data[stamp] = new Date();
    }
    await this.prisma.orderItem.update({ where: { id: itemId }, data });
    return this.refreshAndEmit(tenantId, orderId, "updated");
  }

  /** Abandon a session without payment (walkout / mistake). Frees the table. */
  async cancel(tenantId: string, orderId: string): Promise<Order> {
    await this.assertOrder(tenantId, orderId);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: "closed", closedAt: new Date() },
    });
    return this.refreshAndEmit(tenantId, orderId, "closed");
  }

  /** Settle the bill: snapshot totals, record the payment, close the session. */
  async capturePayment(
    tenantId: string,
    orderId: string,
    taxRate: number,
    dto: CapturePaymentDto,
    deviceId?: string,
  ): Promise<Payment> {
    const order = await this.get(tenantId, orderId, deviceId);
    if (order.status === "paid")
      throw new BadRequestException("Order already paid");
    // A cancelled/abandoned session is `closed`. Refuse to capture against it so
    // a stale guest client can't resurrect a cancelled order into a paid sale.
    if (order.status === "closed")
      throw new ConflictException("This session was cancelled and can't be paid.");

    const subtotal = order.rounds.reduce(
      (sum, r) =>
        sum +
        r.items
          .filter((i) => i.status !== "cancelled")
          .reduce((s, i) => s + orderItemUnitPrice(i) * i.qty, 0),
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
    // Broadcast the now-closed order so the floor frees the table and the guest
    // phone leaves the bill screen in real time.
    const closed = await this.get(tenantId, orderId);
    this.events.emit(tenantId, { type: "closed", orderId, order: closed });
    return toDomainPayment(payment);
  }

  /**
   * Completed sales (most recent first). Without a range it returns the recent
   * 50 (dashboard feed). With a `from`/`to` window it returns every sale in that
   * window (capped at 1000) so the Order History page can show a full day/range.
   */
  async listSales(
    tenantId: string,
    range?: { from?: string; to?: string },
  ): Promise<Sale[]> {
    const ranged = Boolean(range?.from || range?.to);
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (range?.from) createdAt.gte = new Date(range.from);
    if (range?.to) createdAt.lte = new Date(range.to);

    const rows = await this.prisma.payment.findMany({
      where: { tenantId, ...(ranged ? { createdAt } : {}) },
      orderBy: { createdAt: "desc" },
      take: ranged ? 1000 : 50,
      include: { order: { include: { table: true } } },
    });
    return rows.map(toSale);
  }

  /**
   * Aggregated analytics for the dashboard + Analytics page, computed from
   * `Payment` (revenue/orders/trend/peak) and `OrderItem` (top items, category
   * split). Scoped to an ISO `{from,to}` window (defaults to the last 24h).
   * Deltas compare to the immediately preceding equal-length window.
   */
  async getAnalytics(
    tenantId: string,
    range?: { from?: string; to?: string },
  ): Promise<AnalyticsSummary> {
    const to = range?.to ? new Date(range.to) : new Date();
    const from = range?.from
      ? new Date(range.from)
      : new Date(to.getTime() - 86_400_000);
    const windowMs = Math.max(1, to.getTime() - from.getTime());
    const prevFrom = new Date(from.getTime() - windowMs);

    // Current window: payments with full item detail (top items / categories).
    const payments = await this.prisma.payment.findMany({
      where: { tenantId, createdAt: { gte: from, lte: to } },
      include: {
        order: {
          include: {
            rounds: {
              include: {
                items: {
                  include: { modifiers: true, menuItem: { include: { category: true } } },
                },
              },
            },
          },
        },
      },
    });

    // Previous equal-length window: only totals/count, for deltas (cheap).
    const prev = await this.prisma.payment.aggregate({
      where: { tenantId, createdAt: { gte: prevFrom, lt: from } },
      _sum: { total: true },
      _count: { _all: true },
    });

    const revenue = payments.reduce((s, p) => s + p.total, 0);
    const orders = payments.length;
    const avgTicket = orders ? Math.round(revenue / orders) : 0;

    const prevRevenue = prev._sum.total ?? 0;
    const prevOrders = prev._count._all ?? 0;
    const prevAvg = prevOrders ? Math.round(prevRevenue / prevOrders) : 0;
    const delta = (cur: number, prv: number): number | null =>
      prv > 0 ? (cur - prv) / prv : null;

    // Item-level aggregation across non-cancelled lines of paid orders.
    const itemAgg = new Map<string, { name: string; units: number; revenue: number }>();
    const catAgg = new Map<string, { name: string; units: number; revenue: number }>();
    let totalItems = 0;
    let itemRevenueTotal = 0;
    for (const p of payments) {
      for (const round of p.order.rounds) {
        for (const it of round.items) {
          if (it.status === "cancelled") continue;
          const unit =
            it.unitPrice + it.modifiers.reduce((s, m) => s + m.priceDelta, 0);
          const rev = unit * it.qty;
          totalItems += it.qty;
          itemRevenueTotal += rev;

          const item = itemAgg.get(it.name) ?? { name: it.name, units: 0, revenue: 0 };
          item.units += it.qty;
          item.revenue += rev;
          itemAgg.set(it.name, item);

          const cname = it.menuItem?.category?.name ?? "Other";
          const cat = catAgg.get(cname) ?? { name: cname, units: 0, revenue: 0 };
          cat.units += it.qty;
          cat.revenue += rev;
          catAgg.set(cname, cat);
        }
      }
    }

    const topItems = [...itemAgg.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
    const categories = [...catAgg.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((c) => ({
        ...c,
        pct: itemRevenueTotal ? Math.round((c.revenue / itemRevenueTotal) * 100) : 0,
      }));

    // Orders settled per hour-of-day (server-local; tenant TZ is deferred).
    const hourCounts = new Array(24).fill(0) as number[];
    for (const p of payments) {
      const h = p.createdAt.getHours();
      hourCounts[h] = (hourCounts[h] ?? 0) + 1;
    }
    const peakHours = hourCounts.map((o, hour) => ({ hour, orders: o }));

    return {
      revenue,
      orders,
      avgTicket,
      totalItems,
      revenueDelta: delta(revenue, prevRevenue),
      ordersDelta: delta(orders, prevOrders),
      avgTicketDelta: delta(avgTicket, prevAvg),
      revenueSeries: this.bucketRevenue(payments, from, windowMs),
      topItems,
      categories,
      peakHours,
    };
  }

  /** Revenue trend buckets: hourly for ≤2-day windows, else daily (capped at 48
   *  buckets so long ranges stay light). Labels are human-friendly. */
  private bucketRevenue(
    payments: { total: number; createdAt: Date }[],
    from: Date,
    windowMs: number,
  ): AnalyticsBucket[] {
    const DAY = 86_400_000;
    const hourly = windowMs <= 2 * DAY;
    let nBuckets = hourly
      ? Math.ceil(windowMs / 3_600_000)
      : Math.ceil(windowMs / DAY);
    nBuckets = Math.min(Math.max(nBuckets, 1), 48);
    const size = windowMs / nBuckets;
    const fmt = (d: Date): string =>
      hourly
        ? d.toLocaleTimeString("en-US", { hour: "numeric" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const totals = new Array(nBuckets).fill(0) as number[];
    for (const p of payments) {
      const idx = Math.floor((p.createdAt.getTime() - from.getTime()) / size);
      if (idx >= 0 && idx < nBuckets) totals[idx] = (totals[idx] ?? 0) + p.total;
    }
    return totals.map((value, i) => ({
      label: fmt(new Date(from.getTime() + i * size)),
      value,
    }));
  }

  private async assertOrder(
    tenantId: string,
    orderId: string,
    deviceId?: string,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, deviceId: true },
    });
    if (!order) throw new NotFoundException(`Order not found: ${orderId}`);
    this.assertDevice(order.deviceId, deviceId);
  }

  /**
   * Session-ownership guard. Only enforced when BOTH the order is device-bound
   * and the caller presents a device id (a guest): a mismatch means a different
   * device is trying to act on this session → 403. Staff (restaurant-admin) send
   * no device id, so their calls are unaffected (auth proper is still deferred).
   */
  private assertDevice(orderDeviceId: string | null, deviceId?: string): void {
    if (orderDeviceId && deviceId && orderDeviceId !== deviceId) {
      throw new ForbiddenException("This session belongs to another device.");
    }
  }
}
