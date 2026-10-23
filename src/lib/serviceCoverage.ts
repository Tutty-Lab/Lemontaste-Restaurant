import type { Schedule } from "../types";
import { datesOfMonth } from "./demand";
import { publicHolidays } from "./holidays";
import { resolveDay } from "./workHours";
import { coveragePoints, staffAt } from "./staffing";
import { monthlyTargetMinutesFor } from "./contract";
import { mayWorkOn } from "./availability";

export function serviceCoverage(schedule: Schedule) {
  const holidays = publicHolidays(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map(o => [o.date, o]));
  const days = datesOfMonth(schedule.year, schedule.month).map(date => ({ date,
    ...resolveDay(schedule.workHours, date, holidays, overrides) })).filter(day => !day.closed);
  const employees = schedule.employees.filter(e => e.station !== "KITCHEN");
  let openMinutes = 0, emptyMinutes = 0, overlapMinutes = 0;
  const gaps: { date: string; start: number; end: number; unavailable: boolean }[] = [];
  for (const day of days) for (const block of day.blocks) {
    const onDay = schedule.shifts.filter(s => s.date === day.date);
    const points = [...new Set([...coveragePoints(onDay, block.startMinutes, block.endMinutes),
      ...employees.flatMap(e => [e.shiftWindow?.startMinutes, e.shiftWindow?.endMinutes,
        e.fixedShift?.startMinutes, e.fixedShift?.endMinutes]).filter((t): t is number =>
          t != null && t > block.startMinutes && t < block.endMinutes)])].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i], end = points[i + 1], duration = end - start;
      const count = staffAt(onDay, new Map(schedule.employees.map(e => [e.id, e])), start).filter(e => e.station !== "KITCHEN").length;
      openMinutes += duration;
      overlapMinutes += Math.max(0, count - 1) * duration;
      if (count) continue;
      emptyMinutes += duration;
      const unavailable = !employees.some(e => {
        const w = e.fixedShift ?? e.shiftWindow;
        return mayWorkOn(e, day.date) && (!w || (w.startMinutes <= start && w.endMinutes >= end));
      });
      const last = gaps[gaps.length - 1];
      if (last?.date === day.date && last.end === start && last.unavailable === unavailable) last.end = end;
      else gaps.push({ date: day.date, start, end, unavailable });
    }
  }
  const budgetMinutes = employees.reduce((sum, e) => sum + monthlyTargetMinutesFor(e, days.map(d => d.date), schedule.workHours), 0);
  return { openMinutes, emptyMinutes, overlapMinutes, budgetMinutes,
    budgetLowerBound: Math.max(0, openMinutes - budgetMinutes), gaps };
}
