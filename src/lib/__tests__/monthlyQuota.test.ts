import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { initialScheduleFor, STORES } from "../stores";
import { monthlyTargetMinutesFor } from "../contract";
import { datesOfMonth } from "../demand";

describe("full monthly quota within available dates", () => {
  for (const period of [{ startDate: "2026-01-09" }, { endDate: "2026-01-09" }, { startDate: "2026-01-09", endDate: "2026-01-31" }, { unavailableRanges: [{ startDate: "2026-01-01", endDate: "2026-01-08" }] }, { unavailableRanges: [{ startDate: "2026-01-09", endDate: "2026-02-09" }] }]) {
    it(JSON.stringify(period), () => {
      const base = initialScheduleFor(STORES[0]);
      const employee = { id: "monthly", name: "Monthly", employmentType: "MINIJOB" as const, station: "SERVICE" as const, targetMinutes: 43 * 60, ...period };
      expect(monthlyTargetMinutesFor(employee, datesOfMonth(2026, 1))).toBe(2580);
      const shifts = generateSchedule({ ...base, year: 2026, month: 1, employees: [employee] });
      expect(shifts.reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(2580);
      expect(shifts.every(s => (!employee.startDate || s.date >= employee.startDate) && (!employee.endDate || s.date <= employee.endDate))).toBe(true);
      expect(shifts.every(s => !employee.unavailableRanges?.some(r => s.date >= r.startDate && s.date <= r.endDate))).toBe(true);
      expect(new Set(shifts.map(s => s.date)).size).toBe(shifts.length);
    });
  }
});
