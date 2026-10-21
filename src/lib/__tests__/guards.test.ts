// ============================================================================
// Unterbesetzung muss sichtbar werden statt still zu passieren – egal ob sie
// vom Scheduler kommt oder von einer Änderung im Plan von Hand.
//
// Shin: offen 11:30–15:00 und 17:00–22:00, abends (18:00–21:00) sollen 4–7
// Leute da sein, mittags (12:00–14:00) 3–7, und bis 15:00 bzw. 22:00 bleibt
// immer mindestens eine Person.
// ============================================================================

import { describe, expect, it } from "vitest";
import { analyzeSchedule } from "../analyze";
import { DEFAULT_WORK_HOURS } from "../workHours";
import type { Employee, Shift } from "../../types";

const emp = (id: string): Employee => ({
  id,
  name: id,
  employmentType: "TEILZEIT",
  targetMinutes: 60 * 60,
});

/** Abenddienst 17:00–22:00 (5 h bezahlt, keine Pause nötig). */
const abend = (id: string, date = "2026-08-01"): Shift => ({
  id: `shift-${id}`,
  employeeId: id,
  date,
  startMinutes: 17 * 60,
  endMinutes: 22 * 60,
  pauseMinutes: 0,
  paidMinutes: 5 * 60,
  shiftType: "LATE",
  generated: true,
});

const analyse = (employees: Employee[], shifts: Shift[], month = 8) =>
  analyzeSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees, shifts });

describe("Zu wenige Leute in der Stoßzeit", () => {
  // 2026-08-01 ist ein Samstag – ein starker Tag, und hier steht nur EINE
  // Person im Abendblock.
  const analysis = analyse([emp("a")], [abend("a")]);

  it("meldet den unterbesetzten Tag, statt ihn zu verschweigen", () => {
    const tag = analysis.peakViolations.find((d) => d.date === "2026-08-01");
    expect(tag).toBeDefined();
    expect(tag!.peaks.some((p) => !p.ok)).toBe(true);
  });

  it("nennt die tatsächliche Personenzahl und die geforderte", () => {
    const evening = analysis.peakViolations
      .find((d) => d.date === "2026-08-01")!
      .peaks.find((p) => p.label === "Tối" && !p.ok)!;
    expect(evening.minStaff).toBe(1); // so viele stehen wirklich da
    expect(evening.required).toBe(4); // Vorgabe: „1 ca khoảng 4-5 người"
  });

  it("meldet einen leeren Mittagsblock – niemand bis 15:00", () => {
    const day = analysis.days.find((d) => d.date === "2026-08-01")!;
    const lunchEnd = day.peaks.find((p) => p.label === "Chốt ca trưa")!;
    expect(lunchEnd.minStaff).toBe(0);
    expect(lunchEnd.ok).toBe(false);
  });

  it("akzeptiert vier Leute im Abendblock", () => {
    const ids = ["a", "b", "c", "d"];
    const report = analyse(ids.map(emp), ids.map((id) => abend(id)));
    const day = report.days.find((d) => d.date === "2026-08-01")!;
    expect(day.peaks.find((p) => p.label === "Tối")?.ok).toBe(true);
    expect(day.peaks.find((p) => p.label === "Đóng cửa")?.ok).toBe(true);
  });

  it("zählt eine konkrete Pause als abwesend", () => {
    const ids = ["a", "b", "c", "d"];
    const report = analyse(
      ids.map(emp),
      ids.map((id, index) =>
        index === 0
          ? // 17:00–22:00 mit 30 min Pause ab 18:30: bezahlte Zeit 4,5 h.
            { ...abend(id), pauseMinutes: 30, paidMinutes: 4 * 60 + 30, pauseStartMinutes: 18 * 60 + 30 }
          : abend(id),
      ),
    );
    const evening = report.days.find((d) => d.date === "2026-08-01")!
      .peaks.find((p) => p.label === "Tối")!;
    expect(evening.minStaff).toBe(3); // während der Pause fehlt eine Person
    expect(evening.ok).toBe(false);
  });

  it("prüft auch den Mittagsblock ab 11:30", () => {
    // Nur ein Dienst 12:00–14:00: mittags zu wenige, und um 14:45 niemand mehr.
    const report = analyse(
      [emp("a")],
      [
        {
          ...abend("a", "2026-09-01"),
          startMinutes: 12 * 60,
          endMinutes: 14 * 60,
          paidMinutes: 2 * 60,
          shiftType: "EARLY",
        },
      ],
      9,
    );
    const day = report.days.find((d) => d.date === "2026-09-01")!;
    expect(day.peaks.find((p) => p.label === "Trưa")?.required).toBe(3);
    expect(day.peaks.find((p) => p.label === "Chốt ca trưa")?.minStaff).toBe(0);
    expect(day.peaks.find((p) => p.label === "Đóng cửa")?.minStaff).toBe(0);
  });
});
