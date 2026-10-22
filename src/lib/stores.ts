// Lemontaste: một quán.

import type { Employee, Schedule } from "../types";
import { type WeekdayKey } from "./demand";
import { type DemandBand, type StaffingRule } from "./staffing";
import { DEFAULT_WORK_HOURS } from "./workHours";
import { lemontasteEmployees } from "./restaurantData";
import { clip } from "./staffing";
import type { WorkHoursConfig } from "./workHours";

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
// Chưa có số người yêu cầu mỗi ca: tối thiểu một người, cao điểm tối thiểu hai.
const rules: readonly StaffingRule[] = [
  { label: "Trong giờ mở cửa", when: "11:00–21:30", minStaff: 1, maxStaff: Infinity,
    scaled: false, windows: blocks => blocks },
  { label: "Cao điểm trưa", when: "12:00–14:00", minStaff: 2, maxStaff: Infinity,
    scaled: false, windows: clip(720, 840) },
  { label: "Cao điểm tối", when: "18:00–20:00", minStaff: 2, maxStaff: Infinity,
    scaled: false, windows: clip(1080, 1200) },
  // Chủ quán (10/2026): luôn có ít nhất 1 Bếp suốt giờ mở cửa.
  { label: "Bếp", when: "11:00–21:30", minStaff: 1, maxStaff: Infinity,
    scaled: false, who: (e: Employee) => e.station === "KITCHEN", windows: blocks => blocks },
  // Giờ cao điểm phải có ít nhất 1 Phục vụ (không đủ giờ để có Phục vụ suốt ngày).
  { label: "Phục vụ trưa", when: "12:00–14:00", minStaff: 1, maxStaff: Infinity,
    scaled: false, who: (e: Employee) => e.station !== "KITCHEN", windows: clip(720, 840) },
  { label: "Phục vụ tối", when: "18:00–20:00", minStaff: 1, maxStaff: Infinity,
    scaled: false, who: (e: Employee) => e.station !== "KITCHEN", windows: clip(1080, 1200) },
];
export const STORES: StoreConfig[] = [
  { id: "lemontaste", name: "Lemontaste", shortName: "Lemontaste",
    address: "", sampleEmployees: lemontasteEmployees,
    workHours: lemontasteHours, staffingRules: rules,
    demandProfile: [
      { startMinutes: 660, endMinutes: 720, level: 1, label: "Mở cửa" },
      { startMinutes: 720, endMinutes: 840, level: 1.8, label: "Cao điểm trưa" },
      { startMinutes: 840, endMinutes: 900, level: 1, label: "Sau trưa" },
      { startMinutes: 900, endMinutes: 1020, level: 0.6, label: "Ít khách" },
      { startMinutes: 1020, endMinutes: 1080, level: 1, label: "Mở tối" },
      { startMinutes: 1080, endMinutes: 1200, level: 1.8, label: "Cao điểm tối" },
      { startMinutes: 1200, endMinutes: 1290, level: 0.8, label: "Cuối ca" },
    ],
    dayWeights: { monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1.5, sunday: 1.5 },
    notes: "Mở 11:00–21:30. Cao điểm 12:00–14:00, 18:00–20:00; ít khách 15:00–17:00. Đông thứ 7, CN. Pause 30 phút. Vollzeit 6 giờ/ngày. Không tính Nacht-/Sonntagszuschlag." },
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
