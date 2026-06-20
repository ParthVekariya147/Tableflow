/**
 * Local data model for the standalone admin panel.
 *
 * This is a self-contained, in-memory mirror of the platform domain
 * (@amber/domain) so the panel can demonstrate the full manager workflow —
 * editing the menu, running table sessions, taking payment — with no backend.
 * Money is stored in integer cents, matching the real domain contract.
 */

export type ItemStatus = "placed" | "preparing" | "served" | "cancelled";
export type RoundType = "instant" | "bundled";
export type TableStatus = "free" | "seated" | "ordering" | "bill";
export type PaymentMethod = "cash" | "card";

export interface Category {
  id: string;
  name: string;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
  /** Material Symbols icon name used as the card "photo" stand-in. */
  icon: string;
  /** Tailwind gradient classes for the card photo backdrop. */
  swatch: string;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  priceCents: number;
  qty: number;
  note?: string;
  status: ItemStatus;
}

export interface Round {
  id: string;
  type: RoundType;
  /** epoch ms when the round was fired */
  placedAt: number;
  items: OrderItem[];
}

export interface TableSession {
  openedAt: number;
  rounds: Round[];
}

export interface Table {
  id: string;
  label: string;
  room: string;
  seats: number;
  status: TableStatus;
  qrToken: string;
  session?: TableSession;
}

export interface Sale {
  id: string;
  tableLabel: string;
  totalCents: number;
  method: PaymentMethod;
  at: number;
}

export interface AdminState {
  taxRate: number;
  categories: Category[];
  items: MenuItem[];
  tables: Table[];
  sales: Sale[];
}
