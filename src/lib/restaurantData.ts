import type { Employee } from "../types";
import { makeEmployee } from "./sampleData";

// Lemontaste (chủ quán, 10/2026): giờ/tháng và Brutto theo bảng của chủ.
// Lương giờ = Brutto / giờ, giữ đúng số giờ trong bảng.
function staff(id: string, name: string, hours: number, brutto: number, maxDaysPerWeek?: number): Employee {
  const type = brutto <= 603 ? "MINIJOB" : hours >= 150 ? "VOLLZEIT" : "TEILZEIT";
  return { ...makeEmployee(id, name, type, hours), station: "SERVICE",
    monthlySalary: brutto, hourlyRate: Math.round(brutto / hours * 100) / 100,
    targetMinutes: Math.round(hours * 60), maxDaysPerWeek,
    // Vollzeit theo chủ: 6 giờ/ngày (mềm – nếu không đủ ngày, app tự kéo dài ca).
    shiftHours: type === "VOLLZEIT" ? { min: 6, max: 6 } : undefined };
}
/** Dinh Bien (Minijob): chỉ ca tối giờ đông khách, ưu tiên 18:00–20:00, không bắt đầu 17:00. */
export const DINH_BIEN_SHIFT = { startMinutes: 18 * 60, endMinutes: 21 * 60 + 30 };

/** Vị trí, ngày làm và ghi chú theo bảng nhân sự 10/2026 của chủ quán. */
export const LEMONTASTE_PATCHES: Record<string, Partial<Employee>> = {
  "lt-ngoc-long": { station: "KITCHEN" }, // Bếp, chuẩn bị đồ
  "lt-ngoc-ly-ly": { station: "KITCHEN" }, // Bếp, nước, sơ chế
  "lt-van-diep": { station: "KITCHEN", endDate: "2026-10-31" }, // Bếp, nghỉ cuối T10
  "lt-thi-huong": { station: "KITCHEN", availableWeekdays: ["saturday", "sunday"] }, // Bếp/Bar, cuối tuần
  "lt-van-kien": { station: "KITCHEN" }, // Bếp phụ
  "lt-dinh-bien": {
    station: "SERVICE",
    shiftWindow: DINH_BIEN_SHIFT,
    // Kein „Khung giờ ưu tiên": jede Schicht im Fenster deckt 18:00–20:00 ohnehin ab,
    // sonst meldet die Prüfung jede Schicht bis 21:30 als „ngoài khung".
    preferredWindows: undefined,
  },
  "lt-moi-a": { name: "Thai Hung Nguyen", station: "SERVICE", availableWeekdays: ["friday", "saturday", "sunday"] }, // Bar, T6–CN
  "lt-moi-b": { name: "Tran Dinh Hoang", station: "KITCHEN", maxDaysPerWeek: 5 }, // Bếp, thử việc 8 tháng
};

export function lemontasteEmployees(): Employee[] {
  return [
    staff("lt-ngoc-long", "Ngoc Long Nguyen", 120, 1668),
    staff("lt-ngoc-ly-ly", "Ngoc Ly Ly Nguyen", 174, 4370),
    staff("lt-van-diep", "Van Diep Mai", 93, 1293),
    staff("lt-thi-huong", "Thi Huong Bui", 43, 603),
    staff("lt-van-kien", "Van Kien Nguyen", 86, 1200),
    staff("lt-dinh-bien", "Dinh Bien Nguyen", 43, 603),
    staff("lt-moi-a", "Thai Hung Nguyen", 14.39, 200),
    staff("lt-moi-b", "Tran Dinh Hoang", 150, 2550, 5),
  ].map((e) => ({ ...e, ...LEMONTASTE_PATCHES[e.id] }));
}
