import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import type { LoyaltyAccount, LoyaltyTransaction } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  toDomainLoyaltyAccount,
  toDomainLoyaltyTransaction,
} from "./loyalty.mapper.js";
import type { AdjustLoyaltyAccountDto } from "./loyalty.dto.js";

/**
 * Retroactively links Orders that captured a customer's name/phone but never
 * got a LoyaltyAccount — e.g. orders placed before the loyalty program was
 * enabled for the tenant, or via a flow (Quick Sale) that doesn't run the
 * account upsert in `OrdersService.createForTable`. Without this, those
 * guests' order history is invisible to the staff directory even though the
 * name/phone was captured at the time. Upsert-only and idempotent: safe to
 * run before every directory read. Pass `tenantId` to scope one tenant, or
 * omit it for the cross-tenant super-admin view.
 */
export async function backfillLoyaltyAccountsFromOrders(
  prisma: PrismaService,
  tenantId?: string,
): Promise<void> {
  const orphaned = await prisma.order.findMany({
    where: {
      customerPhone: { not: null },
      loyaltyAccountId: null,
      ...(tenantId ? { tenantId } : {}),
    },
    select: { tenantId: true, customerPhone: true, customerName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (orphaned.length === 0) return;

  // Later orders win the name, in case the guest gave a different name on a
  // repeat visit under the same phone number.
  const byAccount = new Map<string, { tenantId: string; phone: string; name: string | null }>();
  for (const o of orphaned) {
    byAccount.set(`${o.tenantId}:${o.customerPhone}`, {
      tenantId: o.tenantId,
      phone: o.customerPhone!,
      name: o.customerName,
    });
  }

  for (const { tenantId: tid, phone, name } of byAccount.values()) {
    const account = await prisma.loyaltyAccount.upsert({
      where: { tenantId_phone: { tenantId: tid, phone } },
      update: name ? { name } : {},
      create: { tenantId: tid, phone, name },
    });
    await prisma.order.updateMany({
      where: { tenantId: tid, customerPhone: phone, loyaltyAccountId: null },
      data: { loyaltyAccountId: account.id },
    });
  }
}

/** One of this customer's visits — what they ordered, the price, and how they paid. */
export interface LoyaltyOrderSummary {
  id: string;
  tableLabel: string;
  status: string;
  createdAt: string;
  items: Array<{ name: string; qty: number; unitPrice: number }>;
  payment: {
    method: string;
    subtotal: number;
    tax: number;
    tip: number;
    total: number;
  } | null;
}

/**
 * The staff-facing customer directory: search accounts, view transaction
 * history, manual corrections. Order-lifecycle bookkeeping (silent account
 * creation at session start, earn/redeem at payment capture) lives directly in
 * OrdersService instead of here — it's all Prisma calls inside the SAME
 * transaction as the Payment write, so routing it through a second service
 * would only add an interactive-transaction-client seam for no benefit.
 */
@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Search this tenant's accounts by phone/name (staff directory). */
  async list(tenantId: string, search?: string): Promise<LoyaltyAccount[]> {
    await backfillLoyaltyAccountsFromOrders(this.prisma, tenantId);
    const q = search?.trim();
    const rows = await this.prisma.loyaltyAccount.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { phone: { contains: q } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map(toDomainLoyaltyAccount);
  }

  /** Account + its transaction history and actual order history (what they
   *  ordered, pricing, payment method per visit), most recent first. */
  async get(
    tenantId: string,
    id: string,
  ): Promise<{
    account: LoyaltyAccount;
    transactions: LoyaltyTransaction[];
    orders: LoyaltyOrderSummary[];
  }> {
    const row = await this.prisma.loyaltyAccount.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException(`Loyalty account not found: ${id}`);
    const [txns, orderRows] = await Promise.all([
      this.prisma.loyaltyTransaction.findMany({
        where: { accountId: id, tenantId },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.order.findMany({
        where: { loyaltyAccountId: id, tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          table: { select: { label: true } },
          payment: true,
          rounds: { include: { items: true } },
        },
      }),
    ]);
    return {
      account: toDomainLoyaltyAccount(row),
      transactions: txns.map(toDomainLoyaltyTransaction),
      orders: orderRows.map((o) => ({
        id: o.id,
        tableLabel: o.table.label,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        items: o.rounds
          .flatMap((r) => r.items)
          .filter((i) => i.status !== "cancelled")
          .map((i) => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice })),
        payment: o.payment
          ? {
              method: o.payment.method,
              subtotal: o.payment.subtotal,
              tax: o.payment.tax,
              tip: o.payment.tip,
              total: o.payment.total,
            }
          : null,
      })),
    };
  }

  /** Manual correction (comp/fix) — writes an "adjust" transaction. */
  async adjust(
    tenantId: string,
    id: string,
    dto: AdjustLoyaltyAccountDto,
  ): Promise<LoyaltyAccount> {
    const existing = await this.prisma.loyaltyAccount.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Loyalty account not found: ${id}`);
    const balanceAfter = existing.pointsBalance + dto.points;
    if (balanceAfter < 0)
      throw new BadRequestException("Adjustment would make the balance negative.");

    const [account] = await this.prisma.$transaction([
      this.prisma.loyaltyAccount.update({
        where: { id },
        data: {
          pointsBalance: { increment: dto.points },
          ...(dto.points > 0 ? { lifetimePoints: { increment: dto.points } } : {}),
        },
      }),
      this.prisma.loyaltyTransaction.create({
        data: {
          tenantId,
          accountId: id,
          type: "adjust",
          points: dto.points,
          balanceAfter,
          note: dto.note,
        },
      }),
    ]);
    return toDomainLoyaltyAccount(account);
  }
}
