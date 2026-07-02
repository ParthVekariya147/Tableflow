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
import { Prisma, type Payment as PrismaPayment } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { TtlCache } from "../common/ttl-cache.js";
import { OrdersEvents } from "./orders.events.js";
import { toDomainOrder, toDomainPayment, toSale } from "./orders.mapper.js";
import type {
  AddRoundDto,
  CreateOrderDto,
  AddItemDto,
  UpdateItemDto,
  CapturePaymentDto,
  ReclaimSessionDto,
} from "./orders.dto.js";

const ROUND_INCLUDE = {
  rounds: { include: { items: { include: { modifiers: true } } } },
} as const;
const LIVE_STATUSES: OrderStatus[] = ["open", "billed"];

type RoundItemModifier = NonNullable<
  AddRoundDto["items"][number]["modifiers"]
>[number];

type MenuItemWithModifiers = Prisma.MenuItemGetPayload<{
  include: { modifierGroups: { include: { options: true } } };
}>;

/** Maps a kitchen status to the timestamp column that records reaching it. */
const STATUS_STAMP: Record<ItemStatus, string | null> = {
  placed: null,
  preparing: "preparingAt",
  ready: "readyAt",
  served: "servedAt",
  cancelled: "cancelledAt",
};

// reclaimSession's only proof of ownership is a plain string-equality check
// on a phone number — without a limiter, anyone who knows a table is occupied
// could brute-force the last-10-digits match. Locked out per (tenant, table)
// rather than per-IP: a restaurant's guest wifi commonly NATs many phones
// behind one IP, so an IP-keyed limit would false-lock legitimate guests.
const RECLAIM_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const RECLAIM_MAX_ATTEMPTS = 5;

@Injectable()
export class OrdersService {
  private readonly reclaimAttempts = new TtlCache<number>(RECLAIM_LOCKOUT_WINDOW_MS);

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
    // Trusted internal reload — not a guest request, so bypass the device gate.
    const order = await this.get(tenantId, orderId, undefined, true);
    this.events.emit(tenantId, { type, orderId, order });
    return order;
  }

  /**
   * Load an order, scoped to the tenant so cross-tenant access is impossible.
   * If `deviceId` is supplied (a guest device) and the order is device-bound,
   * it must match — so a guest can't read/resume another device's session.
   */
  async get(
    tenantId: string,
    id: string,
    deviceId?: string,
    trusted = false,
  ): Promise<Order> {
    const row = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: ROUND_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Order not found: ${id}`);
    this.assertDevice(row.deviceId, deviceId, trusted);
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

    // Fetch every distinct menu item referenced by this round in one query
    // (was one round trip per line item).
    const menuItemIds = [...new Set(dto.items.map((i) => i.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, tenantId },
      include: { modifierGroups: { include: { options: true } } },
    });
    const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

    const lines = dto.items.map((i) => ({
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
        create: this.resolveItemModifiers(
          tenantId,
          menuItemById.get(i.menuItemId) ?? null,
          i.modifiers ?? [],
        ),
      },
    }));

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
   * Takes the already-fetched menu item (caller batches the lookup across all
   * lines in a round instead of one query per line).
   */
  private resolveItemModifiers(
    tenantId: string,
    item: MenuItemWithModifiers | null,
    mods: RoundItemModifier[],
  ): {
    tenantId: string;
    optionId: string | null;
    groupName: string;
    name: string;
    priceDelta: number;
    textValue: string | null;
  }[] {
    // Unknown/deleted item: nothing to validate against — reject if mods were sent.
    if (!item) {
      if (mods.length)
        throw new BadRequestException(`Menu item not found`);
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

  /**
   * Table ids currently holding a live (open/billed) order — for occupancy
   * checks (QR boot, reservation race guard) that don't need the full
   * ROUND_INCLUDE graph `list()` returns.
   */
  async listOpenTableIds(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.order.findMany({
      where: { tenantId, status: { in: LIVE_STATUSES } },
      select: { tableId: true },
    });
    return rows.map((r) => r.tableId);
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
   * A single guest device's own live sessions (open/billed). Backs the
   * device-scoped SSE stream so a guest sees ONLY their own order — never the
   * whole floor or another guest's contact details. `deviceId` is the opaque
   * per-device capability (never serialized back to clients), so only the owning
   * device can request its own stream.
   */
  async listByDevice(tenantId: string, deviceId: string): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: { tenantId, deviceId, status: { in: LIVE_STATUSES } },
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
    // Staff route (JwtAuthGuard) — the caller is authenticated, not a guest.
    await this.assertOrder(tenantId, orderId, undefined, true);
    // Independent lookups — run in parallel instead of sequentially.
    const [menuItem, rounds] = await Promise.all([
      this.prisma.menuItem.findFirst({ where: { id: dto.menuItemId, tenantId } }),
      this.prisma.round.findMany({
        where: { tenantId, orderId },
        orderBy: { createdAt: "asc" },
        include: { items: true },
      }),
    ]);
    if (!menuItem)
      throw new BadRequestException(`Menu item not found: ${dto.menuItemId}`);
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
      // Atomic increment (not `existing.qty + dto.qty` computed from the
      // separately-fetched row above) — two concurrent adds of the same item
      // would otherwise both read the same starting qty and one increment
      // would silently overwrite the other.
      await this.prisma.orderItem.update({
        where: { id: existing.id },
        data: { qty: { increment: dto.qty } },
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

    if (dto.qtyDelta !== undefined) {
      // Atomic increment at the DB layer (`qty = qty + delta`) — Postgres
      // serializes concurrent updates to the same row via its row lock, so two
      // rapid deltas (double-tap, or two staff devices) both land instead of
      // the second clobbering the first the way a client-computed absolute
      // write would.
      const updated = await this.prisma.orderItem.update({
        where: { id: itemId },
        data: { qty: { increment: dto.qtyDelta } },
      });
      if (updated.qty <= 0) {
        await this.prisma.orderItem.delete({ where: { id: itemId } }).catch(() => {});
      }
      if (dto.status !== undefined) {
        const stamp = STATUS_STAMP[dto.status];
        await this.prisma.orderItem
          .update({
            where: { id: itemId },
            data: { status: dto.status, ...(stamp ? { [stamp]: new Date() } : {}) },
          })
          .catch(() => {}); // item may have just been deleted by the qty<=0 branch above
      }
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
    // Staff route (JwtAuthGuard) — the caller is authenticated, not a guest.
    await this.assertOrder(tenantId, orderId, undefined, true);
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
    trusted = false,
  ): Promise<Payment> {
    const order = await this.get(tenantId, orderId, deviceId, trusted);
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

    let payment: PrismaPayment;
    try {
      [payment] = await this.prisma.$transaction([
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
    } catch (err) {
      // Payment.orderId is @unique — two near-simultaneous captures for the
      // same order (double-tap "Pay", or a guest retry racing a staff cash
      // capture) both pass the status guards above; the DB constraint is the
      // real tiebreaker. Without this, the loser gets a bare 500 instead of a
      // clean, expected 409.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("This order has already been paid.");
      }
      throw err;
    }
    // Broadcast the now-closed order so the floor frees the table and the guest
    // phone leaves the bill screen in real time.
    const closed = await this.get(tenantId, orderId, undefined, true);
    this.events.emit(tenantId, { type: "closed", orderId, order: closed });
    return toDomainPayment(payment);
  }

  /**
   * The payment captured for an order, if any — lets a client rebuild a full
   * receipt (method/tax/tip/tendered breakdown) after a refresh, when it only
   * has the order id (not the in-memory Payment returned at capture time).
   */
  async getPayment(tenantId: string, orderId: string): Promise<Payment | null> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, tenantId },
    });
    return payment ? toDomainPayment(payment) : null;
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

    // Three independent, narrow queries run in parallel instead of one deep
    // 6-level join loaded fully into Node then aggregated with nested loops:
    //  - current-window payments: only the two fields the trend/peak-hours
    //    buckets need (not the whole order→round→item→modifier graph).
    //  - previous-window totals: a DB-side aggregate (was already parallel-
    //    izable, previously ran sequentially after the deep query).
    //  - item-level rows for top-items/category-split, filtered to non-
    //    cancelled lines server-side and selected narrowly (no order/round
    //    fields at all).
    const [paymentRows, prev, itemRows] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, createdAt: { gte: from, lte: to } },
        select: { total: true, createdAt: true },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, createdAt: { gte: prevFrom, lt: from } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.orderItem.findMany({
        where: {
          tenantId,
          status: { not: "cancelled" },
          round: { order: { payment: { createdAt: { gte: from, lte: to } } } },
        },
        select: {
          name: true,
          unitPrice: true,
          qty: true,
          modifiers: { select: { priceDelta: true } },
          menuItem: { select: { category: { select: { name: true } } } },
        },
      }),
    ]);

    const revenue = paymentRows.reduce((s, p) => s + p.total, 0);
    const orders = paymentRows.length;
    const avgTicket = orders ? Math.round(revenue / orders) : 0;

    const prevRevenue = prev._sum.total ?? 0;
    const prevOrders = prev._count._all ?? 0;
    const prevAvg = prevOrders ? Math.round(prevRevenue / prevOrders) : 0;
    const delta = (cur: number, prv: number): number | null =>
      prv > 0 ? (cur - prv) / prv : null;

    // Item-level aggregation (already non-cancelled, filtered in the query).
    const itemAgg = new Map<string, { name: string; units: number; revenue: number }>();
    const catAgg = new Map<string, { name: string; units: number; revenue: number }>();
    let totalItems = 0;
    let itemRevenueTotal = 0;
    for (const it of itemRows) {
      const unit = it.unitPrice + it.modifiers.reduce((s, m) => s + m.priceDelta, 0);
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
    for (const p of paymentRows) {
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
      revenueSeries: this.bucketRevenue(paymentRows, from, windowMs),
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

  /**
   * Re-bind an existing open session to a new device by verifying the guest's
   * phone number. Used when a customer re-scans the QR after clearing their
   * browser state or switching devices. Phone is normalised to the last 10
   * digits on both sides so `+91 9876543210` matches `9876543210`.
   */
  async reclaimSession(
    tenantId: string,
    dto: ReclaimSessionDto,
    deviceId?: string,
  ): Promise<Order> {
    const attemptKey = `${tenantId}:${dto.tableId}`;
    if ((this.reclaimAttempts.get(attemptKey) ?? 0) >= RECLAIM_MAX_ATTEMPTS) {
      throw new ForbiddenException(
        "Too many attempts. Please ask a staff member for help.",
      );
    }

    const live = await this.prisma.order.findFirst({
      where: {
        tenantId,
        tableId: dto.tableId,
        status: { in: ["open", "billed"] },
      },
      select: { id: true, customerPhone: true },
    });
    if (!live)
      throw new NotFoundException("No active session on this table.");
    if (!live.customerPhone)
      throw new ForbiddenException(
        "This session cannot be reclaimed — no phone on record.",
      );
    const normalize = (p: string) => p.replace(/\D/g, "").slice(-10);
    if (normalize(live.customerPhone) !== normalize(dto.customerPhone)) {
      const attempts = (this.reclaimAttempts.get(attemptKey) ?? 0) + 1;
      this.reclaimAttempts.set(attemptKey, attempts);
      throw new ForbiddenException("Phone number does not match.");
    }
    this.reclaimAttempts.delete(attemptKey);

    await this.prisma.order.update({
      where: { id: live.id },
      data: { deviceId: deviceId ?? null },
    });
    return this.refreshAndEmit(tenantId, live.id, "updated");
  }

  private async assertOrder(
    tenantId: string,
    orderId: string,
    deviceId?: string,
    trusted = false,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, deviceId: true },
    });
    if (!order) throw new NotFoundException(`Order not found: ${orderId}`);
    this.assertDevice(order.deviceId, deviceId, trusted);
  }

  /**
   * Session-ownership guard for a guest device-bound order. A device-bound order
   * may only be read/acted on by the device that opened it — the presented
   * device id must be present AND match. A *missing* device id is a failed match,
   * not a pass: otherwise an attacker could bypass the binding by simply omitting
   * the `X-Device-Id` header (and enumerate/tamper with other guests' sessions).
   *
   * `trusted` skips the check for callers that are already authorised by other
   * means: authenticated tenant staff (resolved from the bearer token on the
   * shared public routes) and internal server-side reloads (e.g. refreshAndEmit,
   * the post-payment re-fetch) which pass no device id but aren't guests.
   */
  private assertDevice(
    orderDeviceId: string | null,
    deviceId?: string,
    trusted = false,
  ): void {
    if (trusted) return;
    if (!orderDeviceId) return; // order isn't device-bound (e.g. staff walk-in)
    if (deviceId && deviceId === orderDeviceId) return; // the owning device
    throw new ForbiddenException("This session belongs to another device.");
  }
}
