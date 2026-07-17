// Time real `SELECT 1`s against a Postgres URL (Mumbai cutover step 2).
// Usage: node tools/rtt-probe-db.mjs "postgresql://..."
import { PrismaClient } from "@prisma/client";

const url = process.argv[2];
if (!url) { console.error('usage: node tools/rtt-probe-db.mjs "<postgres-url>"'); process.exit(1); }
const db = new PrismaClient({ datasourceUrl: url });

const t0 = process.hrtime.bigint();
await db.$queryRaw`SELECT 1`;
console.log(`connect + first query: ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)}ms`);
const samples = [];
for (let i = 0; i < 8; i++) {
  const t = process.hrtime.bigint();
  await db.$queryRaw`SELECT 1`;
  samples.push(Number(process.hrtime.bigint() - t) / 1e6);
}
samples.sort((a, b) => a - b);
console.log(`warm SELECT 1 ×8: min ${samples[0].toFixed(0)}ms  median ${samples[4].toFixed(0)}ms  max ${samples[7].toFixed(0)}ms`);
await db.$disconnect();
