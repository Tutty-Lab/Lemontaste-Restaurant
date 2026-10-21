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
  return next;
}
