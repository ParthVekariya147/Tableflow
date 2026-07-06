/**
 * Local data model for the standalone admin panel.
 *
 * This is a self-contained, in-memory mirror of the platform domain
 * (@amber/domain) so the panel can demonstrate the full manager workflow —
 * editing the menu, running table sessions, taking payment — with no backend.
 * Money is stored in integer cents, matching the real domain contract.
 */

export type ItemStatus =
  | "placed"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled";
export type RoundType = "instant" | "bundled";
export type TableStatus = "free" | "seated" | "ordering" | "bill";
export type PaymentMethod = "cash" | "card" | "upi";

export interface Category {
  id: string;
  name: string;
}

export type ModifierInputType = "single" | "multiple" | "toggle" | "text";

export interface ModifierOption {
  id?: string;
  name: string;
  priceCents: number; // delta; may be negative
  available?: boolean;
}

export interface ModifierGroup {
  id?: string;
  name: string;
  inputType: ModifierInputType;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  maxLength?: number | null;
  placeholder?: string;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
  /** Veg / Non-veg dietary marker (Indian menu convention). null = unmarked. */
  dietary?: "veg" | "non_veg" | null;
  /** Jain (no roots/onion/garlic); shown as an extra J badge. */
  jain?: boolean;
  /** Material Symbols icon name used as the card "photo" stand-in. */
  icon: string;
  /** Tailwind gradient classes for the card photo backdrop. */
  swatch: string;
  /** Optional uploaded photo (data URL). When set, it replaces the icon/swatch stand-in. */
  imageUrl?: string;
  /** Custom modifier groups (cheese, toppings, spice, notes…). */
  modifierGroups?: ModifierGroup[];
}

export interface OrderItemModifier {
  id: string;
  optionId: string | null;
  groupName: string;
  name: string;
  /** Per-unit price change, in cents; may be negative. */
  priceDelta: number;
  textValue?: string;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  priceCents: number;
  qty: number;
  note?: string;
  status: ItemStatus;
  modifiers?: OrderItemModifier[];
}

export interface Round {
  id: string;
  type: RoundType;
  /** epoch ms when the round was fired */
  placedAt: number;
  items: OrderItem[];
}

export interface TableSession {
  /** Server-side Order id backing this session (used for API mutations). */
  orderId?: string;
  openedAt: number;
  rounds: Round[];
  /** epoch ms when the guest requested the bill (set once `status` becomes "bill"). */
  billRequestedAt?: number;
  /** Guest contact captured at session start — optional, shown on the session page. */
  customerName?: string;
  customerPhone?: string;
}

export interface Table {
  id: string;
  label: string;
  room: string;
  seats: number;
  status: TableStatus;
  qrToken: string;
  session?: TableSession;
  /** True for the auto-created virtual "Counter Sale" table used by the
   *  no-table quick-sale flow — hidden from the floor plan grid. */
  isCounter?: boolean;
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
  /** Tenant's ISO-4217 currency code (e.g. "USD", "INR"). Drives money formatting. */
  currency: string;
  /** GST registration number shown on bills/receipts. */
  gstNumber?: string;
  /** UPI VPA for QR / deep-link payments (e.g. "restaurant@okicici"). */
  upiId?: string;
  /** Mobile number registered with UPI shown alongside the QR. */
  upiMobile?: string;
  /** Tenant's display name (used in UPI QR payer name field). */
  tenantName?: string;
  categories: Category[];
  items: MenuItem[];
  tables: Table[];
  sales: Sale[];
}
