import { expect, it } from "vitest";
import { initialScheduleFor, STORES } from "../stores";
import { generateSchedule } from "../scheduler";
import { serviceCoverage } from "../serviceCoverage";
import { staffAt } from "../staffing";
import { datesOfMonth } from "../demand";
import { validateSchedule } from "../validation";
it("uses flexible staff and monthly capacity to reduce actual service gaps", () => {
 const store = STORES[0];
 const base = { ...initialScheduleFor(store), year: 2026, month: 10 };
 const shifts = generateSchedule({ ...base, rules: store.staffingRules, weights: store.dayWeights, demandProfile: store.demandProfile, storeTag: store.id });
 const report = serviceCoverage({ ...base, shifts });
 console.log("Dual-role October", JSON.stringify(report));

 const byId = new Map(base.employees.map(e => [e.id,e]));
 for (const date of datesOfMonth(2026,10)) for (let minute = 660; minute < 1290; minute += 30) {
   const present = staffAt(shifts.filter(s => s.date === date),byId,minute);
   expect(present.some(e => e.station === "KITCHEN"),`${date} kitchen ${minute}`).toBe(true);
   if (minute < 840 || (minute >= 1020 && minute < 1200)) expect(present.some(e => e.station === "SERVICE"),`${date} preparation/peak ${minute}`).toBe(true);
 }
 expect(report.emptyMinutes).toBeLessThanOrEqual(2.5 * 60);
 expect(validateSchedule(base.employees, shifts, 2026).errors.filter(e => e.severity !== "warning")).toEqual([]);
 expect(shifts.reduce((sum,s) => sum+s.paidMinutes,0)).toBe(base.employees.reduce((sum,e) => sum+Math.floor(e.targetMinutes/30)*30,0));
},120000);
