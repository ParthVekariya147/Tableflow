# Amber & Grain — Database ERD

Generated from `prisma/schema.prisma`. Tenant is the root; every operational row
carries `tenantId` for multi-tenant scoping (those tenant edges are omitted below
to keep the diagram readable — assume every entity also points back to `Tenant`).

```mermaid
erDiagram
    Tenant ||--o{ Membership : has
    Tenant ||--o{ Role : defines
    Role   ||--o{ Membership : grants
    Tenant ||--o{ Room : has
    Tenant ||--o{ Table : has
    Tenant ||--o{ MenuCategory : has
    Tenant ||--o{ MenuItem : has
    Tenant ||--o{ Order : has

    User ||--o{ Membership : "joins via"
    User |o--o{ Order : "serves (serverId)"
    User |o--o{ Payment : "takes (takenById)"

    Room |o--o{ Table : groups
    Table ||--o{ Order : seats

    MenuCategory ||--o{ MenuItem : contains
    MenuItem ||--o{ ModifierGroup : has
    ModifierGroup ||--o{ ModifierOption : offers
    MenuItem ||--o{ MenuPlacement : "curated as"

    Order ||--o{ Round : "split into"
    Round ||--o{ OrderItem : contains
    MenuItem |o--o{ OrderItem : "snapshotted by"
    OrderItem ||--o{ OrderItemModifier : "chosen on"
    ModifierOption |o--o{ OrderItemModifier : "selected as"

    Order ||--o| Payment : "settled by"
    Order ||--o| Review : "rated by"

    Tenant {
        string id PK
        string slug UK
        string name
        string currency
        float  taxRate
        json   theme
        bool   active
    }
    User {
        string id PK
        string email UK
        string passwordHash
        string name
        bool   isSuperAdmin
        bool   active
    }
    Role {
        string   id PK
        string   tenantId FK
        string   name "UK per tenant"
        string[] permissions "permission keys"
        bool     protected "lockout guard"
    }
    Membership {
        string   id PK
        string   tenantId FK
        string   userId FK
        string   roleId FK
        string[] permissions "per-user override"
        bool     active
    }
    Room {
        string id PK
        string tenantId FK
        string name
        int    sortOrder
    }
    Table {
        string id PK
        string tenantId FK
        string roomId FK
        string label
        string qrToken UK
        int    seats
        int    sortOrder
    }
    MenuCategory {
        string id PK
        string tenantId FK
        string name
        int    sortOrder
    }
    MenuItem {
        string id PK
        string tenantId FK
        string categoryId FK
        string name
        string description
        int    price "cents"
        string badge
        string imageUrl
        string icon
        string swatch
        bool   available
        int    sortOrder
    }
    ModifierGroup {
        string id PK
        string tenantId FK
        string menuItemId FK
        string name
        ModifierInputType inputType "single|multiple|toggle|text"
        bool   required
        int    minSelect
        int    maxSelect
        int    maxLength "text only"
        string placeholder "text only"
        int    sortOrder
    }
    ModifierOption {
        string id PK
        string tenantId FK
        string groupId FK
        string name
        int    priceDelta "cents"
        bool   available
        int    sortOrder
    }
    MenuPlacement {
        string id PK
        string tenantId FK
        string menuItemId FK
        PlacementKind kind
        string section
        int    sortOrder
    }
    Order {
        string id PK
        string tenantId FK
        string tableId FK
        string serverId FK
        string customerName "guest contact"
        string customerPhone "guest contact"
        OrderStatus status
        datetime billRequestedAt
        datetime closedAt
    }
    Round {
        string id PK
        string tenantId FK
        string orderId FK
        RoundType type
    }
    OrderItem {
        string id PK
        string tenantId FK
        string roundId FK
        string menuItemId FK
        string name "snapshot"
        int    unitPrice "cents"
        int    qty
        ItemStatus status
        string notes
        datetime preparingAt
        datetime readyAt
        datetime servedAt
        datetime cancelledAt
    }
    OrderItemModifier {
        string id PK
        string tenantId FK
        string orderItemId FK
        string optionId FK "null for text"
        string groupName "snapshot"
        string name "snapshot"
        int    priceDelta "cents"
        string textValue "text groups"
    }
    Payment {
        string id PK
        string tenantId FK
        string orderId FK,UK
        PaymentMethod method
        int    subtotal "cents"
        int    tax "cents"
        int    tip "cents"
        int    total "cents"
        int    tendered "cash"
        string takenById FK
    }
    Review {
        string id PK
        string tenantId FK
        string orderId FK,UK
        int    stars "1-5"
        string comment
    }
```

## RBAC
- **Role** is now a **per-tenant table** (not an enum) — Admins create/rename
  custom roles. `Role.permissions` + the per-user `Membership.permissions`
  override are arrays of **permission keys** (the fixed catalog in `@amber/domain`
  `PERMISSIONS`): `dashboard.view · menu.manage · tables.manage · kds.use ·
  orders.history · analytics.view · settings.manage · team.manage`.
  Effective access = `Membership.permissions` if non-empty, else `Role.permissions`.

## Enums
- **ModifierSelection**: single · multiple
- **PlacementKind**: featured · welcome
- **OrderStatus**: open · billed · paid · closed
- **RoundType**: instant · bundled
- **ItemStatus**: placed · preparing · ready · served · cancelled
- **PaymentMethod**: cash · card

## Cardinality notes
- `|o` / `o{` = optional side (nullable FK): `Order.serverId`, `Table.roomId`,
  `OrderItem.menuItemId`, `OrderItemModifier.optionId`, `Payment.takenById` are all nullable.
- `Order → Payment` and `Order → Review` are **1-to-(0..1)** (`orderId` is `@unique`).
- Snapshot fields (`OrderItem.name/unitPrice`, `OrderItemModifier.name/priceDelta`)
  preserve display when the source menu item/option is later deleted (FK → null).
