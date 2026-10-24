import { expect, it } from "vitest";
import { initialScheduleFor, STORES } from "../stores";
import { generateSchedule } from "../scheduler";
import { serviceCoverage } from "../serviceCoverage";
import { staffAt } from "../staffing";
import { datesOfMonth } from "../demand";
import { validateSchedule } from "../validation";
import { analyzeSchedule } from "../analyze";
it("uses flexible staff and monthly capacity to reduce actual service gaps", () => {
 const store = STORES[0];
 const base = { ...initialScheduleFor(store), year: 2026, month: 10 };
 const shifts = generateSchedule({ ...base, rules: store.staffingRules, weights: store.dayWeights, demandProfile: store.demandProfile, storeTag: store.id });
 const report = serviceCoverage({ ...base, shifts });
 const byId = new Map(base.employees.map(e => [e.id,e]));
 const peakService: number[] = [], busyPeak: number[] = [], normalPeak: number[] = [];
 for (const date of datesOfMonth(2026,10)) for (let minute = 660; minute < 1290; minute += 30) {
   const present = staffAt(shifts.filter(s => s.date === date),byId,minute);
   if ((minute >= 720 && minute < 840) || (minute >= 1080 && minute < 1200)) {
     const service = present.filter(e => e.station === "SERVICE").length;
     peakService.push(service);
     (new Date(date).getUTCDay() % 6 === 0 ? busyPeak : normalPeak).push(service);
   }
   if (minute < 840 || (minute >= 1020 && minute < 1200)) expect(present.some(e => e.station === "KITCHEN"),`${date} kitchen ${minute}`).toBe(true);
   if (minute < 840 || (minute >= 1020 && minute < 1200)) expect(present.some(e => e.station === "SERVICE"),`${date} preparation/peak ${minute}`).toBe(true);
 }
 // Previous plan put 3 service staff into one lunch peak while equivalent
 // peaks had 1. Surplus now spreads in 1–2 person increments, busy days first.
 expect(Math.max(...peakService)).toBeLessThanOrEqual(2);
 const average = (values: number[]) => values.reduce((a,b) => a+b,0) / values.length;
 expect(average(busyPeak)).toBeGreaterThan(average(normalPeak));
 const analysis = analyzeSchedule({ ...base, shifts, rules: store.staffingRules, weights: store.dayWeights });
 const weekends = analysis.days.filter(day => !day.closed && new Date(day.date).getUTCDay() % 6 === 0);
 // Equivalent busy days share one monthly target; partial weeks cannot drift.
 expect(new Set(weekends.map(day => day.targetHours)).size).toBe(1);
 const weekendHours = weekends.map(day => day.paidHours);
 // Three half-hour slots of tolerance: mandatory core coverage takes priority
 // over exact daily equality when availability differs.
 expect(Math.max(...weekendHours) - Math.min(...weekendHours)).toBeLessThanOrEqual(1.5);
 expect(report.requiredEmptyMinutes).toBe(0);
 expect(validateSchedule(base.employees, shifts, 2026).errors.filter(e => e.severity !== "warning")).toEqual([]);
 expect(shifts.reduce((sum,s) => sum+s.paidMinutes,0)).toBe(base.employees.reduce((sum,e) => sum+Math.floor(e.targetMinutes/30)*30,0));
},120000);
