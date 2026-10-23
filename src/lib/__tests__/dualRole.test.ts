import { expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { staffAt } from "../staffing";
import { applyMigrations } from "../migrations";
import { initialScheduleFor, STORES } from "../stores";

it("assigns Ngoc Long one role at a time, including another cook's pause", () => {
  const employees: Employee[] = [
    { id: "long", name: "Long", station: "BOTH", employmentType: "TEILZEIT", targetMinutes: 7200 },
    { id: "cook", name: "Cook", station: "KITCHEN", employmentType: "TEILZEIT", targetMinutes: 7200 },
  ];
  const shifts: Shift[] = employees.map(e => ({ id: e.id, employeeId: e.id, date: "2026-10-01",
    startMinutes: 660, endMinutes: 1170, paidMinutes: 480, pauseMinutes: 30,
    pauseStartMinutes: e.id === "cook" ? 900 : 960, shiftType: "EARLY", generated: true }));
  const map = new Map(employees.map(e => [e.id, e]));
  expect(staffAt(shifts, map, 720).map(e => e.station).sort()).toEqual(["KITCHEN", "SERVICE"]);
  expect(staffAt(shifts, map, 900).map(e => e.station)).toEqual(["KITCHEN"]);
  expect(staffAt([shifts[0]], map, 720).map(e => e.station)).toEqual(["KITCHEN"]);
});

it("updates saved Ngoc Long once without overriding subsequent owner edits", () => {
  const schedule = initialScheduleFor(STORES[0]);
  schedule.employees = schedule.employees.map(e => e.id === "lt-ngoc-long" ? { ...e, station: "KITCHEN" } : e);
  const migrated = applyMigrations("lemontaste", schedule);
  expect(migrated.employees.find(e => e.id === "lt-ngoc-long")?.station).toBe("BOTH");
  const edited = { ...migrated, employees: migrated.employees.map(e => ({ ...e, station: "SERVICE" as const })) };
  expect(applyMigrations("lemontaste", edited).employees[0].station).toBe("SERVICE");
});
