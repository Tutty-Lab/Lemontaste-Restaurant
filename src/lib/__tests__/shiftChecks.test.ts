import { describe, it, expect } from "vitest";
import { STORES, initialScheduleFor } from "../stores";
import { checkShifts } from "../shiftChecks";
import type { Shift } from "../../types";

const shift = (employeeId: string, date: string, start: number, end: number, pause = 0): Shift =>
  ({ id: `${employeeId}-${date}`, employeeId, date, startMinutes: start * 60, endMinutes: end * 60,
    pauseMinutes: pause, paidMinutes: (end - start) * 60 - pause } as Shift);

describe("checkShifts", () => {
  const base = { ...initialScheduleFor(STORES[0]), month: 10 };
  it("flags weekday, shift window and pause violations", () => {
    const issues = checkShifts({ ...base, shifts: [
      shift("lt-moi-a", "2026-10-05", 12, 15),          // Thai Hung: chỉ T6–CN
      shift("lt-dinh-bien", "2026-10-06", 17, 20),      // ngoài khung 18:00–21:30
      shift("lt-van-kien", "2026-10-07", 11, 19),       // 8 h, không Pause
      shift("lt-ngoc-long", "2026-10-07", 14, 21.5, 30),
    ] });
    expect(issues.get("lt-moi-a#2026-10-05")?.[0].text).toMatch(/Không làm/);
    expect(issues.get("lt-dinh-bien#2026-10-06")?.[0].text).toMatch(/Ngoài khung ca/);
    expect(issues.get("lt-van-kien#2026-10-07")?.[0].text).toMatch(/Thiếu Pause/);
    expect(issues.has("lt-ngoc-long#2026-10-07")).toBe(false);
  });
  it("flags Vollzeit shift length as soft", () => {
    const issues = checkShifts({ ...base, shifts: [shift("lt-ngoc-ly-ly", "2026-10-05", 11, 14)] });
    expect(issues.get("lt-ngoc-ly-ly#2026-10-05")).toEqual([{ hard: false, text: "Ca 3 h, quy định 6 h/ngày" }]);
  });
});
