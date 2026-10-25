import { expect, it } from "vitest";
import { restaurantOwner } from "../restaurantData";
import { initialScheduleFor, STORES } from "../stores";
import { applyMigrations } from "../migrations";
import { staffAt } from "../staffing";
import { generateSchedule } from "../scheduler";
import { staffingDiagnostics } from "../staffingDiagnostics";
import { validateSchedule } from "../validation";
import { draftFrom, draftToEmployee } from "../../components/EmployeesTab";
import { datesOfMonth } from "../demand";
import { busyKitchenTarget } from "../coveragePolicy";

it("migrates stored rosters once without changing contracts", () => {
  const base = initialScheduleFor(STORES[0]);
  const old = { ...base, employees: base.employees.filter(e => !e.ownerSupport) };
  const next = applyMigrations("lemontaste", old);
  expect(next.employees.filter(e => e.ownerSupport)).toHaveLength(1);
  expect(next.employees.filter(e => !e.ownerSupport).map(e => e.targetMinutes)).toEqual(old.employees.map(e => e.targetMinutes));
  expect(applyMigrations("lemontaste", next)).toEqual(next);
  expect(draftToEmployee(draftFrom(restaurantOwner())).ownerSupport).toBe(true);
  expect(draftToEmployee({ ...draftFrom(restaurantOwner()), hours: "200" }).targetMinutes).toBe(0);
});

it("counts the owner once, switching to the unoccupied station", () => {
  const owner = restaurantOwner();
  const cook = { ...owner, id: "cook", ownerSupport: undefined, station: "KITCHEN" as const };
  const employees = new Map([owner, cook].map(e => [e.id, e]));
  const shift = { id: "s", employeeId: cook.id, date: "2026-01-01", startMinutes: 660, endMinutes: 840,
    paidMinutes: 180, pauseMinutes: 0, generated: true, shiftType: "EARLY" as const };
  expect(staffAt([], employees, 660).map(e => e.station)).toEqual(["KITCHEN"]);
  expect(staffAt([shift], employees, 660).map(e => e.station).sort()).toEqual(["KITCHEN", "SERVICE"]);
});

it.each(Array.from({length:12},(_,i)=>i+1))("month %i uses owner support without paid shifts or contract hours", (month) => {
  const store = STORES[0], base = { ...initialScheduleFor(store), year: 2026, month };
  const shifts = generateSchedule({ ...base, rules: store.staffingRules, weights: store.dayWeights,
    demandProfile: store.demandProfile, storeTag: store.id });
  expect(shifts.some(s => s.employeeId === "lt-owner")).toBe(false);
  const report = staffingDiagnostics({ ...base, shifts });
  expect(report.budget).toBe((month <= 10 ? 723 : 630) * 60);
  expect(report.requiredServiceGap).toBe(0);
  expect(report.requiredKitchenGap).toBe(0);
  const byId = new Map(base.employees.map(e => [e.id, e]));
  let busyKitchenMissing = 0, openingSurplus = 0;
  for (const date of datesOfMonth(2026, month)) for (let minute=660; minute<1200; minute+=30) {
    const present=staffAt(shifts.filter(s=>s.date===date),byId,minute);
    if (busyKitchenTarget(date,minute)===2) busyKitchenMissing+=Math.max(0,2-present.filter(e=>e.station==="KITCHEN").length)*30;
    if (minute<720) openingSurplus+=Math.max(0,present.filter(e=>e.station==="SERVICE").length-1)*30;
  }
  console.log({month,busyKitchenMissingHours:busyKitchenMissing/60,openingServiceSurplusHours:openingSurplus/60});
  expect(busyKitchenMissing).toBe(0);
  expect(openingSurplus).toBe(0);
  expect(report.employees.every(e => e.unassigned === 0)).toBe(true);
  expect(validateSchedule(base.employees, shifts, 2026).errors.filter(e => e.severity !== "warning")).toEqual([]);
}, 60000);
