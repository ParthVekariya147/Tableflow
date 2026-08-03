import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request accumulator: how many Prisma queries ran and their total duration. */
interface TimingStore {
  queries: number;
  prismaMs: number;
}

const als = new AsyncLocalStorage<TimingStore>();

/** Run `fn` with a fresh per-request timing accumulator active for its whole async chain. */
export function runWithTiming<T>(fn: () => T): T {
  return als.run({ queries: 0, prismaMs: 0 }, fn);
}

/** Called from PrismaService's query event — a no-op outside an active request context. */
export function recordPrismaQuery(durationMs: number): void {
  const store = als.getStore();
  if (store) {
    store.queries += 1;
    store.prismaMs += durationMs;
  }
}

export function currentTiming(): TimingStore | undefined {
  return als.getStore();
}
