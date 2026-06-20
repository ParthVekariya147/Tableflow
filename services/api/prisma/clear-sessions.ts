/**
 * One-off maintenance: wipe ALL table sessions (orders) and everything attached
 * — rounds, order items, modifiers, payments, reviews — across every tenant.
 *
 * Leaves tenants, menu, rooms and tables intact. Table status is derived from
 * live orders, so every table returns to "available" once this runs.
 *
 *   pnpm --filter @amber/api exec tsx prisma/clear-sessions.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Children → parents. Order rows cascade too, but explicit deletes give counts.
  const modifiers = await prisma.orderItemModifier.deleteMany({});
  const payments = await prisma.payment.deleteMany({});
  const reviews = await prisma.review.deleteMany({});
  const items = await prisma.orderItem.deleteMany({});
  const rounds = await prisma.round.deleteMany({});
  const orders = await prisma.order.deleteMany({});

  console.log("Cleared all sessions:");
  console.table({
    orders: orders.count,
    rounds: rounds.count,
    orderItems: items.count,
    modifiers: modifiers.count,
    payments: payments.count,
    reviews: reviews.count,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
