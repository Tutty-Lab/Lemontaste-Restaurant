import { describe, it, expect } from "vitest";
import { STORES, initialScheduleFor } from "../stores";
import { publicHolidays } from "../holidays";
import { resolveDay } from "../workHours";
import { generateSchedule } from "../scheduler";

describe("Lemontaste", () => {
  it("has the owner's 8 employees for 10/2026: 723,39 h and 12.487 € Brutto", () => {
    expect(STORES.map(s => s.id)).toEqual(["lemontaste"]);
    const employees = STORES[0].sampleEmployees();
    expect(employees).toHaveLength(8);
    expect(employees.reduce((a, e) => a + e.targetMinutes, 0)).toBe((120 + 174 + 93 + 43 + 86 + 43 + 150) * 60 + Math.round(14.39 * 60));
    expect(employees.reduce((a, e) => a + (e.monthlySalary ?? 0), 0)).toBe(12487);
    expect(employees.find(e => e.name === "Tran Dinh Hoang")?.maxDaysPerWeek).toBe(5);
    expect(employees.some(e => e.name === "Duc Thanh Nguyen")).toBe(false);
  });
  it("Dinh Bien only works the evening peak, never from 17:00", () => {
    const store = STORES[0];
    const schedule = initialScheduleFor(store);
    const shifts = generateSchedule({ ...schedule, rules: store.staffingRules, weights: store.dayWeights, storeTag: store.id });
    const bien = shifts.filter(s => s.employeeId === "lt-dinh-bien");
    expect(bien.length).toBeGreaterThan(0);
    for (const s of bien) expect(s.startMinutes >= 18 * 60 && s.endMinutes <= 21 * 60 + 30).toBe(true);
    expect(bien.reduce((a, s) => a + s.paidMinutes, 0)).toBeGreaterThanOrEqual(42 * 60);
    for (const s of shifts.filter(s => s.employeeId === "lt-van-diep")) expect(s.date <= "2026-10-31").toBe(true);
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
