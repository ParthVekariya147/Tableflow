import { randomUUID } from "node:crypto";
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
  LoyaltyProgram,
} from "@amber/domain";
import {
  orderSubtotal,
  pointsForSpend,
  redemptionValueMinor,
  maxRedeemablePoints,
  isLoyaltyEnabled,
} from "@amber/domain";
import { Prisma, type Payment as PrismaPayment } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { TtlCache } from "../common/ttl-cache.js";
import { OrdersEvents } from "./orders.events.js";
import { toDomainOrder, toDomainPayment, toSale } from "./orders.mapper.js";
import { buildSalesWorkbook } from "./orders.export.js";
import type {
  AddRoundDto,
  CreateOrderDto,
  AddItemDto,
  UpdateItemDto,
  CapturePaymentDto,
  QuickSaleDto,
  ReclaimSessionDto,
  RedeemLoyaltyPointsDto,
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
    // relationLoadStrategy "join" (pass 5, preview — see schema generator
    // note): ROUND_INCLUDE otherwise decomposes into 4 sequential queries
    // (order → rounds → items → modifiers), and this load runs after every
    // mutation via refreshAndEmit — one LATERAL-join query cuts each mutation
    // by 3 round trips.
    const row = await this.prisma.order.findFirst({
      relationLoadStrategy: "join",
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
    loyaltyProgram?: LoyaltyProgram,
  ): Promise<Order> {
    // The table lookup and the occupancy check are independent reads (Table
    // vs. Order, neither's query depends on the other's result — the
    // occupancy filter only needs dto.tableId, which the caller already
    // has), so run them concurrently instead of paying two sequential round
    // trips — perf pass 7. The loyalty upsert stays sequential AFTER both are
    // validated: it's a write, and parallelizing it with the occupancy check
    // would let a loyalty account get created for a phone number even on a
    // request that ultimately 409s (table already occupied) — a data-level
    // side effect the current code never has, so it's kept gated exactly as
    // before rather than folded into the parallel batch.
    const [table, live] = await Promise.all([
      this.prisma.table.findFirst({ where: { id: dto.tableId, tenantId } }),
      this.prisma.order.findFirst({
        where: { tenantId, tableId: dto.tableId, status: { in: ["open", "billed"] } },
        select: { id: true },
      }),
    ]);
    if (!table) throw new NotFoundException(`Table not found: ${dto.tableId}`);

    // Occupancy guard (trust boundary): a table may hold only ONE live session.
    // Refuse if one is already open/billed so a second guest (or a stale client)
    // can't spawn a duplicate session on the same table.
    if (live)
      throw new ConflictException(
        `Table ${table.label} already has an active session.`,
      );

    // Silent loyalty bookkeeping — no guest-facing effect. If the program is
    // enabled and a phone was captured, find-or-create the tenant+phone
    // account so points accrue across visits. Never blocks session creation.
    let loyaltyAccountId: string | undefined;
    if (isLoyaltyEnabled(loyaltyProgram) && dto.customerPhone) {
      const account = await this.prisma.loyaltyAccount.upsert({
        where: { tenantId_phone: { tenantId, phone: dto.customerPhone } },
        update: dto.customerName ? { name: dto.customerName } : {},
        create: { tenantId, phone: dto.customerPhone, name: dto.customerName },
      });
      loyaltyAccountId = account.id;
    }

    // No `include` — a freshly created order can never have any rounds yet,
    // so the ROUND_INCLUDE reload was always fetching a graph guaranteed to
    // be empty. Skipping it drops the implicit BEGIN/SELECT/COMMIT Prisma
    // wraps around a written-with-include create, leaving a single INSERT.
    const row = await this.prisma.order.create({
      data: {
        tenantId,
        tableId: dto.tableId,
        status: "open",
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        deviceId,
        loyaltyAccountId,
      },
    });
    const order = toDomainOrder({ ...row, rounds: [] });
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
    trusted = false,
  ): Promise<Order> {
    // The device guard and the menu-item lookup are independent reads (no
    // shared data), so run them on separate pooled connections concurrently
    // instead of paying two sequential round trips (mirrors addItem's
    // Promise.all pattern) — pass 6 of the latency work.
    const menuItemIds = [...new Set(dto.items.map((i) => i.menuItemId))];
    const [, menuItems] = await Promise.all([
      this.assertOrder(tenantId, orderId, deviceId, trusted),
      this.prisma.menuItem.findMany({
        where: { id: { in: menuItemIds }, tenantId },
        include: { modifierGroups: { include: { options: true } } },
      }),
    ]);
    const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

    // Nested `create` writes one INSERT per item + per modifier (Prisma can't
    // batch a record that itself has further nested relations). IDs are
    // client-generated anyway (cuid/randomUUID, never a DB default), so mint
    // them here and use `createMany` instead: 2 INSERTs total for the whole
    // round no matter how many items/modifiers it carries, instead of one per
    // row (pass 6 — was ~13 round trips for a multi-item, modifier-heavy round).
    const roundId = dto.id ?? randomUUID();
    const itemRows: Prisma.OrderItemCreateManyInput[] = [];
    const modifierRows: Prisma.OrderItemModifierCreateManyInput[] = [];
    for (const i of dto.items) {
      // Honour a client-supplied id (shared id space with the KDS ticket); else mint one.
      const itemId = i.id ?? randomUUID();
      itemRows.push({
        id: itemId,
        tenantId,
        roundId,
        menuItemId: i.menuItemId,
        name: i.name,
        unitPrice: i.unitPrice,
        qty: i.qty,
        notes: i.notes,
      });
      for (const m of this.resolveItemModifiers(
        tenantId,
        menuItemById.get(i.menuItemId) ?? null,
        i.modifiers ?? [],
      )) {
        modifierRows.push({ ...m, id: randomUUID(), orderItemId: itemId });
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.round.create({ data: { id: roundId, tenantId, orderId, type: dto.type } });
      if (itemRows.length) await tx.orderItem.createMany({ data: itemRows });
      if (modifierRows.length)
        await tx.orderItemModifier.createMany({ data: modifierRows });

      // Final reload INSIDE the transaction doubles as the emitted payload —
      // kills the refreshAndEmit double-load (perf doc P3 #13).
      const row = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: ROUND_INCLUDE,
      });
      if (!row) throw new NotFoundException(`Order not found: ${orderId}`);
      return toDomainOrder(row);
    });

    // Emit strictly AFTER commit — a rollback must never broadcast an order
    // state that doesn't exist.
    this.events.emit(tenantId, { type: "updated", orderId, order });
    return order;
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
   * Staff-only: apply (or, with `points: 0`, clear) a points redemption on an
   * open/billed order — a draft that's finalized at capturePayment. Re-quotes
   * against the LIVE bill + balance every call (replace-on-change), so the
   * amount staff see is always current even if the order changed since they
   * last opened Billing.
   */
  async redeemPoints(
    tenantId: string,
    orderId: string,
    dto: RedeemLoyaltyPointsDto,
    program: LoyaltyProgram,
  ): Promise<Order> {
    const order = await this.get(tenantId, orderId, undefined, true);
    if (order.status === "closed" || order.status === "paid")
      throw new ConflictException(
        "This session is closed; points can no longer be applied.",
      );
    if (!order.loyaltyAccountId)
      throw new BadRequestException("This order has no linked loyalty account.");

    // The module switch is a server-side guard on the money path, not just a
    // UI preference: a stale Billing tab open from before an admin switched
    // loyalty off must not be able to discount a live bill. Clearing an
    // already-applied redemption (points === 0) stays allowed either way —
    // it only ever puts money BACK on the bill, and blocking it would strand
    // a discount that can no longer be removed.
    if (dto.points !== 0 && !isLoyaltyEnabled(program))
      throw new BadRequestException(
        "The loyalty program is turned off for this restaurant.",
      );

    if (dto.points === 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { pointsRedeemed: null, redemptionValueCents: null },
      });
      return this.refreshAndEmit(tenantId, orderId, "updated");
    }

    const account = await this.prisma.loyaltyAccount.findFirst({
      where: { id: order.loyaltyAccountId, tenantId },
    });
    if (!account) throw new NotFoundException("Loyalty account not found");

    const subtotal = orderSubtotal(order);
    const max = maxRedeemablePoints(subtotal, account.pointsBalance, program);
    if (dto.points > max)
      throw new BadRequestException(`At most ${max} points may be redeemed on this bill.`);

    const discount = redemptionValueMinor(dto.points, program);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { pointsRedeemed: dto.points, redemptionValueCents: discount },
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
    // "join" strategy (pass 5): the staff floor list + every SSE snapshot hit
    // this — one LATERAL-join query instead of 4 sequential ones.
    const rows = await this.prisma.order.findMany({
      relationLoadStrategy: "join",
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
    // Guarded writes (pass 4): the item must belong to this order/tenant AND
    // the order must still be live — enforced in the WHERE of the write
    // itself (extended-where-unique: unique id + extra guard filters), so the
    // happy path pays ONE round trip where two pre-flight reads used to run
    // first. NOT updateMany/deleteMany — Prisma wraps those in an implicit
    // BEGIN…COMMIT (+2 round trips), which would eat the entire saving.
    // The live-status condition preserves the terminal-session rule: a
    // cancelled/paid session refuses item edits — including the KDS status
    // write-through — so a stale kitchen board can't resurrect a dead order.
    // A no-match throws P2025 → throwItemUpdateError re-reads to pick the
    // same 404/409 the old pre-flight checks threw (sad path only).
    const itemWhere: Prisma.OrderItemWhereUniqueInput = {
      id: itemId,
      tenantId,
      round: {
        is: { order: { is: { id: orderId, tenantId, status: { in: ["open", "billed"] } } } },
      },
    };
    const noMatch = (e: unknown) =>
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";

    if (dto.qty === 0) {
      try {
        await this.prisma.orderItem.delete({ where: itemWhere });
      } catch (e) {
        if (noMatch(e)) await this.throwItemUpdateError(tenantId, orderId, itemId);
        else throw e;
      }
      return this.refreshAndEmit(tenantId, orderId, "updated");
    }

    const stamp = dto.status !== undefined ? STATUS_STAMP[dto.status] : null;
    const statusData =
      dto.status !== undefined
        ? { status: dto.status, ...(stamp ? { [stamp]: new Date() } : {}) }
        : {};

    if (dto.qtyDelta !== undefined) {
      // Atomic increment at the DB layer (`qty = qty + delta`) — Postgres
      // serializes concurrent updates to the same row via its row lock, so two
      // rapid deltas (double-tap, or two staff devices) both land instead of
      // the second clobbering the first the way a client-computed absolute
      // write would. A simultaneous status change rides the same write.
      let updated;
      try {
        updated = await this.prisma.orderItem.update({
          where: itemWhere,
          data: { qty: { increment: dto.qtyDelta }, ...statusData },
        });
      } catch (e) {
        if (noMatch(e)) await this.throwItemUpdateError(tenantId, orderId, itemId);
        throw e;
      }
      // A decrement that lands at/below zero removes the line. Guarded on the
      // live qty so a concurrent +1 that raced us keeps the row.
      if (updated.qty <= 0)
        await this.prisma.orderItem
          .delete({ where: { id: itemId, tenantId, qty: { lte: 0 } } })
          .catch(() => {});
      return this.refreshAndEmit(tenantId, orderId, "updated");
    }

    try {
      await this.prisma.orderItem.update({
        where: itemWhere,
        data: { ...(dto.qty !== undefined ? { qty: dto.qty } : {}), ...statusData },
      });
    } catch (e) {
      if (noMatch(e)) await this.throwItemUpdateError(tenantId, orderId, itemId);
      else throw e;
    }
    return this.refreshAndEmit(tenantId, orderId, "updated");
  }

  /**
   * Failure-path diagnosis for updateItem's guarded writes: a count of 0 means
   * missing order, terminal session, or missing item — re-read (one query) to
   * throw the same error the old pre-flight checks did. Never runs on success.
   */
  private async throwItemUpdateError(
    tenantId: string,
    orderId: string,
    itemId: string,
  ): Promise<never> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { status: true },
    });
    if (!order) throw new NotFoundException(`Order not found: ${orderId}`);
    if (order.status === "closed" || order.status === "paid")
      throw new ConflictException(
        "This session is closed; its items can no longer be changed.",
      );
    throw new NotFoundException(`Order item not found: ${itemId}`);
  }

  /** Abandon a session without payment (walkout / mistake). Frees the table. */
  async cancel(tenantId: string, orderId: string): Promise<Order> {
    // Staff route (JwtAuthGuard) — the caller is authenticated, not a guest.
    // Pass 4: the full load happens ONCE, up front (it throws the 404 and is
    // the emit payload), then a tenant-guarded write — instead of assert +
    // write + a second full reload. The emitted order is the loaded one with
    // the two fields this call changes patched on, same as capturePayment.
    const order = await this.get(tenantId, orderId, undefined, true);
    const closedAt = new Date();
    // update, not updateMany — Prisma wraps updateMany in an implicit
    // BEGIN…COMMIT (+2 round trips); extended-where-unique update emits one
    // plain statement with the tenant guard in its WHERE.
    await this.prisma.order.update({
      where: { id: orderId, tenantId },
      data: { status: "closed", closedAt },
    });
    const closed: Order = {
      ...order,
      status: "closed",
      closedAt: closedAt.toISOString(),
    };
    this.events.emit(tenantId, { type: "closed", orderId, order: closed });
    return closed;
  }

  /** Settle the bill: snapshot totals, record the payment, close the session. */
  async capturePayment(
    tenantId: string,
    orderId: string,
    taxRate: number,
    dto: CapturePaymentDto,
    deviceId?: string,
    trusted = false,
    loyaltyProgram?: LoyaltyProgram,
  ): Promise<Payment> {
    const order = await this.get(tenantId, orderId, deviceId, trusted);
    if (order.status === "paid")
      throw new BadRequestException("Order already paid");
    // A cancelled/abandoned session is `closed`. Refuse to capture against it so
    // a stale guest client can't resurrect a cancelled order into a paid sale.
    if (order.status === "closed")
      throw new ConflictException("This session was cancelled and can't be paid.");

    const subtotal = orderSubtotal(order);
    // Redemption (if staff applied one via redeemPoints) discounts the taxable
    // subtotal. Re-validated against the live balance below, inside the
    // transaction, in case it drifted since the redemption was drafted.
    const redeemPoints = order.pointsRedeemed ?? 0;
    const redemptionDiscount = Math.min(order.redemptionValueMinor ?? 0, subtotal);
    const discountedSubtotal = subtotal - redemptionDiscount;
    const tax = Math.round(discountedSubtotal * taxRate);
    const tip = dto.tip;
    const total = discountedSubtotal + tax + tip;
    const pointsEarned =
      isLoyaltyEnabled(loyaltyProgram) && order.loyaltyAccountId
        ? pointsForSpend(discountedSubtotal, loyaltyProgram)
        : 0;

    const now = new Date();
    let payment: PrismaPayment;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: {
            tenantId,
            orderId,
            method: dto.method,
            subtotal: discountedSubtotal,
            tax,
            tip,
            total,
            tendered: dto.tendered,
          },
        });
        // Guarded close (pass 4): the status checks above ran on a pre-read,
        // so a staff cancel landing in between could otherwise be silently
        // resurrected into a paid sale here. Guarding the write on the LIVE
        // statuses makes the close atomic — count 0 = the order was closed/paid
        // meanwhile → 409 and the whole transaction (payment row included)
        // rolls back.
        const closed = await tx.order.updateMany({
          where: { id: orderId, tenantId, status: { in: ["open", "billed"] } },
          data: {
            status: "paid",
            closedAt: now,
            pointsEarned: pointsEarned || null,
            pointsRedeemed: redeemPoints || null,
            redemptionValueCents: redemptionDiscount || null,
          },
        });
        if (closed.count === 0)
          throw new ConflictException(
            "This session was closed while the payment was being captured.",
          );

        // Loyalty bookkeeping — one read (for the live balance + the redeem
        // check), one atomic write (net delta, immune to a concurrent order
        // touching the same account), then the ledger rows in parallel. Was
        // up to 5 sequential round-trips (read, write, insert, write, insert);
        // now 3.
        if (order.loyaltyAccountId && isLoyaltyEnabled(loyaltyProgram) && (redeemPoints > 0 || pointsEarned > 0)) {
          const account = await tx.loyaltyAccount.findUniqueOrThrow({
            where: { id: order.loyaltyAccountId },
          });
          if (redeemPoints > 0 && account.pointsBalance < redeemPoints)
            throw new BadRequestException(
              "The linked account's points balance changed — please re-apply the redemption.",
            );
          const afterRedeem = account.pointsBalance - redeemPoints;
          const afterEarn = afterRedeem + pointsEarned;
          await tx.loyaltyAccount.update({
            where: { id: order.loyaltyAccountId },
            data: {
              pointsBalance: { increment: pointsEarned - redeemPoints },
              ...(pointsEarned > 0 ? { lifetimePoints: { increment: pointsEarned } } : {}),
            },
          });
          const ledgerWrites: Promise<unknown>[] = [];
          if (redeemPoints > 0)
            ledgerWrites.push(
              tx.loyaltyTransaction.create({
                data: {
                  tenantId,
                  accountId: order.loyaltyAccountId,
                  orderId,
                  type: "redeem",
                  points: -redeemPoints,
                  balanceAfter: afterRedeem,
                },
              }),
            );
          if (pointsEarned > 0)
            ledgerWrites.push(
              tx.loyaltyTransaction.create({
                data: {
                  tenantId,
                  accountId: order.loyaltyAccountId,
                  orderId,
                  type: "earn",
                  points: pointsEarned,
                  balanceAfter: afterEarn,
                },
              }),
            );
          await Promise.all(ledgerWrites);
        }
        return p;
      });
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
    // phone leaves the bill screen in real time. Built from the order already
    // in hand + the fields this call just changed — skips a second full
    // (rounds→items→modifiers) reload, which only ever echoed data we already
    // know here.
    const closed: Order = {
      ...order,
      status: "paid",
      closedAt: now.toISOString(),
      pointsEarned: pointsEarned || undefined,
      pointsRedeemed: redeemPoints || undefined,
      redemptionValueMinor: redemptionDiscount || undefined,
    };
    this.events.emit(tenantId, { type: "closed", orderId, order: closed });
    return toDomainPayment(payment);
  }

  /**
   * Atomic counter checkout (Quick Sale, staff-only). One transaction writes
   * the order (born `paid` — it is never live), its single round of items and
   * the captured payment. That shape is what lets many devices ring up counter
   * sales at once against the one shared virtual counter table: because no
   * quick-sale order ever exists in `open`/`billed`, the single-occupancy
   * guard has nothing to collide with, no partially-saved session can leak to
   * another device's Quick Sale screen, and a client that dies mid-request
   * leaves either a complete sale or nothing (its local draft covers retry).
   * Items and modifiers are re-priced from the DB, not the client numbers.
   */
  async quickSale(
    tenantId: string,
    taxRate: number,
    dto: QuickSaleDto,
  ): Promise<{ order: Order; payment: Payment }> {
    // Idempotency fast path: if this cart's key already produced a sale, return
    // THAT sale rather than charging again. This is what makes a retry after a
    // lost response safe — the till cannot tell "never charged" from "charged,
    // reply lost", so it must be safe to just ask again.
    if (dto.clientRequestId) {
      const replay = await this.findByClientRequestId(
        tenantId,
        dto.clientRequestId,
      );
      if (replay) return replay;
    }

    // Same find-or-create as TablesService.getOrCreateCounter, inlined to keep
    // the sale free of a cross-module dependency (only the id is needed).
    const [counter, menuItems] = await Promise.all([
      this.prisma.table.findFirst({
        where: { tenantId, isCounter: true },
        select: { id: true },
      }),
      this.prisma.menuItem.findMany({
        where: { id: { in: [...new Set(dto.items.map((i) => i.menuItemId))] }, tenantId },
        include: { modifierGroups: { include: { options: true } } },
      }),
    ]);
    const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

    const orderId = randomUUID();
    const roundId = randomUUID();
    const itemRows: Prisma.OrderItemCreateManyInput[] = [];
    const modifierRows: Prisma.OrderItemModifierCreateManyInput[] = [];
    let subtotal = 0;
    for (const i of dto.items) {
      const menuItem = menuItemById.get(i.menuItemId) ?? null;
      // Price from the DB when the item still exists; the client snapshot is
      // only the fallback for an item deleted since it was added to the cart.
      const unitPrice = menuItem?.price ?? i.unitPrice;
      const itemId = randomUUID();
      let modifierDelta = 0;
      for (const m of this.resolveItemModifiers(tenantId, menuItem, i.modifiers ?? [])) {
        modifierRows.push({ ...m, id: randomUUID(), orderItemId: itemId });
        modifierDelta += m.priceDelta;
      }
      itemRows.push({
        id: itemId,
        tenantId,
        roundId,
        menuItemId: menuItem ? i.menuItemId : null,
        name: menuItem?.name ?? i.name,
        unitPrice,
        qty: i.qty,
        notes: i.notes,
      });
      subtotal += (unitPrice + modifierDelta) * i.qty;
    }

    const tax = Math.round(subtotal * taxRate);
    const tip = dto.payment.tip;
    const total = subtotal + tax + tip;
    const now = new Date();

    let created: { order: Order; payment: PrismaPayment };
    try {
      created = await this.prisma.$transaction(async (tx) => {
      let tableId = counter?.id;
      if (!tableId) {
        const created = await tx.table.create({
          data: {
            tenantId,
            label: "Counter Sale",
            qrToken: randomUUID(),
            isCounter: true,
          },
          select: { id: true },
        });
        tableId = created.id;
      }
      await tx.order.create({
        data: {
          id: orderId,
          tenantId,
          tableId,
          status: "paid",
          closedAt: now,
          clientRequestId: dto.clientRequestId,
        },
      });
      await tx.round.create({
        data: { id: roundId, tenantId, orderId, type: "bundled" },
      });
      if (itemRows.length) await tx.orderItem.createMany({ data: itemRows });
      if (modifierRows.length)
        await tx.orderItemModifier.createMany({ data: modifierRows });
      const p = await tx.payment.create({
        data: {
          tenantId,
          orderId,
          method: dto.payment.method,
          subtotal,
          tax,
          tip,
          total,
          tendered: dto.payment.tendered,
        },
      });
      // Reload inside the transaction — doubles as the emit payload.
      const row = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: ROUND_INCLUDE,
      });
      if (!row) throw new NotFoundException(`Order not found: ${orderId}`);
      return { order: toDomainOrder(row), payment: p };
      });
    } catch (err) {
      // Two retries of the same cart racing each other (double-tap, or a retry
      // landing while the first request is still committing) both pass the
      // fast-path check above; the unique index on clientRequestId is the real
      // tiebreaker. The loser resolves to the winner's sale instead of erroring
      // — still exactly one charge.
      if (
        dto.clientRequestId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const replay = await this.findByClientRequestId(
          tenantId,
          dto.clientRequestId,
        );
        if (replay) return replay;
      }
      throw err;
    }

    // `closed` (not `created`) — the sale enters the world already settled, so
    // subscribers only ever need the "session done, refresh sales" reaction.
    this.events.emit(tenantId, { type: "closed", orderId, order: created.order });
    return {
      order: created.order,
      payment: toDomainPayment(created.payment),
    };
  }

  /**
   * Resolve a previously-recorded Quick Sale from its idempotency key. Returns
   * null when the key has never been used, so the caller creates the sale.
   * Only ever returns a sale that actually has a Payment row — an order without
   * one was never a completed charge and must not be replayed as if it were.
   */
  private async findByClientRequestId(
    tenantId: string,
    clientRequestId: string,
  ): Promise<{ order: Order; payment: Payment } | null> {
    const row = await this.prisma.order.findFirst({
      relationLoadStrategy: "join",
      where: { tenantId, clientRequestId },
      include: ROUND_INCLUDE,
    });
    if (!row) return null;
    const payment = await this.prisma.payment.findFirst({
      where: { orderId: row.id, tenantId },
    });
    if (!payment) return null;
    return { order: toDomainOrder(row), payment: toDomainPayment(payment) };
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
   * Sales report as a downloadable .xlsx workbook (Summary, Daily Sales,
   * Orders, Order Items, Item Summary) for a `from`/`to` window — the
   * table/order/item-level export staff pull for bookkeeping or reconciliation.
   * Unlike `listSales`, this is never capped: a financial export that silently
   * truncates would be worse than a large file.
   */
  async exportSalesReport(
    tenantId: string,
    tenant: { name: string; currency: string },
    range?: { from?: string; to?: string },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const to = range?.to ? new Date(range.to) : new Date();
    const from = range?.from
      ? new Date(range.from)
      : new Date(to.getTime() - 86_400_000);
    // Mirrors getAnalytics: compare against the immediately preceding
    // equal-length window so the Summary sheet's deltas match the Analytics page.
    const windowMs = Math.max(1, to.getTime() - from.getTime());
    const prevFrom = new Date(from.getTime() - windowMs);

    const [payments, prev] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "asc" },
        include: {
          order: {
            include: {
              table: true,
              rounds: {
                include: {
                  items: {
                    include: {
                      modifiers: true,
                      menuItem: { include: { category: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, createdAt: { gte: prevFrom, lt: from } },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    const workbook = await buildSalesWorkbook({
      tenantName: tenant.name,
      currency: tenant.currency,
      from,
      to,
      generatedAt: new Date(),
      payments,
      previousPeriod: { revenue: prev._sum.total ?? 0, orders: prev._count._all ?? 0 },
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const stamp = (d: Date) => d.toISOString().slice(0, 10);
    return { buffer, filename: `sales-report_${stamp(from)}_to_${stamp(to)}.xlsx` };
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
    // Callers already inside a $transaction pass their tx client so the guard
    // shares that BEGIN/COMMIT instead of paying its own (see addRound).
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const order = await db.order.findFirst({
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
    if (trusted) return; // authenticated staff / internal server-side reload
    // A guest-opened session always has a deviceId; a null deviceId means a
    // staff walk-in, which is only ever acted on by authenticated staff (who
    // arrive here with trusted=true). An UNTRUSTED caller must therefore both
    // present a device id AND have it match — a null-device order is NOT a free
    // pass, otherwise anyone who learned a walk-in order id could read the
    // guest's name/phone or add rounds / capture payment on it.
    if (orderDeviceId && deviceId && deviceId === orderDeviceId) return;
    throw new ForbiddenException("This session belongs to another device.");
  }
}
