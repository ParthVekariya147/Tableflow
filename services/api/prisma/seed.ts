/**
 * Seeds the three tenants from the architecture diagram, each with a distinct
 * brand theme, to demonstrate "one codebase, many branded tenants". Amber &
 * Grain also gets a table + menu so the customer app is runnable end-to-end.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // --- Amber & Grain (warm amber) -----------------------------------------
  const amber = await prisma.tenant.upsert({
    where: { slug: "amber-grain" },
    update: {},
    create: {
      slug: "amber-grain",
      name: "Amber & Grain",
      currency: "USD",
      taxRate: 0.1,
      theme: {
        mode: "light",
        colors: {
          primary: "#8c5000",
          "primary-container": "#e8943a",
          "secondary-container": "#fdcf49",
        },
        typography: {
          sans: "Plus Jakarta Sans, sans-serif",
          serif: "Literata, serif",
          fontLinks: [],
        },
      },
    },
  });

  await prisma.table.upsert({
    where: { qrToken: "amber-grain-t7" },
    update: {},
    create: { tenantId: amber.id, label: "7", qrToken: "amber-grain-t7", seats: 4 },
  });

  const amberMenu = [
    { name: "The Morning Ritual Pour", category: "Drinks", price: 650, badge: "Signature", description: "House blend, slow-poured over ice with vanilla and oat milk." },
    { name: "Smashed Avocado Toast", category: "Food", price: 1200, description: "Sourdough, smashed avo, poached egg, chilli flakes, microherbs." },
    { name: "Classic Cortado", category: "Drinks", price: 450, description: "Equal parts espresso and steamed milk." },
    { name: "Loaded Nachos", category: "Food", price: 1400, description: "Tortilla chips, three-cheese blend, jalapeños, pico de gallo." },
    { name: "Almond Croissant", category: "Desserts", price: 550, description: "Buttery, flaky, almond cream, flaked almonds." },
    { name: "Iced Oat Latte", category: "Drinks", price: 600, badge: "Popular", description: "Double shot espresso, oat milk, over ice." },
  ];
  for (const [i, item] of amberMenu.entries()) {
    await prisma.menuItem.create({
      data: { tenantId: amber.id, sortOrder: i, ...item },
    });
  }
  for (const [i, name] of ["Food", "Drinks", "Desserts", "Specials"].entries()) {
    await prisma.menuCategory.upsert({
      where: { tenantId_name: { tenantId: amber.id, name } },
      update: { sortOrder: i },
      create: { tenantId: amber.id, name, sortOrder: i },
    });
  }

  // --- Green Bowl (fresh green) --------------------------------------------
  await prisma.tenant.upsert({
    where: { slug: "green-bowl" },
    update: {},
    create: {
      slug: "green-bowl",
      name: "Green Bowl",
      currency: "USD",
      taxRate: 0.08,
      theme: {
        mode: "light",
        colors: {
          primary: "#1d9e75",
          "primary-container": "#3fc499",
          "secondary-container": "#bdf0d8",
        },
        typography: { sans: "Inter, sans-serif", serif: "Fraunces, serif", fontLinks: [] },
      },
    },
  });

  // --- Bella Pizza (rosso/pink) --------------------------------------------
  await prisma.tenant.upsert({
    where: { slug: "bella-pizza" },
    update: {},
    create: {
      slug: "bella-pizza",
      name: "Bella Pizza",
      currency: "USD",
      taxRate: 0.09,
      theme: {
        mode: "light",
        colors: {
          primary: "#d4537e",
          "primary-container": "#f08aab",
          "secondary-container": "#ffd9e3",
        },
        typography: { sans: "Poppins, sans-serif", serif: "Playfair Display, serif", fontLinks: [] },
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log("Seeded tenants: amber-grain, green-bowl, bella-pizza");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
