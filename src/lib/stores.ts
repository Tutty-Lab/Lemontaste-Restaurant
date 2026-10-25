import { REQUIRED_COVERAGE } from "./coveragePolicy";
// Lemontaste: một quán.

import type { Employee, Schedule } from "../types";
import { type WeekdayKey } from "./demand";
import { type DemandBand, type StaffingRule } from "./staffing";
import { DEFAULT_WORK_HOURS } from "./workHours";
import { lemontasteEmployees } from "./restaurantData";
import { clip } from "./staffing";
import type { DayBlocks, WorkHoursConfig } from "./workHours";

export type StoreConfig = {
  /** Schlüssel der Zeile in store_data – nach dem Anlegen NICHT mehr ändern. */
  id: string;
  name: string;
  /** Kurzname für den Umschalter in der Kopfzeile. */
  shortName: string;
  address: string;
  /** Belegschaft beim allerersten Öffnen. */
  sampleEmployees: () => Employee[];
  workHours?: WorkHoursConfig;
  notes?: string;
  demandProfile?: readonly DemandBand[];
  /** Welche Wochentage stark sind (Umsatz) – steuert die Stundenverteilung. */
  dayWeights: Record<WeekdayKey, number>;
  /** Wie viele Leute wann im Haus sein sollen. */
  staffingRules: readonly StaffingRule[];
};

// Lemontaste: mở liên tục 11:00–21:30, mọi ngày kể cả lễ.
const open = { startMinutes: 660, endMinutes: 1290 };
const lemontasteHours: WorkHoursConfig = {
  perWeekday: { monday: [open], tuesday: [open], wednesday: [open], thursday: [open],
    friday: [open], saturday: [open], sunday: [open] },
  holiday: [open],
  closedWeekdays: { monday: false, tuesday: false, wednesday: false, thursday: false,
    friday: false, saturday: false, sunday: false },
};
// Cover both stations in the mandatory windows before optional opening hours.
const coreWindows = (blocks: DayBlocks) =>
  REQUIRED_COVERAGE.flatMap(w => clip(w.startMinutes, w.endMinutes)(blocks));
const rules: readonly StaffingRule[] = [
  { priority: "required", label: "Bếp bắt buộc", when: "11:00–14:00, 17:00–20:00", minStaff: 1, maxStaff: Infinity,
    scaled: false, who: (e: Employee) => e.station === "KITCHEN", windows: coreWindows },
  { priority: "required", label: "Bồi bắt buộc", when: "11:00–14:00, 17:00–20:00", minStaff: 1, maxStaff: Infinity,
    scaled: false, who: (e: Employee) => e.station !== "KITCHEN", windows: coreWindows },
  { priority: "preparation", label: "Bếp ngày đông", when: "T6–CN 12:00–14:00, 18:00–20:00", minStaff: 2, maxStaff: Infinity,
    scaled: false, weekdays: ["friday", "saturday", "sunday"], who: (e: Employee) => e.station === "KITCHEN",
    windows: blocks => [...clip(720, 840)(blocks), ...clip(1080, 1200)(blocks)] },
  { priority: "coverage", label: "Bếp bổ sung", when: "14:00–17:00, 20:00–21:30", minStaff: 1, maxStaff: Infinity,
    scaled: false, who: (e: Employee) => e.station === "KITCHEN",
    windows: blocks => [...clip(840, 1020)(blocks), ...clip(1200, 1290)(blocks)] },
  { priority: "coverage", label: "Bồi chuẩn bị gọn", when: "11:00–12:00", minStaff: 1, maxStaff: 1,
    scaled: false, who: (e: Employee) => e.station !== "KITCHEN", windows: clip(660, 720) },
  { priority: "coverage", label: "Bồi bổ sung", when: "14:00–17:00, 20:00–21:30", minStaff: 1, maxStaff: Infinity,
    scaled: false, who: (e: Employee) => e.station !== "KITCHEN",
    windows: blocks => [...clip(840, 1020)(blocks), ...clip(1200, 1290)(blocks)] },
];
export const STORES: StoreConfig[] = [
  { id: "lemontaste", name: "Lemontaste", shortName: "Lemontaste",
    address: "", sampleEmployees: lemontasteEmployees,
    workHours: lemontasteHours, staffingRules: rules,
    demandProfile: [
      { startMinutes: 660, endMinutes: 720, level: 1, label: "Chuẩn bị trưa" },
      { startMinutes: 720, endMinutes: 840, level: 1.8, label: "Cao điểm trưa" },
      { startMinutes: 840, endMinutes: 900, level: 1, label: "Sau trưa" },
      { startMinutes: 900, endMinutes: 1020, level: 0.6, label: "Ít khách" },
      { startMinutes: 1020, endMinutes: 1200, level: 1.8, label: "Cao điểm tối và chuẩn bị" },
      { startMinutes: 1200, endMinutes: 1290, level: 0.8, label: "Cuối ca" },
    ],
    dayWeights: { monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1.5, saturday: 1.5, sunday: 1.5 },
    notes: "Mở 11:00–21:30. Bắt buộc có Bồi và Bếp liên tục 11:00–14:00, 17:00–20:00. Khung 14:00–17:00 và sau 20:00 cho phép thiếu; còn giờ thì phủ thêm. Đông T6, T7, CN; ưu tiên 2 Bếp 12–14h, 18–20h. Bồi 11–12h chỉ cần 1 người. Pause 30 phút. Vollzeit 6 giờ/ngày. Không tính Nacht-/Sonntagszuschlag." },
];

export const DEFAULT_STORE_ID = STORES[0].id;

/** Merkt sich die zuletzt gewählte Filiale auf diesem Gerät. */
const STORE_KEY = "lemontaste-app:store";

export function loadStoreId(): string {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && STORES.some((s) => s.id === saved)) return saved;
  } catch {
    /* ignorieren */
  }
  return DEFAULT_STORE_ID;
}

export function saveStoreId(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* ignorieren */
  }
}

export function storeById(id: string): StoreConfig {
  return STORES.find((s) => s.id === id) ?? STORES[0];
}

/**
 * Ältere Stände (gespeichert, bevor Nieu 37 dazukam) kennen noch keinen
 * personKey. Dann erkennt „Tạo lịch làm việc" nicht, dass Bá Việt Nguyen im
 * Shin und im Nieu derselbe Mensch ist, und plant ihn am selben Tag in beiden
 * Läden. Fehlt der personKey, übernimmt ein Mitarbeiter mit derselben id und
 * demselben Namen wie in der Startbelegschaft personKey und – nur in diesem
 * einen Schritt – auch maxDaysPerWeek. Danach steht der personKey im Stand, und
 * ein später geleertes „tối đa … ngày/tuần" bleibt leer. Löst man die
 * Verbindung im Tab Nhân viên, steht dort "" statt nichts.
 */
export function withSharedPersonDefaults(employees: Employee[], store: StoreConfig): Employee[] {
  const starters = new Map(store.sampleEmployees().map((e) => [e.id, e]));
  return employees.map((employee) => {
    const starter = starters.get(employee.id);
    // "" = im Tab Nhân viên bewusst gelöst – dann nicht wieder verbinden.
    if (employee.personKey !== undefined || !starter?.personKey || starter.name !== employee.name) return employee;
    return {
      ...employee,
      personKey: starter.personKey,
      maxDaysPerWeek: employee.maxDaysPerWeek ?? starter.maxDaysPerWeek,
    };
  });
}

/** Startstand einer Filiale: September 2026 mit der Belegschaft aus der Angabe. */
export function initialScheduleFor(store: StoreConfig): Schedule {
  return {
    companyName: store.name,
    address: store.address,
    year: 2026,
    month: 9,
    workHours: structuredClone(store.workHours ?? DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: store.sampleEmployees(),
    shifts: [],
  };
}
