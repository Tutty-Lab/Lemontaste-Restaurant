// ============================================================================
// Einmalige Datenänderungen am GESPEICHERTEN Stand (LocalStorage und Supabase).
//
// Die Startbelegschaft in sampleData.ts greift nur beim allerersten Öffnen.
// Kommt später jemand dazu, muss das hier nachgetragen werden – sonst sieht der
// Betrieb die Person nie. Jede Änderung läuft genau EINMAL je Filiale (Merker in
// schedule.migrations); löscht der Betrieb die Person danach wieder, wird sie
// nicht erneut angelegt.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { demoEmployees, makeEmployee } from "./sampleData";
import { LEMONTASTE_PATCHES } from "./restaurantData";

/** Thu Vân Nguyễn: Vollzeit im Coco, ab September 2026 zusätzlich Minijob 43 h im Nieu. */
export const MIGRATION_THU_VAN_NIEU = "2026-10-thu-van-nieu";
const THU_VAN_KEY = "nguyen-thu-van";

/** Name ohne Akzente, Reihenfolge egal: „Nguyễn Thu Vân" = „Thu Van Nguyen". */
function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

const isThuVan = (employee: Employee) =>
  employee.personKey === THU_VAN_KEY || nameKey(employee.name) === nameKey("Nguyen Thu Van");

function thuVanNieu(storeId: string, employees: Employee[]): Employee[] {
  if (storeId === "coco") {
    // Vorhandene Person im Coco verknüpfen und auf 5 Tage je Woche begrenzen,
    // damit im Nieu Tage frei bleiben (wie Bá Việt im Shin).
    return employees.map((employee) =>
      isThuVan(employee)
        ? { ...employee, personKey: THU_VAN_KEY, maxDaysPerWeek: employee.maxDaysPerWeek ?? 5 }
        : employee,
    );
  }
  if (storeId === "nieu") {
    if (employees.some(isThuVan)) {
      return employees.map((employee) => (isThuVan(employee) ? { ...employee, personKey: THU_VAN_KEY } : employee));
    }
    const id = employees.some((employee) => employee.id === "nieu-7") ? "nieu-thu-van" : "nieu-7";
    return [...employees, { ...makeEmployee(id, "Thu Van Nguyen", "MINIJOB", 43), personKey: THU_VAN_KEY }];
  }
  return employees;
}

/**
 * Kunden-Demo: die Zeile „demo" existiert schon (leer angelegt, bevor es
 * Beispieldaten gab) – sampleEmployees greift dort nie mehr. Ist die Liste noch
 * LEER, die 10 Demo-Personen einsetzen. Hat jemand schon Leute angelegt, bleibt
 * alles unverändert.
 */
export const MIGRATION_DEMO_SEED = "2026-10-demo-seed-10";

/**
 * Lemontaste – bảng nhân sự 10/2026: bỏ Duc Thanh Nguyen, đặt tên hai người mới
 * (Thai Hung Nguyen, Tran Dinh Hoang), vị trí Bếp/Bar, ngày làm, Van Diep nghỉ
 * cuối T10, Dinh Bien chỉ làm trong khung 18:00–21:30.
 */
export const MIGRATION_LEMONTASTE_STAFF_10 = "2026-10-lemontaste-staff";

/** Dinh Bien: Khung giờ ưu tiên wieder entfernen (Khung ca reicht, sonst Fehlwarnung). */
export const MIGRATION_LEMONTASTE_BIEN_PREF = "2026-10-lemontaste-bien-pref";

/** Ly Ly + Thi Huong sind laut Zettel des Chefs Bồi (Phục vụ); Thi Huong Fr–So. */
export const MIGRATION_LEMONTASTE_SERVICE = "2026-10-lemontaste-service";

/** Wendet alle noch offenen Änderungen auf den Stand einer Filiale an. */
export function applyMigrations(storeId: string, schedule: Schedule): Schedule {
  let next = schedule;
  const done = () => next.migrations ?? [];
  if (!done().includes(MIGRATION_THU_VAN_NIEU)) {
    next = { ...next, employees: thuVanNieu(storeId, next.employees), migrations: [...done(), MIGRATION_THU_VAN_NIEU] };
  }
  if (!done().includes(MIGRATION_DEMO_SEED)) {
    const seed = storeId === "demo" && next.employees.length === 0;
    next = { ...next, employees: seed ? demoEmployees() : next.employees, migrations: [...done(), MIGRATION_DEMO_SEED] };
  }
  if (!done().includes(MIGRATION_LEMONTASTE_STAFF_10)) {
    const employees = storeId === "lemontaste"
      ? next.employees
          .filter((e) => e.id !== "lt-duc-thanh")
          .map((e) => (LEMONTASTE_PATCHES[e.id] ? { ...e, ...LEMONTASTE_PATCHES[e.id] } : e))
      : next.employees;
    const shifts = storeId === "lemontaste" ? next.shifts.filter((s) => s.employeeId !== "lt-duc-thanh") : next.shifts;
    next = { ...next, employees, shifts, migrations: [...done(), MIGRATION_LEMONTASTE_STAFF_10] };
  }
  if (!done().includes(MIGRATION_LEMONTASTE_BIEN_PREF)) {
    const employees = storeId === "lemontaste"
      ? next.employees.map((e) => (e.id === "lt-dinh-bien" ? { ...e, preferredWindows: undefined } : e))
      : next.employees;
    next = { ...next, employees, migrations: [...done(), MIGRATION_LEMONTASTE_BIEN_PREF] };
  }
  if (!done().includes(MIGRATION_LEMONTASTE_SERVICE)) {
    const fix = ["lt-ngoc-ly-ly", "lt-thi-huong"];
    const employees = storeId === "lemontaste"
      ? next.employees.map((e) => (fix.includes(e.id) ? { ...e, ...LEMONTASTE_PATCHES[e.id] } : e))
      : next.employees;
    next = { ...next, employees, migrations: [...done(), MIGRATION_LEMONTASTE_SERVICE] };
  }
  const dualRoleMigration = "2026-10-23-ngoc-long-both";
  if (storeId === "lemontaste" && !done().includes(dualRoleMigration)) {
    next = { ...next, employees: next.employees.map(e => e.id === "lt-ngoc-long" ? { ...e, station: "BOTH" } : e),
      migrations: [...done(), dualRoleMigration] };
  }
  return next;
}
