import type { AppConfig } from './config';
import type { NewsroomDatabase } from './db';

type Store = Pick<NewsroomDatabase, 'getMeta' | 'setMeta' | 'transaction'>;
const DAY_MS = 86_400_000;
const LEDGER_KEY = 'ai_daily_request_budget';

/** Count upstream attempts once, across sessions and server restarts. Only today's ledger is kept. */
export function createAiBudget(store: Store, config: AppConfig['aiUsage']) {
  const read = (userId: string, roleCode: string, now: number) => {
    const day = new Date(now).toISOString().slice(0, 10);
    const limit = Object.hasOwn(config.roleLimits, roleCode) ? config.roleLimits[roleCode] : config.dailyRequests;
    let counts: Record<string, number> = {};
    try {
      const ledger = JSON.parse(store.getMeta(LEDGER_KEY) || 'null');
      if (ledger?.day === day && ledger.counts && typeof ledger.counts === 'object' && !Array.isArray(ledger.counts)) counts = ledger.counts;
    } catch {
      // Legacy or absent metadata starts with a fresh ledger.
    }
    const count = Object.hasOwn(counts, userId) && Number.isSafeInteger(counts[userId]) && counts[userId] >= 0 ? counts[userId] : 0;
    const resetsAt = new Date(Date.parse(day) + DAY_MS).toISOString();
    return { day, counts, count, budget: { limit, remaining: Math.max(0, limit - count), resetsAt } };
  };

  return {
    status: (userId: string, roleCode: string, now = Date.now()) => read(userId, roleCode, now).budget,
    take: (userId: string, roleCode: string, now = Date.now()) => store.transaction(() => {
      const { day, counts, count, budget } = read(userId, roleCode, now);
      if (budget.remaining === 0) return { allowed: false, budget };
      store.setMeta(LEDGER_KEY, JSON.stringify({ day, counts: { ...counts, [userId]: count + 1 } }));
      return { allowed: true, budget: { ...budget, remaining: budget.remaining - 1 } };
    }),
  };
}
