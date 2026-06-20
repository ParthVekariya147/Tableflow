import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Table, FloorTable, Order } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainOrder } from "../orders/orders.mapper.js";
import { toDomainTable, toFloorTable } from "./tables.mapper.js";
import type { CreateTableDto, UpdateTableDto } from "./tables.dto.js";

const ROUND_INCLUDE = { rounds: { include: { items: true } } } as const;
/** Orders that still "occupy" a table (not yet paid/closed). */
const LIVE_STATUSES = ["open", "billed"] as const;

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Floor view: every table with its live session + derived status. */
  async listFloor(tenantId: string): Promise<FloorTable[]> {
    const [tables, liveOrders] = await Promise.all([
      this.prisma.table.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        include: { room: true },
      }),
      this.prisma.order.findMany({
        where: { tenantId, status: { in: [...LIVE_STATUSES] } },
        orderBy: { createdAt: "desc" },
        include: ROUND_INCLUDE,
      }),
    ]);

    // Newest live order per table (orders already sorted desc).
    const activeByTable = new Map<string, Order>();
    for (const o of liveOrders) {
      if (!activeByTable.has(o.tableId))
        activeByTable.set(o.tableId, toDomainOrder(o));
    }

    return tables.map((t) => toFloorTable(t, activeByTable.get(t.id) ?? null));
  }

  /** Add a table to the floor. Generates a unique QR token. */
  async create(tenantId: string, dto: CreateTableDto): Promise<Table> {
    const roomId = await this.resolveRoom(tenantId, dto.room);
    const sortOrder = dto.sortOrder ?? (await this.nextSort(tenantId));
    const row = await this.prisma.table.create({
      data: {
        tenantId,
        label: dto.label,
        seats: dto.seats,
        roomId,
        sortOrder,
        qrToken: randomUUID(),
      },
      include: { room: true },
    });
    return toDomainTable(row);
  }

  /** Edit a table's label / seats / room / order. */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateTableDto,
  ): Promise<Table> {
    await this.assertTable(tenantId, id);
    const roomId =
      dto.room !== undefined
        ? await this.resolveRoom(tenantId, dto.room)
        : undefined;
    const row = await this.prisma.table.update({
      where: { id },
      data: {
        label: dto.label,
        seats: dto.seats,
        roomId,
        sortOrder: dto.sortOrder,
      },
      include: { room: true },
    });
    return toDomainTable(row);
  }

  /** Rotate a table's QR token (e.g. after a printout leaks). */
  async regenerateQr(tenantId: string, id: string): Promise<Table> {
    await this.assertTable(tenantId, id);
    const row = await this.prisma.table.update({
      where: { id },
      data: { qrToken: randomUUID() },
      include: { room: true },
    });
    return toDomainTable(row);
  }

  /** Remove a table. Refused (409) if it has order history — archive instead. */
  async remove(tenantId: string, id: string): Promise<void> {
    await this.assertTable(tenantId, id);
    const orders = await this.prisma.order.count({ where: { tenantId, tableId: id } });
    if (orders > 0)
      throw new ConflictException(
        "Table has order history and cannot be deleted.",
      );
    await this.prisma.table.delete({ where: { id } });
  }

  /** Customer entry: resolve a table from its QR token. */
  async byQrToken(tenantId: string, qrToken: string): Promise<Table> {
    const row = await this.prisma.table.findFirst({
      where: { tenantId, qrToken },
      include: { room: true },
    });
    if (!row) throw new NotFoundException(`Table not found for QR: ${qrToken}`);
    return toDomainTable(row);
  }

  /** Find-or-create a Room by name; returns null when no room given. */
  private async resolveRoom(
    tenantId: string,
    name?: string,
  ): Promise<string | null> {
    if (!name) return null;
    const room = await this.prisma.room.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name },
    });
    return room.id;
  }

  private async assertTable(tenantId: string, id: string): Promise<void> {
    const found = await this.prisma.table.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Table not found: ${id}`);
  }

  private async nextSort(tenantId: string): Promise<number> {
    const last = await this.prisma.table.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}
