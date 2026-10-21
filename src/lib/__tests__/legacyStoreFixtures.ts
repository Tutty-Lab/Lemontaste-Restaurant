// Isolated historical rosters for scheduler regression tests inherited from demo.
import type { Schedule } from "../../types";
import type { StoreConfig } from "../stores";
import { shinEmployees, cocoEmployees, nieuEmployees } from "../sampleData";
import { DAY_WEIGHTS } from "../demand";
import { STAFFING_RULES } from "../staffing";
import { DEFAULT_WORK_HOURS } from "../workHours";
export { withSharedPersonDefaults } from "../stores";
export type { StoreConfig } from "../stores";
export const STORES: StoreConfig[] = [
  { id: "shin", name: "Shin Restaurant", shortName: "Shin", address: "Durmersheim", sampleEmployees: shinEmployees, dayWeights: DAY_WEIGHTS, staffingRules: STAFFING_RULES },
  { id: "coco", name: "Coco Restaurant", shortName: "Coco", address: "Filderstadt", sampleEmployees: cocoEmployees, dayWeights: DAY_WEIGHTS, staffingRules: STAFFING_RULES },
  { id: "nieu", name: "Nieu 37 Restaurant", shortName: "Nieu", address: "Aalen", sampleEmployees: nieuEmployees,
    dayWeights: { ...DAY_WEIGHTS, thursday: 1 },
    staffingRules: STAFFING_RULES.map(r => r.label === "Tối" ? { ...r, minStaff: 3 } : r) },
];
export function storeById(id: string): StoreConfig { return STORES.find(s => s.id === id)!; }
export function initialScheduleFor(store: StoreConfig): Schedule {
  return { companyName: store.name, address: store.address, year: 2026, month: 9,
    workHours: structuredClone(DEFAULT_WORK_HOURS), dateOverrides: [], employees: store.sampleEmployees(), shifts: [] };
}
