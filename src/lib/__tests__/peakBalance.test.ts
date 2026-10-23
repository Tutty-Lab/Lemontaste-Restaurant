import { expect, it } from "vitest";
import { peakBalanceTargets, type BalanceSlot } from "../peakBalance";

it("shares surplus across equivalent peaks and increases busy-day targets without double-counting flexible staff", () => {
  const slots: BalanceSlot[] = [
    { date: "2026-10-01", minute: 660, duration: 60, weight: 1, peak: false },
    { date: "2026-10-01", minute: 720, duration: 60, weight: 1, peak: true },
    { date: "2026-10-02", minute: 720, duration: 60, weight: 1, peak: true },
    { date: "2026-10-03", minute: 720, duration: 60, weight: 1.5, peak: true },
  ];
  const targets = peakBalanceTargets(slots, { service: 240, kitchen: 180, flexible: 180 });
  const normal = targets.get("2026-10-01")!.get(720)!;
  expect(targets.get("2026-10-02")!.get(720)).toEqual(normal);
  expect(targets.get("2026-10-01")!.get(660)!.service).toBe(1);
  expect(targets.get("2026-10-03")!.get(720)!.service - 1).toBeCloseTo((normal.service - 1) * 1.5);
  let service = 0, kitchen = 0;
  for (const s of slots) {
    const t = targets.get(s.date)!.get(s.minute)!;
    service += t.service * s.duration;
    kitchen += t.kitchen * s.duration;
  }
  expect(service).toBeCloseTo(360);
  expect(kitchen).toBeCloseTo(240);
});

it("keeps the coverage baseline when budgets are insufficient or no peaks exist", () => {
  const slots = [{ date: "2026-10-01", minute: 660, duration: 30, weight: 1, peak: false }];
  expect(peakBalanceTargets(slots, { service: 0, kitchen: 0, flexible: 0 }).get(slots[0].date)!.get(660))
    .toEqual({ service: 1, kitchen: 1, weight: 1 });
  expect(peakBalanceTargets([], { service: 60, kitchen: 60, flexible: 0 }).size).toBe(0);
});
