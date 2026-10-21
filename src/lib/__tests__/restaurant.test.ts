import { describe, it, expect } from "vitest";
import { STORES, initialScheduleFor } from "../stores";
import { publicHolidays } from "../holidays";
import { resolveDay } from "../workHours";
import { generateSchedule } from "../scheduler";

describe("Lemontaste", () => {
  it("has the owner's 9 employees, 766,39 h and 13.090 € Brutto", () => {
    expect(STORES.map(s => s.id)).toEqual(["lemontaste"]);
    const employees = STORES[0].sampleEmployees();
    expect(employees).toHaveLength(9);
    expect(employees.reduce((a, e) => a + e.targetMinutes, 0)).toBe(43 * 60 * 3 + (120 + 174 + 93 + 86 + 150) * 60 + Math.round(14.39 * 60));
    expect(employees.reduce((a, e) => a + (e.monthlySalary ?? 0), 0)).toBe(13090);
    expect(employees.find(e => e.name === "Nhân viên mới B")?.maxDaysPerWeek).toBe(5);
  });
  it("opens 11:00–21:30 every day including holidays", () => {
    const w = STORES[0].workHours!;
    const h = publicHolidays(2026);
    for (const date of ["2026-10-05", "2026-10-10", "2026-10-11", "2026-12-25"]) {
      expect(resolveDay(w, date, h, {}).blocks).toEqual([{ startMinutes: 660, endMinutes: 1290 }]);
    }
  });
  it("generates shifts within opening hours", () => {
    const store = STORES[0];
    const schedule = initialScheduleFor(store);
    const shifts = generateSchedule({ ...schedule, rules: store.staffingRules, weights: store.dayWeights, storeTag: store.id });
    expect(shifts.length).toBeGreaterThan(0);
    for (const s of shifts) expect(s.startMinutes >= 660 && s.endMinutes <= 1290).toBe(true);
  });
});
