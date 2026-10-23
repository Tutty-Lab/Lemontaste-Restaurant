// ============================================================================
// Prüft JEDE Schicht gegen die Regeln der Person und des Ladens – unabhängig
// davon, was der Planer selbst meldet. Das Raster umrandet jede Zelle mit
// einem Treffer (rot = harte Regel, gelb = weiche Regel), der Grund steht im
// Tooltip. So sieht der Betrieb selbst, wo etwas nicht passt.
// ============================================================================

import type { Employee, Schedule, Shift } from "../types";
import { worksOnWeekday, isEmployedOn } from "./availability";
import { parseIsoDate, weekdayKeyOf, WEEKDAY_LABELS_VI } from "./demand";
import { publicHolidays } from "./holidays";
import { calculatePause, minutesToTime } from "./time";
import { weekStartOf } from "./weeks";
import { resolveDay } from "./workHours";

export type ShiftIssue = { hard: boolean; text: string };

const MIN_REST = 11 * 60; // ArbZG § 5: 11 h Ruhezeit
const MAX_PAID = 10 * 60; // ArbZG § 3: höchstens 10 h am Tag

const span = (a: number, b: number) => `${minutesToTime(a)}–${minutesToTime(b)}`;
const hours = (m: number) => `${(m / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 })} h`;

/** Alle Treffer je „employeeId#date". Leere Tage fehlen in der Map. */
export function checkShifts(schedule: Schedule): Map<string, ShiftIssue[]> {
  const out = new Map<string, ShiftIssue[]>();
  const add = (emp: Employee, date: string, issue: ShiftIssue) => {
    const key = `${emp.id}#${date}`;
    const list = out.get(key) ?? [];
    if (!list.some((i) => i.text === issue.text)) list.push(issue);
    out.set(key, list);
  };
  const holidays = publicHolidays(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));

  for (const emp of schedule.employees) {
    const mine = schedule.shifts
      .filter((s) => s.employeeId === emp.id)
      .sort((a, b) => (a.date === b.date ? a.startMinutes - b.startMinutes : a.date < b.date ? -1 : 1));
    const byDate = new Map<string, Shift[]>();
    for (const s of mine) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

    for (const [date, list] of byDate) {
      const wd = weekdayKeyOf(parseIsoDate(date));
      if (!worksOnWeekday(emp, date)) add(emp, date, { hard: true, text: `Không làm ${WEEKDAY_LABELS_VI[wd]}` });
      if (!isEmployedOn(emp, date)) add(emp, date, { hard: true, text: "Ngoài thời gian hợp đồng" });

      if (emp.unavailableRanges?.some(range => date >= range.startDate && date <= range.endDate)) add(emp, date, { hard: true, text: "Trong khoảng nghỉ đã đăng ký" });
      const day = resolveDay(schedule.workHours, date, holidays, overrides);
      const paid = list.reduce((a, s) => a + s.paidMinutes, 0);
      for (const s of list) {
        if (day.closed) add(emp, date, { hard: true, text: "Quán đóng cửa hôm nay" });
        else if (!day.blocks.some((b) => s.startMinutes >= b.startMinutes && s.endMinutes <= b.endMinutes)) {
          add(emp, date, { hard: true, text: `Ngoài giờ mở cửa (${span(s.startMinutes, s.endMinutes)})` });
        }
        const w = emp.shiftWindow ?? emp.fixedShift;
        if (w && (s.startMinutes < w.startMinutes || s.endMinutes > w.endMinutes)) {
          add(emp, date, { hard: true, text: `Ngoài khung ca ${span(w.startMinutes, w.endMinutes)}` });
        }
      }
      if (paid > MAX_PAID) add(emp, date, { hard: true, text: `Quá 10 h/ngày (${hours(paid)})` });
      const pause = list.reduce((a, s) => a + s.pauseMinutes, 0);
      if (pause < calculatePause(paid)) {
        add(emp, date, { hard: true, text: `Thiếu Pause: ${pause} phút, cần ${calculatePause(paid)} phút` });
      }
      const h = emp.shiftHours;
      if (h && (paid < h.min * 60 || paid > h.max * 60)) {
        const want = h.min === h.max ? `${h.min} h` : `${h.min}–${h.max} h`;
        add(emp, date, { hard: false, text: `Ca ${hours(paid)}, quy định ${want}/ngày` });
      }
    }

    // Ruhezeit zwischen zwei Arbeitstagen.
    for (let i = 1; i < mine.length; i++) {
      const prev = mine[i - 1], cur = mine[i];
      if (prev.date === cur.date) continue;
      const gapDays = (parseIsoDate(cur.date).getTime() - parseIsoDate(prev.date).getTime()) / 86_400_000;
      const rest = gapDays * 1440 - prev.endMinutes + cur.startMinutes;
      if (rest < MIN_REST) {
        add(emp, cur.date, { hard: true, text: `Nghỉ giữa 2 ca chỉ ${(rest / 60).toFixed(1).replace(".", ",")} h (cần 11 h)` });
      }
    }

    // Tage je Woche: gesetzlich höchstens 6, dazu „tối đa … ngày/tuần".
    const weeks = new Map<string, string[]>();
    for (const d of byDate.keys()) weeks.set(weekStartOf(d), [...(weeks.get(weekStartOf(d)) ?? []), d]);
    for (const days of weeks.values()) {
      const limit = Math.min(6, emp.maxDaysPerWeek ?? 6);
      if (days.length > limit) {
        for (const d of days) add(emp, d, { hard: true, text: `${days.length} ngày/tuần, tối đa ${limit}` });
      }
    }
  }
  return out;
}
