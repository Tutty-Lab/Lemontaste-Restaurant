import { isRequiredCoverage } from "../coveragePolicy";
import { describe, expect, it } from "vitest";
import { STORES, initialScheduleFor } from "../stores";
import { generateSchedule } from "../scheduler";
import { datesOfMonth } from "../demand";
import { publicHolidays } from "../holidays";
import { resolveDay } from "../workHours";
import { workingAt, staffAt } from "../staffing";
import { staffingWindows, clip } from "../staffing";
import { serviceCoverage } from "../serviceCoverage";
import { validateSchedule } from "../validation";

describe("Lemontaste preparation and service coverage", () => {
  it("reduces preparation and all-day gaps without sacrificing peak or kitchen coverage", () => {
    const store = STORES[0];
    const base = initialScheduleFor(store);
    // Preserve the original single-role regression fixture; dual-role behavior
    // is checked separately, since it adds 120 h of service-capable capacity.
    const schedule = { ...base, year: 2026, month: 10, employees: base.employees.map(e =>
      e.id === "lt-ngoc-long" ? { ...e, station: "KITCHEN" as const } : e) };
    const shifts = generateSchedule({ ...schedule, rules: store.staffingRules,
      weights: store.dayWeights, demandProfile: store.demandProfile, storeTag: store.id });
    let gaps = 0, preparation = 0, peaks = 0, overlap = 0, kitchen = 0, requiredKitchen = 0;
    for (const date of datesOfMonth(2026, 10)) {
      const day = resolveDay(schedule.workHours, date, publicHolidays(2026), {});
      if (day.closed) continue;
      for (const block of day.blocks) for (let t = block.startMinutes; t < block.endMinutes; t += 30) {
        const present = shifts.filter(s => s.date === date && workingAt(s, t));
        const assigned = staffAt(present, new Map(schedule.employees.map(e => [e.id, e])), t);
        const count = assigned.filter(e => e.station !== "KITCHEN").length;
        if (!count) {
          gaps += .5;
          if (t < 720 || (t >= 1020 && t < 1080)) preparation += .5;
          if ((t >= 720 && t < 840) || (t >= 1080 && t < 1200)) peaks += .5;
        }
        overlap += Math.max(0, count - 1) * .5;
        if (!assigned.some(e => e.station === "KITCHEN")) { kitchen += .5; if(isRequiredCoverage(t)) requiredKitchen += .5; }
      }
    }
    console.log({ gaps, preparation, peaks, overlap, kitchen });
    expect(preparation).toBe(0);
    expect(gaps).toBeLessThan(59.5);
    expect(overlap).toBeLessThan(7);
    for (const employee of schedule.employees) {
      const own = shifts.filter(s => s.employeeId === employee.id);
      expect(own.reduce((n, s) => n + s.paidMinutes, 0)).toBeLessThanOrEqual(employee.targetMinutes);
      expect(new Set(own.map(s => s.date)).size).toBe(own.length);
    }
    expect(peaks).toBe(0);
    expect(requiredKitchen).toBe(0);
    expect(shifts.reduce((n, s) => n + s.paidMinutes, 0)).toBe(schedule.employees.reduce((sum, e) => sum + Math.floor(e.targetMinutes / 30) * 30, 0));
    expect(validateSchedule(schedule.employees, shifts, 2026).errors.filter(e => e.severity !== "warning")).toEqual([]);
  }, 120_000);

  it("requires continuous core windows for both roles, clips to actual opening times", () => {
    const windows = staffingWindows([{ startMinutes: 690, endMinutes: 1050 }], "monday", STORES[0].staffingRules);
    expect(windows.filter(w => w.priority === "required").map(w => [w.startMinutes, w.endMinutes])).toEqual([[690, 840], [1020, 1050], [690, 840], [1020, 1050]]);
    expect(staffingWindows([], "monday", STORES[0].staffingRules)).toEqual([]);
  });

  it("keeps required coverage ahead of arbitrarily expensive soft preferences and does not cache old rules", () => {
    const base = { ...initialScheduleFor(STORES[0]), year: 2026, month: 10 };
    const employee = { ...base.employees[0], id: "only", targetMinutes: 180,
      shiftHours: undefined, preferredWindows: [{ days: ["thursday" as const], startMinutes: 1080, endMinutes: 1260 }] };
    const overrides = Object.fromEntries(datesOfMonth(2026, 10).filter(d => d !== "2026-10-01").map(d => [d, { date: d, closed: true }]));
    const plan = (from: number) => generateSchedule({ ...base, overrides, employees: [employee], storeTag: "same-rules-cache",
      rules: [{ label: "required", when: "", scaled: false, minStaff: 1, maxStaff: Infinity, priority: "required", windows: clip(from, from + 180) },
        { label: "expensive preference", when: "", scaled: false, minStaff: 1, maxStaff: Infinity, weight: 1e9, windows: clip(1080, 1260) }] });
    expect(plan(660)[0].startMinutes).toBe(660);
    expect(plan(720)[0].startMinutes).toBe(720);
  });

  it("counts pauses and closed days, distinguishes a budget bound from actual gaps", () => {
    const base = { ...initialScheduleFor(STORES[0]), year: 2026, month: 10 };
    const e = { ...base.employees[0], station: "SERVICE" as const, targetMinutes: 480 };
    const dateOverrides = datesOfMonth(2026, 10).filter(d => d !== "2026-10-01").map(date => ({ date, closed: true }));
    const report = serviceCoverage({ ...base, employees: [e], dateOverrides, shifts: [{
      id: "s", employeeId: e.id, date: "2026-10-01", startMinutes: 660, endMinutes: 1170,
      paidMinutes: 480, pauseMinutes: 30, pauseStartMinutes: 900, shiftType: "EARLY", generated: true }] });
    expect(report.openMinutes).toBe(630);
    expect(report.emptyMinutes).toBe(150);
    expect(report.budgetLowerBound).toBe(150);
    expect(report.requiredEmptyMinutes).toBe(30);
    expect(report.gaps.map(g => [g.start, g.end, g.required])).toEqual([[900, 930, false], [1170, 1200, true], [1200, 1290, false]]);
  });
});
