export type BalanceSlot = { date: string; minute: number; duration: number; weight: number; peak: boolean };
export type BalanceTarget = { service: number; kitchen: number; weight: number };

/** Reserve one person per station throughout opening hours. Distribute surplus
 * station-hours across every peak using one monthly denominator, not weekly
 * budgets. Identical demand gets identical targets; busy days get more surplus.
 * Fractional targets express fairness without inventing mandatory headcounts. */
export function peakBalanceTargets(slots: BalanceSlot[], capacity: { service: number; kitchen: number; flexible: number }) {
  const open = slots.reduce((sum, s) => sum + s.duration, 0);
  const peakWeight = slots.reduce((sum, s) => sum + (s.peak ? s.duration * s.weight : 0), 0);
  const flexibleKitchen = Math.min(capacity.flexible, Math.max(0, open - capacity.kitchen));
  const surplusService = Math.max(0, capacity.service + capacity.flexible - flexibleKitchen - open);
  const surplusKitchen = Math.max(0, capacity.kitchen + flexibleKitchen - open);
  const targets = new Map<string, Map<number, BalanceTarget>>();
  for (const s of slots) {
    const share = s.peak && peakWeight > 0 ? s.weight / peakWeight : 0;
    const day = targets.get(s.date) ?? new Map<number, BalanceTarget>();
    day.set(s.minute, { service: 1 + surplusService * share, kitchen: 1 + surplusKitchen * share, weight: s.weight });
    targets.set(s.date, day);
  }
  return targets;
}
