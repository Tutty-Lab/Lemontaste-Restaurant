// ============================================================================
// Zuschlagsstunden für die Übersicht auf Seite 1 der PDFs:
//  - Nachtstunden: bezahlte Minuten ab 20:00 (§ 3b EStG, 20–6 Uhr),
//  - Sonntagsstunden: bezahlte Minuten an einem Sonntag.
// Sonntags zählt alles NUR als Sonntag, nicht zusätzlich als Nacht (Vorgabe
// des Betriebs: keine doppelte Zählung).
// Die Pause zählt nicht mit; liegt sie nach 20:00, fällt sie heraus.
// ============================================================================

import type { Shift } from "../types";
import { parseIsoDate, weekdayKeyOf } from "./demand";

/** Beginn der Nachtzeit (20:00). */
export const NIGHT_START = 20 * 60;

/** Bezahlte Minuten dieser Schicht ab 20:00. */
export function nightMinutes(shift: Shift): number {
  const worked = Math.max(0, shift.endMinutes - Math.max(shift.startMinutes, NIGHT_START));
  if (shift.pauseMinutes <= 0 || shift.pauseStartMinutes == null) return worked;
  const pauseEnd = shift.pauseStartMinutes + shift.pauseMinutes;
  const pauseAtNight = Math.max(0, pauseEnd - Math.max(shift.pauseStartMinutes, NIGHT_START));
  return Math.max(0, worked - pauseAtNight);
}

/** Bezahlte Minuten dieser Schicht an einem Sonntag. */
export function sundayMinutes(shift: Shift): number {
  return weekdayKeyOf(parseIsoDate(shift.date)) === "sunday" ? shift.paidMinutes : 0;
}

export type HourStats = { total: number; night: number; sunday: number };

/** Summen (Minuten) einer Person über die angegebenen Tage. */
export function hourStatsFor(shifts: readonly Shift[], employeeId: string, dates: readonly string[]): HourStats {
  const inRange = new Set(dates);
  const stats: HourStats = { total: 0, night: 0, sunday: 0 };
  for (const shift of shifts) {
    if (shift.employeeId !== employeeId || !inRange.has(shift.date)) continue;
    stats.total += shift.paidMinutes;
    const sunday = sundayMinutes(shift);
    stats.sunday += sunday;
    if (sunday === 0) stats.night += nightMinutes(shift);
  }
  return stats;
}
