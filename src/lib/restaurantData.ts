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
export function lemontasteEmployees(): Employee[] {
  return [
    staff("lt-duc-thanh", "Duc Thanh Nguyen", 43, 603),
    staff("lt-ngoc-long", "Ngoc Long Nguyen", 120, 1668),
    staff("lt-ngoc-ly-ly", "Ngoc Ly Ly Nguyen", 174, 4370),
    staff("lt-van-diep", "Van Diep Mai", 93, 1293),
    staff("lt-thi-huong", "Thi Huong Bui", 43, 603),
    staff("lt-van-kien", "Van Kien Nguyen", 86, 1200),
    staff("lt-dinh-bien", "Dinh Bien Nguyen", 43, 603),
    staff("lt-moi-a", "Nhân viên mới A", 14.39, 200),
    staff("lt-moi-b", "Nhân viên mới B", 150, 2550, 5),
  ];
}
