import { busyKitchenTarget } from "./coveragePolicy";
import type { DemandBand } from "./staffing";
import type { Employee, PreferredWindow, Shift } from "../types";
import { DAY_WEIGHTS, datesOfMonth, parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";
import { monthlyTargetMinutesFor, weeklyBudgetMinutes, weeklyTargetMinutes } from "./contract";
import { calculatePause } from "./time";
import { mayWorkOn } from "./availability";
import { peakBalanceTargets, type BalanceSlot } from "./peakBalance";
import { consecutiveRunLengthWith } from "./consecutive";
import { effectiveWeekdayKey, resolveDay, type DayBlocks, type DayWindow, type OverrideMap, type WorkHoursConfig } from "./workHours";
import { publicHolidays } from "./holidays";
import { weekStartOf } from "./weeks";
import { minutesOutsidePreferred, ownShiftRangeMinutes, preferredWindowsOf } from "./preferredWindows";
import {
  CLOSING_START,
  STAFFING_RULES,
  slotTargets,
  staffingWindows,
  weightedDailyTargets,
  workingAt,
  assignStations,
  workloadAt,
  type StaffingRule,
  type StaffingWindow,
} from "./staffing";

/**
 * Was an EINER Filiale anders ist: Tagesgewichte (welche Tage stark sind),
 * Besetzungsregeln und die Tage, an denen jemand schon im anderen Laden
 * eingeteilt ist. Wird durch alle Schritte gereicht, damit zwei Filialen sich
 * weder Regeln noch Zwischenergebnisse teilen.
 */
type Ctx = {
  minShift: number;
  options: Map<string, Option[]>;
  costs: Map<string, Cost>;
  stationSubsets: Map<number, Employee[]>;
  employeeBits: Map<string, number>;
  balanceTargets?: Map<string, Map<number, { service: number; kitchen: number; weight: number }>>;
  models: Map<string, DayModel>;
  peakPolish?: boolean;
  rules: readonly StaffingRule[];
  weights: Record<WeekdayKey, number>;
  demandProfile?: readonly DemandBand[];
  /** employeeId -> Daten, an denen die Person im anderen Laden arbeitet. */
  blocked: Map<string, Set<string>>;
  /** Teil des Cache-Schlüssels, damit Filialen nicht dasselbe Tagesmodell nutzen. */
  tag: string;
  /** „Khung giờ ưu tiên" je employeeId – nur wer welche gesetzt hat. */
  windows: Map<string, PreferredWindow[]>;
  employeesById: Map<string, Employee>;
  holidays: Set<string>;
};

type WeeklyInput = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  overrides?: OverrideMap;
  employees: Employee[];
  holidays?: Set<string>;
  /** Besetzungsregeln dieser Filiale; fehlt = die Standardregeln. */
  rules?: readonly StaffingRule[];
  /** Tagesgewichte dieser Filiale; fehlt = DAY_WEIGHTS. */
  weights?: Record<WeekdayKey, number>;
  demandProfile?: readonly DemandBand[];
  /** Wer im anderen Laden schon arbeitet: employeeId -> ISO-Daten. */
  blockedDays?: Record<string, readonly string[]>;
  /** Kennung der Filiale (nur für den internen Cache). */
  storeTag?: string;
};
type Option = { shifts: Shift[]; styleCost: number };
type Choice = { date: string; paid: number; option: Option };
type Allocation = { paid: number; cost: Cost; mask: number; choices: Choice[] };
type Day = ReturnType<typeof resolveDay>;

// Compare objectives separately; no soft weight can buy a required staffing gap.
type Cost = [required: number, preparation: number, coverage: number, balance: number, preferences: number];
const zeroCost = (): Cost => [0, 0, 0, 0, 0];
const infiniteCost = (): Cost => [Infinity, Infinity, Infinity, Infinity, Infinity];
const addCost = (a: Cost, b: Cost): Cost => a.map((v, i) => v + b[i]) as Cost;
const subtractCost = (a: Cost, b: Cost): Cost => a.map((v, i) => v - b[i]) as Cost;
const preferenceCost = (a: Cost, value: number): Cost => [a[0], a[1], a[2], a[3], a[4] + value];
function cheaper(a: Cost, b: Cost, epsilon = 0): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) return a[i] < b[i];
  }
  return false;
}

const SLOT = 30;

/** Höchste bezahlte Zeit je Tag: 8 h (Vorgabe des Betriebs, siehe validation.ts). */
const MAX_PAID = 480;
/** Cost per (person deviation)² per 30-minute slot against the demand curve. */
const SLOT_DEVIATION_COST = 300;
/** Small preference for one continuous shift over a split shift on the same day. */
const SPLIT_SHIFT_COST = 8;
/**
 * „Khung giờ ưu tiên": Aufschlag je Arbeitsminute außerhalb der Wunschfenster.
 * Ein 3-h-Dienst an einem Tag ohne Fenster kostet 18.000 – mehr als die übliche
 * Abweichung vom Tagesziel (1.500 je Stunde²), damit der Wunsch nicht dem
 * Feinschliff der Kurve weicht. Fehlt eine Besetzungsregel über mehrere halbe
 * Stunden (je 15.000), geht sie trotzdem vor.
 */
const OUTSIDE_WINDOW_COST = 100;

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function dayOf(date: string): WeekdayKey {
  return weekdayKeyOf(parseIsoDate(date));
}

const openMinutesOfBlocks = (blocks: DayBlocks) =>
  blocks.reduce((sum, block) => sum + (block.endMinutes - block.startMinutes), 0);

function fixedPaid(window: DayWindow): number {
  const presence = window.endMinutes - window.startMinutes;
  for (const pause of [0, 30, 60]) {
    const paid = presence - pause;
    if (paid > 0 && calculatePause(paid) === pause) return paid;
  }
  return 0;
}

/**
 * Valid pause starts (§ 4 ArbZG): at least 1 h after the start and before the
 * end, at most 6 h of work before and after the pause, on the 30-minute grid.
 */
function pauseStartCandidates(startMinutes: number, endMinutes: number, pauseMinutes: number): number[] {
  if (pauseMinutes <= 0) return [];
  return Array.from(
    { length: Math.max(0, Math.floor((endMinutes - pauseMinutes - 60 - (startMinutes + 60)) / SLOT) + 1) },
    (_, index) => startMinutes + 60 + index * SLOT,
  ).filter((start) => start - startMinutes <= 360 && endMinutes - start - pauseMinutes <= 360);
}

function makeShift(
  employeeId: string,
  date: string,
  startMinutes: number,
  paidMinutes: number,
  shiftType: "EARLY" | "LATE",
  effectiveWeekday: WeekdayKey | undefined,
  ctx: Ctx,
): Shift {
  const pauseMinutes = calculatePause(paidMinutes);
  const endMinutes = startMinutes + paidMinutes + pauseMinutes;
  const weekday = effectiveWeekday ?? dayOf(date);
  // First guess: quietest part of the demand curve, never the closing window.
  // improveCoverage later moves pauses by the REAL headcount of the day.
  const pauseStartMinutes = pauseMinutes > 0 ? pauseStartCandidates(startMinutes, endMinutes, pauseMinutes).sort((a, b) => {
    const score = (start: number) => Array.from({ length: pauseMinutes / SLOT }, (_, index) => start + index * SLOT)
      .reduce((sum, minute) => sum + workloadAt(minute, weekday, ctx.weights, ctx.demandProfile) + (minute >= CLOSING_START ? 100 : 0), 0);
    return score(a) - score(b) || ((a / SLOT + hash(employeeId)) % 7) - ((b / SLOT + hash(employeeId)) % 7);
  })[0] : undefined;
  return {
    id: `weekly-${employeeId}-${date}-${startMinutes}-${paidMinutes}`,
    employeeId, date, startMinutes,
    endMinutes,
    ...(pauseStartMinutes == null ? {} : { pauseStartMinutes }),
    pauseMinutes, paidMinutes, shiftType, generated: true,
  };
}

/** Every start on the 30-minute grid inside the block (plus the block-end anchor). */
function startsInBlock(block: DayWindow, presence: number): number[] {
  const starts: number[] = [];
  for (let start = block.startMinutes; start + presence <= block.endMinutes; start += SLOT) starts.push(start);
  const endAnchored = block.endMinutes - presence;
  if (endAnchored >= block.startMinutes && !starts.includes(endAnchored)) starts.push(endAnchored);
  return starts;
}

/** Öffnungsblöcke, auf das „Khung ca" der Person zugeschnitten. */
function blocksFor(employee: Employee, blocks: DayBlocks): DayBlocks {
  const w = employee.shiftWindow;
  if (!w) return blocks;
  return blocks
    .map((b) => ({ startMinutes: Math.max(b.startMinutes, w.startMinutes), endMinutes: Math.min(b.endMinutes, w.endMinutes) }))
    .filter((b) => b.endMinutes > b.startMinutes);
}

function optionsFor(
  employee: Employee,
  date: string,
  paid: number,
  blocks: DayBlocks,
  partialWeek: boolean,
  effectiveWeekday: WeekdayKey | undefined,
  ctx: Ctx,
): Option[] {
  const key = `${employee.id}|${date}|${paid}|${partialWeek}|${effectiveWeekday}|${blocks.map(b => `${b.startMinutes}-${b.endMinutes}`).join(",")}`;
  const cached = ctx.options.get(key);
  if (cached) return cached;
  const options = calculateOptions(employee, date, paid, blocks, partialWeek, effectiveWeekday, ctx);
  ctx.options.set(key, options);
  return options;
}

function calculateOptions(
  employee: Employee,
  date: string,
  paid: number,
  blocks: DayBlocks,
  partialWeek: boolean,
  effectiveWeekday: WeekdayKey | undefined,
  ctx: Ctx,
): Option[] {
  if (paid <= 0 || paid > MAX_PAID) return [];
  blocks = blocksFor(employee, blocks);
  if (employee.fixedShift) {
    return fixedPaid(employee.fixedShift) === paid
      ? [{ shifts: [makeShift(employee.id, date, employee.fixedShift.startMinutes, paid, "EARLY", effectiveWeekday, ctx)], styleCost: 0 }]
      : [];
  }
  const options: Option[] = [];
  const add = (shifts: Shift[]) => {
    options.push({ shifts, styleCost: (shifts.length - 1) * SPLIT_SHIFT_COST });
  };
  const placements = (block: DayWindow, duration: number, early: boolean): Shift[] =>
    startsInBlock(block, duration + calculatePause(duration))
      .map((start) => makeShift(employee.id, date, start, duration, early ? "EARLY" : "LATE", effectiveWeekday, ctx));

  blocks.forEach((block, index) => {
    for (const shift of placements(block, paid, index === 0 && block.startMinutes < 16 * 60)) add([shift]);
  });
  // Split shift: one part in the first block, one in the last; the lunch closure is unpaid.
  const minimumEvening = partialWeek ? 120 : ctx.minShift;
  if (paid >= ctx.minShift + minimumEvening && blocks.length >= 2) {
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    for (let morning = ctx.minShift; morning <= Math.min(paid - minimumEvening, first.endMinutes - first.startMinutes); morning += SLOT) {
      const evenings = placements(last, paid - morning, false);
      for (const early of placements(first, morning, true)) {
        for (const late of evenings) {
          if (early.endMinutes <= late.startMinutes) add([early, late]);
        }
      }
    }
  }
  // Ngày Chủ nhật & ngày mở liên tục (blocks.length === 1): nhân viên làm ca liên tục,
  // không có nghỉ trưa tách ca. Giờ nghỉ giải lao (pause) được xếp vào ca theo đúng luật.
  return options;
}

/**
 * Everything about a day that does not depend on the shifts, computed once:
 * the 30-minute slots of the open blocks, their target headcount (demand curve)
 * and, per staffing window, which slots it covers and for how many minutes.
 */
type DayModel = {
  masks: Map<string, number[]>;
  minutes: number[];
  targets: number[];
  windows: { slots: number[]; overlap: number[]; minStaff: number; maxStaff: number; who?: (employee: Employee) => boolean; weight?: number; priority?: StaffingRule["priority"] }[];
};
function dayModel(blocks: DayBlocks, weekday: WeekdayKey, targetHours: number, ctx: Ctx, holiday: boolean): DayModel {
  const key = `${ctx.tag}|${weekday}|${holiday}|${blocks.map((b) => `${b.startMinutes}-${b.endMinutes}`).join(",")}|${targetHours.toFixed(4)}`;
  const cached = ctx.models.get(key);
  if (cached) return cached;
  const slotList = slotTargets(blocks, weekday, targetHours, SLOT, ctx.weights, ctx.demandProfile);
  const minutes = slotList.map(([minute]) => minute);
  const windows = staffingWindows(blocks, weekday, ctx.rules, holiday).map((window: StaffingWindow) => {
    const slots: number[] = [];
    const overlap: number[] = [];
    minutes.forEach((minute, index) => {
      const covered = Math.min(window.endMinutes, minute + SLOT) - Math.max(window.startMinutes, minute);
      if (covered > 0) { slots.push(index); overlap.push(covered); }
    });
    return { slots, overlap, minStaff: window.minStaff, maxStaff: window.maxStaff, who: window.who, weight: window.weight, priority: window.priority };
  });
  const model = { masks: new Map<string, number[]>(), minutes, targets: slotList.map(([, target]) => target), windows };
  ctx.models.set(key, model);
  return model;
}

/**
 * Day cost from headcounts per 30-minute slot (shifts and pauses lie on that grid):
 *  - staffing windows: every missing/extra person-minute costs 500,
 *  - demand curve: squared deviation from the slot target (smooth "mountain"),
 *  - paid hours: squared deviation from the day's weighted hours.
 */
function dayCost(shifts: Shift[], blocks: DayBlocks, weekday: WeekdayKey, targetHours: number | undefined, ctx: Ctx, date: string): Cost {
  const key = date + ":" + targetHours + ":" + shifts.map(s => [s.employeeId, s.startMinutes, s.endMinutes,
    s.paidMinutes, s.pauseMinutes, s.pauseStartMinutes ?? ""].join(",")).sort().join(";");
  const cached = ctx.costs.get(key);
  if (cached) return cached;
  const cost = calculateDayCost(shifts, blocks, weekday, targetHours, ctx, date);
  // Bound memory during the coordinated search. Cache belongs to one planning
  // invocation; changed rules, availability or fairness targets cannot reuse it.
  if (ctx.costs.size >= 20000) ctx.costs.clear();
  ctx.costs.set(key, cost);
  return cost;
}

function calculateDayCost(shifts: Shift[], blocks: DayBlocks, weekday: WeekdayKey, targetHours: number | undefined, ctx: Ctx, date: string): Cost {
  if (blocks.length === 0) return zeroCost();
  const model = dayModel(blocks, weekday, targetHours ?? 0, ctx, ctx.holidays.has(date));
  const counts = model.minutes.map(() => 0);
  const byEmployee = new Map<string, { employee: Employee; mask: number[] }>();
  for (const shift of shifts) {
    const key = `${shift.startMinutes},${shift.endMinutes},${shift.pauseMinutes},${shift.pauseStartMinutes ?? ""}`;
    let mask = model.masks.get(key);
    if (!mask) {
      mask = model.minutes.map(minute => Number(workingAt(shift, minute)));
      model.masks.set(key, mask);
    }
    for (let i = 0; i < counts.length; i++) counts[i] += mask[i];
    const employee = ctx.employeesById.get(shift.employeeId);
    if (!employee) continue;
    const previous = byEmployee.get(employee.id);
    byEmployee.set(employee.id, { employee, mask: previous ? mask.map((v, i) => v || previous.mask[i]) : mask });
  }
  for (const employee of ctx.employeesById.values()) if (employee.ownerSupport && !byEmployee.has(employee.id)) {
    byEmployee.set(employee.id, { employee, mask: model.minutes.map(() => 1) });
    for (let i = 0; i < counts.length; i++) counts[i]++;
  }
  const members = [...byEmployee.values()];
  const busyKitchen = ctx.rules.some(r => r.label === "Bếp ngày đông") && busyKitchenTarget(date, 720) === 2;
  const assigned = model.minutes.map((minute, i) => {
    const kitchenNeeded = busyKitchen && ((minute >= 720 && minute < 840) || (minute >= 1080 && minute < 1200)) ? 2 : 1;
    // At most 30 employees fit the bitmask; larger teams keep the general path.
    if (ctx.employeesById.size > 30) return assignStations(members.filter(m => m.mask[i]).map(m => m.employee), kitchenNeeded);
    let bits = 0;
    for (const member of members) if (member.mask[i]) bits |= ctx.employeeBits.get(member.employee.id)!;
    const key = bits * 3 + kitchenNeeded;
    let staff = ctx.stationSubsets.get(key);
    if (!staff) {
      staff = assignStations([...ctx.employeesById.values()].filter(e => bits & ctx.employeeBits.get(e.id)!), kitchenNeeded);
      ctx.stationSubsets.set(key, staff);
    }
    return staff;
  });
  let cost = 0;
  let required = 0, preparation = 0, coverage = 0;
  for (const window of model.windows) {
    // Gruppenregel (nur Bếp / Phục vụ / Lái xe): eigene Zählung je Slot.
    const who = window.who;
    for (let k = 0; k < window.slots.length; k++) {
      const staff = who ? assigned[window.slots[k]].filter(who).length : counts[window.slots[k]];
      // Gruppenregeln (z. B. „mindestens 1 Phục vụ") wiegen 10× – sonst opfert der
      // Planer eine halbe Stunde ohne Service, um die Tagesstunden zu treffen.
      const deficit = (Math.max(0, window.minStaff - staff) + Math.max(0, staff - window.maxStaff)) * window.overlap[k];
      if (window.priority === "required") required += deficit;
      else if (window.priority === "preparation") preparation += deficit;
      else if (window.priority === "coverage") coverage += deficit;
      else cost += deficit * (window.weight ?? (who ? 5000 : 500));
    }
  }
  for (let i = 0; i < counts.length; i++) cost += (counts[i] - model.targets[i]) ** 2 * SLOT_DEVIATION_COST;
  const paidHours = shifts.reduce((sum, shift) => sum + shift.paidMinutes, 0) / 60;
  cost += (paidHours - (targetHours ?? 0)) ** 2 * 1500;
  for (const shift of shifts) {
    const windows = ctx.windows.get(shift.employeeId);
    if (windows) cost += minutesOutsidePreferred(windows, dayOf(shift.date), shift) * OUTSIDE_WINDOW_COST;
  }
  let balance = 0;
  const targets = ctx.balanceTargets?.get(date);
  if (targets) for (let i = 0; i < model.minutes.length; i++) {
    const target = targets.get(model.minutes[i]);
    if (!target) continue;
    const kitchen = assigned[i].filter(e => e.station === "KITCHEN").length;
    const service = assigned[i].length - kitchen;
    balance += SLOT * ((service - target.service) ** 2 + (kitchen - target.kitchen) ** 2) / target.weight;
    balance += SLOT * Math.max(0, service - Math.ceil(target.service)) ** 2 * (ctx.peakPolish ? 1200 : 10);
  }
  if (targets) balance += (paidHours - (targetHours ?? 0)) ** 2 * 120;
  return [required, preparation, coverage, balance, cost];
}

function dayLimit(employee: Employee): number {
  return Math.min(6, employee.maxDaysPerWeek ?? 6);
}

/**
 * Woche einer Person planen. Mit „Độ dài ca" zuerst nur in dieser Länge; reicht
 * das für das Wochensoll nicht, gilt die Standardlänge (die Regel ist weich).
 */
function chooseWeek(
  employee: Employee,
  dates: string[],
  target: number,
  existing: Shift[],
  days: Map<string, Day>,
  holidays: Set<string>,
  dailyTargets: Map<string, number>,
  ctx: Ctx,
): Choice[] {
  const own = employee.fixedShift ? null : ownShiftRangeMinutes(employee);
  const withOwn = chooseWeekWith(employee, dates, target, existing, days, holidays, dailyTargets, ctx, own);
  if (!own) return withOwn;
  const paidOf = (choices: Choice[]) => choices.reduce((sum, choice) => sum + choice.paid, 0);
  if (paidOf(withOwn) >= target) return withOwn;
  const plain = chooseWeekWith(employee, dates, target, existing, days, holidays, dailyTargets, ctx, null);
  return paidOf(plain) > paidOf(withOwn) ? plain : withOwn;
}

function chooseWeekWith(
  employee: Employee,
  dates: string[],
  target: number,
  existing: Shift[],
  days: Map<string, Day>,
  holidays: Set<string>,
  dailyTargets: Map<string, number>,
  ctx: Ctx,
  own: { min: number; max: number } | null,
): Choice[] {
  // Wer an diesem Tag schon im anderen Laden steht, ist hier nicht verfügbar –
  // die Läden liegen weit auseinander, zwei Dienste am selben Tag gehen nicht.
  const busy = ctx.blocked.get(employee.id);
  const eligible = dates.filter((date) => mayWorkOn(employee, date) && !busy?.has(date));
  const limit = Math.min(dayLimit(employee), eligible.length);
  if (target <= 0 || limit <= 0) return [];
  const fixed = employee.fixedShift ? fixedPaid(employee.fixedShift) : 0;
  if (employee.fixedShift && fixed === 0) return [];
  // Mit „Độ dài ca" folgt die Tageszahl der Wunschlänge; „Rải đều" nimmt das
  // kurze Ende (mehr, dafür kürzere Tage).
  const ownCount = own
    ? employee.spreadEvenly
      ? Math.floor(target / own.min)
      : Math.round(target / ((own.min + own.max) / 2))
    : 0;
  const preferredCount = fixed
    ? Math.min(limit, Math.floor(target / fixed))
    : own
      ? Math.min(limit, Math.max(1, ownCount))
      : Math.min(limit, Math.max(1, Math.floor(target / ctx.minShift)));

  // ±1,5 h um den Durchschnitt: genug Spielraum, damit Stoßtage (Gewicht 1,5)
  // längere und Normaltage kürzere Dienste bekommen können.
  const base = Math.round(target / Math.max(1, preferredCount) / SLOT) * SLOT;
  let lo = Math.max(ctx.minShift, base - 3 * SLOT);
  let hi = Math.min(MAX_PAID, base + 3 * SLOT);
  while (hi * preferredCount < target && hi < MAX_PAID) hi += SLOT;
  while (lo * preferredCount > target && lo > ctx.minShift) lo -= SLOT;
  // Mehr Wochensoll als die freien Tage fassen (z. B. Minijob im zweiten Laden,
  // der nur einen Tag je Woche frei hat): ohne diese Klammer läge lo über hi,
  // es gäbe keine einzige zulässige Dienstlänge, und die Person bekäme in der
  // Woche GAR NICHTS statt der möglichen 8 h.
  if (lo > hi) lo = hi;

  const durations = new Set<number>();
  if (fixed) durations.add(fixed);
  else if (own) {
    for (let duration = own.min; duration <= own.max; duration += SLOT) {
      if (duration <= target) durations.add(duration);
    }
  } else if (target < ctx.minShift) durations.add(target);
  else {
    for (let duration = lo; duration <= hi; duration += SLOT) {
      if (duration <= target) durations.add(duration);
    }
  }

  // Other-store days are workdays too, including days in adjacent weeks.
  const worked = new Set([
    ...(busy ?? []),
    ...existing.filter((shift) => shift.employeeId === employee.id).map((shift) => shift.date),
  ]);
  const week = weekStartOf(dates[0]);
  const workedThisWeek = new Set([...worked].filter((date) => weekStartOf(date) === week));
  const validMasks = new Map<number, boolean>();
  const valid = (mask: number) => {
    const cached = validMasks.get(mask);
    if (cached != null) return cached;
    const set = new Set(worked);
    let ok = true;
    let weekDays = workedThisWeek.size;
    eligible.forEach((date, index) => {
      if ((mask & (1 << index)) === 0) return;
      if (consecutiveRunLengthWith(set, date) > 6) ok = false;
      if (!workedThisWeek.has(date)) weekDays++;
      set.add(date);
    });
    if (weekDays > 6) ok = false;
    validMasks.set(mask, ok);
    return ok;
  };

  // Ideale Dienstlänge je Tag folgt demselben Faktor wie das Tagesziel
  // (Gewicht × Öffnungsdauer, Tab „Tài liệu") – bei gleicher Wochensumme.
  const factorOf = (date: string) =>
    ctx.weights[effectiveWeekdayKey(date, holidays)] * openMinutesOfBlocks(days.get(date)!.blocks);
  const averageFactor = eligible.reduce((sum, date) => sum + factorOf(date), 0) / eligible.length;

  let states = new Map<number, Allocation>([[0, { paid: 0, cost: zeroCost(), mask: 0, choices: [] }]]);
  for (let index = 0; index < eligible.length; index++) {
    const date = eligible[index];
    const day = days.get(date)!;
    const occupied = existing.filter((shift) => shift.date === date);
    const weekday = effectiveWeekdayKey(date, holidays);
    const ideal = averageFactor > 0 ? target / Math.max(1, preferredCount) * factorOf(date) / averageFactor : 0;
    const before = dayCost(occupied, day.blocks, weekday, dailyTargets.get(date), ctx, date);
    const candidates: { choice: Choice; cost: Cost }[] = [];
    // Continuous days (CN/lễ, one long block): a single shift always spans the
    // afternoon unless it is short. Allow the full 3–9 h range there and a soft
    // length preference, so lunch-only and evening-only shifts can shape both peaks.
    const continuous = day.blocks.length === 1 && !fixed && !own && target >= ctx.minShift;
    const dayDurations = continuous
      ? Array.from({ length: Math.floor((Math.min(MAX_PAID, target) - ctx.minShift) / SLOT) + 1 }, (_, i) => ctx.minShift + i * SLOT)
      : [...durations];
    const lengthCost = continuous ? 40 : 300;
    for (const paid of dayDurations) {
      let best: Option | undefined;
      let score = infiniteCost();
      for (const option of optionsFor(employee, date, paid, day.blocks, dates.length < 6, weekday, ctx)) {
        const cost = preferenceCost(subtractCost(dayCost([...occupied, ...option.shifts], day.blocks, weekday, dailyTargets.get(date), ctx, date), before), option.styleCost);
        if (cheaper(cost, score)) { best = option; score = cost; }
      }
      if (best) candidates.push({
        choice: { date, paid, option: best },
        cost: preferenceCost(score, ((paid - ideal) / SLOT) ** 2 * lengthCost),
      });
    }
    const next = new Map(states);
    for (const state of states.values()) {
      if (state.choices.length >= limit) continue;
      const mask = state.mask | (1 << index);
      if (!valid(mask)) continue;
      for (const candidate of candidates) {
        const paid = state.paid + candidate.choice.paid;
        if (paid > target) continue;
        const key = paid * 128 + mask;
        const cost = addCost(state.cost, candidate.cost);
        if (!cheaper(cost, next.get(key)?.cost ?? infiniteCost())) continue;
        next.set(key, { paid, cost, mask, choices: [...state.choices, candidate.choice] });
      }
    }
    states = next;
  }
  // Exact weekly minutes take priority. An impossible quota stays short and
  // is reported by validation, never transferred to another week.
  // Feiertagspflicht (requiredOnHolidays): wer an Feiertagen im Dienst sein
  // muss, verliert diesen Tag nicht an eine sonst leicht bessere Verteilung.
  // Unmöglich (Feiertag vor Eintritt, Laden zu) bleibt folgenlos.
  const requiredIndexes = employee.requiredOnHolidays
    ? eligible.map((date, index) => (holidays.has(date) ? index : -1)).filter((index) => index >= 0)
    : [];
  const missingRequired = (mask: number) =>
    requiredIndexes.filter((index) => (mask & (1 << index)) === 0).length;

  let best: Allocation | undefined;
  let bestCost = infiniteCost();
  for (const state of states.values()) {
    // Vollzeit „thường 6 ngày/tuần": die Tageszahl hält, die Länge je Tag folgt dem Gewicht.
    const cost = preferenceCost(state.cost, (state.choices.length - preferredCount) ** 2 * 50000 + missingRequired(state.mask) * 500000);
    if (!best || state.paid > best.paid || (state.paid === best.paid && cheaper(cost, bestCost))) {
      best = state;
      bestCost = cost;
    }
  }
  return best?.choices ?? [];
}

/**
 * Nachschlag: die letzten Rest-Minuten an bestehende Dienste hängen.
 *
 * Das Monats-Soll wird je ISO-Woche verteilt und dort exakt geplant. Was beim
 * Runden auf das 30-Minuten-Raster übrig bleibt (oft 30–120 min), konnte bisher
 * nirgendwo mehr unterkommen und endete als Warnung „zu wenig geplant". Hier
 * wächst deshalb zum Schluss ein passender Dienst um 30 Minuten – solange
 * Tagesgrenze, Öffnungsblock und (bei Wochenverträgen) das Wochenbudget das
 * hergeben. Gewählt wird die Stelle, die der Nachfragekurve am wenigsten
 * schadet.
 */
function topUpShortfalls(
  result: Shift[],
  employees: Employee[],
  days: Map<string, Day>,
  holidays: Set<string>,
  dailyTargets: Map<string, number>,
  targets: Map<string, number>,
  weeklyCaps: Map<string, Map<string, number>>,
  ctx: Ctx,
): Shift[] {
  let shifts = [...result];
  for (const employee of employees) {
    if (employee.fixedShift) continue; // feste Schicht bleibt unangetastet
    const target = targets.get(employee.id) ?? 0;
    const paidOf = (list: Shift[]) => list.reduce((sum, shift) => sum + shift.paidMinutes, 0);
    // „Độ dài ca": lieber einen Tag wachsen lassen, der danach noch darin liegt.
    const ownMax = ownShiftRangeMinutes(employee)?.max;
    let guard = 0;
    while (guard++ < 60) {
      const own = shifts.filter((shift) => shift.employeeId === employee.id);
      if (target - paidOf(own) < SLOT) break;
      let best: { old: Shift; next: Shift; cost: Cost; over: boolean } | undefined;
      for (const shift of own) {
        const day = days.get(shift.date);
        if (!day || day.closed) continue;
        const block = blocksFor(employee, day.blocks).find(
          (candidate) => shift.startMinutes >= candidate.startMinutes && shift.endMinutes <= candidate.endMinutes,
        );
        if (!block) continue;
        const sameDay = own.filter((other) => other.date === shift.date);
        if (paidOf(sameDay) + SLOT > MAX_PAID) continue;
        const over = ownMax != null && paidOf(sameDay) + SLOT > ownMax;
        const paid = shift.paidMinutes + SLOT;
        if (paid > MAX_PAID) continue;
        const week = weekStartOf(shift.date);
        const cap = weeklyCaps.get(employee.id)?.get(week);
        if (cap != null) {
          const inWeek = own.filter((other) => weekStartOf(other.date) === week);
          if (paidOf(inWeek) + SLOT > cap) continue;
        }
        const presence = paid + calculatePause(paid);
        const weekday = effectiveWeekdayKey(shift.date, holidays);
        const onDay = shifts.filter((other) => other.date === shift.date);
        const others = onDay.filter((other) => other !== shift);
        const before = dayCost(onDay, day.blocks, weekday, dailyTargets.get(shift.date), ctx, shift.date);
        for (const start of [shift.startMinutes, shift.endMinutes - presence, block.endMinutes - presence]) {
          if (start < block.startMinutes || start + presence > block.endMinutes) continue;
          const grown = makeShift(employee.id, shift.date, start, paid, shift.shiftType === "EARLY" ? "EARLY" : "LATE", weekday, ctx);
          const clash = sameDay.some(
            (other) => other !== shift && other.startMinutes < grown.endMinutes && grown.startMinutes < other.endMinutes,
          );
          if (clash) continue;
          const cost = subtractCost(dayCost([...others, grown], day.blocks, weekday, dailyTargets.get(shift.date), ctx, shift.date), before);
          if (!best || (best.over && !over) || (best.over === over && cheaper(cost, best.cost))) {
            best = { old: shift, next: grown, cost, over };
          }
        }
      }
      if (!best) break;
      shifts = shifts.map((shift) => (shift === best!.old ? best!.next : shift));
    }
  }
  return shifts;
}
/** Deterministic monthly repair. Explore coordinated time transfers, retaining
 * the best complete schedule; staffing deficits never disappear from scoring. */
function repairMonthlyCoverage(result: Shift[], employees: Employee[], days: Map<string, Day>, holidays: Set<string>, dailyTargets: Map<string, number>, ctx: Ctx): Shift[] {
  const eligible = employees.filter(e => e.weeklyHours == null && !e.fixedShift);
  let state = result, best = result;
  const scoreDay = (date: string, list: Shift[]) => dayCost(list.filter(s => s.date === date), days.get(date)!.blocks,
    effectiveWeekdayKey(date, holidays), dailyTargets.get(date), ctx, date);
  let scores = new Map([...days.keys()].map(date => [date, scoreDay(date, state)]));
  let total = [...scores.values()].reduce(addCost, zeroCost()), bestCost = total;
  const scalar = (c: Cost) => ctx.balanceTargets
    ? c[0] * 10000 + c[1] * 100 + c[2] + c[3] * .02 + c[4] * 1e-8
    : c[0] * 1000 + c[1] * 30 + c[2] + c[4] * 1e-8;
  let seed = 73451;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)];
  const dates = [...days].filter(([,day]) => !day.closed).map(([date]) => date);
  const place = (employee: Employee, date: string, paid: number): Shift | undefined => {
    const blocks = blocksFor(employee, days.get(date)!.blocks).filter(b => b.endMinutes - b.startMinutes >= paid + calculatePause(paid));
    if (!blocks.length || paid < ctx.minShift || paid > MAX_PAID) return undefined;
    const block = pick(blocks), start = pick(startsInBlock(block, paid + calculatePause(paid)));
    const shift = makeShift(employee.id, date, start, paid, "EARLY", effectiveWeekdayKey(date, holidays), ctx);
    if (shift.pauseMinutes) shift.pauseStartMinutes = pick(pauseStartCandidates(shift.startMinutes, shift.endMinutes, shift.pauseMinutes));
    return shift;
  };
  for (let step = 0; eligible.length && (step < 24000 || (step < 48000 && bestCost[0] > 0)); step++) {
    const priority = [0, 1, 2].find(index => [...scores.values()].some(cost => cost[index] > 0));
    const missingDates = priority == null ? [] : [...scores].filter(([,cost]) => cost[priority] > 0).map(([date]) => date);
    const targetDate = missingDates.length && random() < .7 ? pick(missingDates) : pick(dates);
    const candidates = priority === 0 ? eligible.filter(e => mayWorkOn(e, targetDate) && !ctx.blocked.get(e.id)?.has(targetDate)) : eligible;
    if (!candidates.length) continue;
    const employee = pick(candidates), own = state.filter(s => s.employeeId === employee.id);
    if (!own.length) continue;
    const mode = random(), onTarget = own.find(s => s.date === targetDate);
    const a = priority === 0 && mode < 0.25 && onTarget ? onTarget : pick(own);
    let removed = [a], added: Shift[] = [];
    if (mode < 0.25) {
      const next = place(employee, a.date, a.paidMinutes);
      if (!next) continue;
      added = [next];
    } else if (mode < 0.65) {
      const b = priority === 0 && onTarget ? onTarget : pick(own);
      if (a.date === b.date) continue;
      const amount = SLOT * (1 + Math.floor(random() * 8));
      const nextA = place(employee, a.date, a.paidMinutes - amount), nextB = place(employee, b.date, b.paidMinutes + amount);
      if (!nextA || !nextB) continue;
      removed = [a,b]; added = [nextA,nextB];
    } else if (mode < 0.85) {
      const date = targetDate;
      if (!mayWorkOn(employee, date)) continue;
      const worked = new Set([...own.filter(s => s !== a).map(s => s.date), ...(ctx.blocked.get(employee.id) ?? [])]);
      if (worked.has(date) || consecutiveRunLengthWith(worked, date) > 6 || [...worked].filter(d => weekStartOf(d) === weekStartOf(date)).length >= dayLimit(employee)) continue;
      const next = place(employee, date, a.paidMinutes);
      if (!next) continue;
      added = [next];
    } else {
      // Split a long day into two continuous shifts on different dates.
      if (a.paidMinutes < 2 * ctx.minShift) continue;
      const date = targetDate;
      if (!mayWorkOn(employee, date)) continue;
      const worked = new Set([...own.map(s => s.date), ...(ctx.blocked.get(employee.id) ?? [])]);
      if (worked.has(date) || consecutiveRunLengthWith(worked,date) > 6 || [...worked].filter(d => weekStartOf(d) === weekStartOf(date)).length >= dayLimit(employee)) continue;
      const nextA = place(employee,a.date,a.paidMinutes - ctx.minShift), nextB = place(employee,date,ctx.minShift);
      if (!nextA || !nextB) continue;
      added = [nextA,nextB];
    }
    const affected = [...new Set([...removed, ...added].map(s => s.date))];
    const candidate = [...state.filter(s => !removed.includes(s)), ...added];
    const nextScores = affected.map(date => [date, scoreDay(date, candidate)] as const);
    let nextCost = total;
    for (const [date, cost] of nextScores) nextCost = addCost(subtractCost(nextCost, scores.get(date)!), cost);
    const temperature = 40 * (1 - (step % 24000) / 24000) ** 3 + 0.1;
    if (scalar(nextCost) <= scalar(total) || random() < Math.exp((scalar(total) - scalar(nextCost)) / temperature)) {
      state = candidate; total = nextCost;
      for (const [date, cost] of nextScores) scores.set(date,cost);
      if (cheaper(total,bestCost,0.01)) { best = state; bestCost = total; }
    }
  }
  return best;
}

/** Transfer paid time between existing days without locking a monthly contract to weeks. */
function redistributeDurations(result: Shift[], employees: Employee[], days: Map<string, Day>, holidays: Set<string>, dailyTargets: Map<string, number>, ctx: Ctx): Shift[] {
  let shifts = result;
  const initialMinutes = new Map([...days.keys()].map(date => [date, result.filter(s => s.date === date).reduce((sum,s) => sum+s.paidMinutes,0)]));
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const employee of employees) {
      if (employee.weeklyHours != null || employee.fixedShift) continue;
      const own = shifts.filter(s => s.employeeId === employee.id);
      let best: { a: Shift; b: Shift; aNext: Shift[]; bNext: Shift[]; cost: Cost } | undefined;
      for (const amount of [SLOT, 2 * SLOT, 4 * SLOT, 6 * SLOT]) {
        const choices = (direction: number) => own.flatMap(old => {
          const paid = old.paidMinutes + direction * amount;
          if (paid < ctx.minShift || paid > MAX_PAID || own.filter(s => s.date === old.date).length !== 1) return [];
          const day = days.get(old.date)!;
          const others = shifts.filter(s => s.date === old.date && s !== old);
          if (ctx.peakPolish && Math.abs(others.reduce((sum,s) => sum+s.paidMinutes,0) + paid - initialMinutes.get(old.date)!) > SLOT) return [];
          const weekday = effectiveWeekdayKey(old.date, holidays);
          const before = dayCost([...others, old], day.blocks, weekday, dailyTargets.get(old.date), ctx, old.date);
          let next: Shift[] | undefined, cost = infiniteCost();
          for (const option of optionsFor(employee, old.date, paid, day.blocks, false, weekday, ctx)) {
            const candidate = subtractCost(dayCost([...others, ...option.shifts], day.blocks, weekday, dailyTargets.get(old.date), ctx, old.date), before);
            if (cheaper(candidate, cost)) { next = option.shifts; cost = candidate; }
          }
          return next ? [{ old, next, cost }] : [];
        });
        const smaller = choices(-1), larger = choices(1);
        for (const a of smaller) for (const b of larger) {
          if (a.old.date === b.old.date) continue;
          const cost = addCost(a.cost, b.cost);
          if (cheaper(cost, best?.cost ?? zeroCost(), 0.01)) best = { a: a.old, b: b.old, aNext: a.next, bNext: b.next, cost };
        }
      }
      if (best) { shifts = [...shifts.filter(s => s !== best.a && s !== best.b), ...best.aNext, ...best.bNext]; changed = true; }
    }
    if (!changed) break;
  }
  return shifts;
}

/** Swap workdays of two employees to escape local optima with the same hours. */
function swapWorkdays(result: Shift[], employees: Employee[], days: Map<string, Day>, holidays: Set<string>, dailyTargets: Map<string, number>, ctx: Ctx): Shift[] {
  let shifts = result;
  const eligible = employees.filter(e => e.weeklyHours == null && !e.fixedShift);
  for (let pass = 0; pass < 4; pass++) {
    let best: { a: Shift; b: Shift; next: Shift[]; cost: Cost } | undefined;
    const costFor = (date: string, list: Shift[]) => dayCost(list, days.get(date)!.blocks, effectiveWeekdayKey(date, holidays), dailyTargets.get(date), ctx, date);
    for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
      const ea = eligible[i], eb = eligible[j];
      const ownA = shifts.filter(s => s.employeeId === ea.id), ownB = shifts.filter(s => s.employeeId === eb.id);
      const valid = (employee: Employee, own: Shift[], old: Shift, date: string) => {
        if (!mayWorkOn(employee, date)) return false;
        const worked = new Set([...own.filter(s => s !== old).map(s => s.date), ...(ctx.blocked.get(employee.id) ?? [])]);
        return !worked.has(date) && consecutiveRunLengthWith(worked, date) <= 6 &&
          [...worked].filter(d => weekStartOf(d) === weekStartOf(date)).length < dayLimit(employee);
      };
      for (const a of ownA) for (const b of ownB) {
        if (a.date === b.date || !valid(ea, ownA, a, b.date) || !valid(eb, ownB, b, a.date)) continue;
        const replacement = (old: Shift, employee: Employee, paid: number) => {
          const others = shifts.filter(s => s.date === old.date && s !== old);
          const before = costFor(old.date, [...others, old]);
          let next: Shift[] | undefined, cost = infiniteCost();
          for (const option of optionsFor(employee, old.date, paid, days.get(old.date)!.blocks, false, effectiveWeekdayKey(old.date, holidays), ctx)) {
            const candidate = subtractCost(costFor(old.date, [...others, ...option.shifts]), before);
            if (cheaper(candidate, cost)) { next = option.shifts; cost = candidate; }
          }
          return next ? { next, cost } : undefined;
        };
        const ra = replacement(a, eb, b.paidMinutes), rb = replacement(b, ea, a.paidMinutes);
        if (!ra || !rb) continue;
        const cost = addCost(ra.cost, rb.cost);
        if (cheaper(cost, best?.cost ?? zeroCost(), 0.01)) best = { a, b, next: [...ra.next, ...rb.next], cost };
      }
    }
    if (!best) break;
    shifts = [...shifts.filter(s => s !== best.a && s !== best.b), ...best.next];
  }
  return shifts;
}

/**
 * Final per-day polish, keeping every person's paid minutes for the day:
 *  1. move a person's shift(s) to a better start (all 30-minute options),
 *  2. move each pause to the valid pause start that fits the REAL headcount –
 *     pauses chosen only by the demand curve all landed on the same hour
 *     (Sunday: 4 people 14–15 h, 5 people 15–16 h → dip, then a jump at 16 h).
 */
function improveCoverage(result: Shift[], employees: Employee[], days: Map<string, Day>, holidays: Set<string>, dailyTargets: Map<string, number>, ctx: Ctx): Shift[] {
  const output: Shift[] = [];
  for (const [date, day] of days) {
    let onDay = result.filter((shift) => shift.date === date);
    const weekday = effectiveWeekdayKey(date, holidays);
    const target = dailyTargets.get(date);
    const partialWeek = [...days].filter(([otherDate, otherDay]) => !otherDay.closed && weekStartOf(otherDate) === weekStartOf(date)).length < 6;
    for (let pass = 0; pass < 4; pass++) {
      const baseline = dayCost(onDay, day.blocks, weekday, target, ctx, date);
      let changed = false;
      for (const employee of employees) {
        const own = onDay.filter((shift) => shift.employeeId === employee.id);
        if (own.length === 0) continue;
        const paid = own.reduce((sum, shift) => sum + shift.paidMinutes, 0);
        const others = onDay.filter((shift) => shift.employeeId !== employee.id);
        let bestCost = dayCost(onDay, day.blocks, weekday, target, ctx, date);
        let best: Shift[] | undefined;
        for (const option of optionsFor(employee, date, paid, day.blocks, partialWeek, weekday, ctx)) {
          const cost = dayCost([...others, ...option.shifts], day.blocks, weekday, target, ctx, date);
          if (cheaper(cost, bestCost, 1e-9)) { best = option.shifts; bestCost = cost; }
        }
        if (best) { onDay = [...others, ...best]; changed = true; }
      }
      for (let i = 0; i < onDay.length; i++) {
        const shift = onDay[i];
        if (shift.pauseMinutes <= 0) continue;
        const others = onDay.filter((_, k) => k !== i);
        let bestCost = dayCost(onDay, day.blocks, weekday, target, ctx, date);
        let best: Shift | undefined;
        for (const start of pauseStartCandidates(shift.startMinutes, shift.endMinutes, shift.pauseMinutes)) {
          if (start === shift.pauseStartMinutes) continue;
          const moved = { ...shift, pauseStartMinutes: start };
          const cost = dayCost([...others, moved], day.blocks, weekday, target, ctx, date);
          if (cheaper(cost, bestCost, 1e-9)) { best = moved; bestCost = cost; }
        }
        if (best) { onDay = [...others.slice(0, i), best, ...others.slice(i)]; changed = true; }
      }
      // Continuous days (CN/lễ): hand over the closing role. With 9 h shifts the
      // closers can only start at noon, so nobody ramps up before the lunch peak;
      // a single-person move never sees "B closes instead, A starts earlier".
      if (day.blocks.length === 1) {
        const blockEnd = day.blocks[0].endMinutes;
        const byId = new Map(employees.map((employee) => [employee.id, employee] as const));
        for (const closer of onDay.filter((shift) => shift.endMinutes === blockEnd)) {
          for (const other of onDay.filter((shift) => shift.endMinutes !== blockEnd)) {
            if (!onDay.includes(closer) || !onDay.includes(other)) continue;
            const empA = byId.get(closer.employeeId);
            const empB = byId.get(other.employeeId);
            if (!empA || !empB || empA.fixedShift || empB.fixedShift) continue;
            const rest = onDay.filter((shift) => shift !== closer && shift !== other);
            const newClosers = optionsFor(empB, date, other.paidMinutes, day.blocks, partialWeek, weekday, ctx)
              .filter((option) => option.shifts[option.shifts.length - 1].endMinutes === blockEnd);
            if (newClosers.length === 0) continue;
            const movesA = optionsFor(empA, date, closer.paidMinutes, day.blocks, partialWeek, weekday, ctx);
            let bestCost = dayCost(onDay, day.blocks, weekday, target, ctx, date);
            let best: Shift[] | undefined;
            for (const optionB of newClosers) for (const optionA of movesA) {
              const cost = dayCost([...rest, ...optionB.shifts, ...optionA.shifts], day.blocks, weekday, target, ctx, date);
              if (cheaper(cost, bestCost, 1e-9)) { best = [...optionB.shifts, ...optionA.shifts]; bestCost = cost; }
            }
            if (best) { onDay = [...rest, ...best]; changed = true; }
          }
        }
      }
      // Move two service shifts together: one-person moves can get stuck when
      // both must move to hand over coverage. Preserve each person's paid time.
      for (const rule of ctx.rules.filter(rule => rule.priority === "coverage" && rule.who)) {
        const members = employees.filter(employee => !employee.fixedShift && (employee.station === "BOTH" || rule.who!(employee)) &&
          onDay.some(shift => shift.employeeId === employee.id));
        for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) {
          const empA = members[a], empB = members[b];
          const ownA = onDay.filter(s => s.employeeId === empA.id);
          const ownB = onDay.filter(s => s.employeeId === empB.id);
          const rest = onDay.filter(s => s.employeeId !== empA.id && s.employeeId !== empB.id);
          const optionsA = optionsFor(empA, date, ownA.reduce((n, s) => n + s.paidMinutes, 0), day.blocks, partialWeek, weekday, ctx);
          const optionsB = optionsFor(empB, date, ownB.reduce((n, s) => n + s.paidMinutes, 0), day.blocks, partialWeek, weekday, ctx);
          let bestCost = dayCost(onDay, day.blocks, weekday, target, ctx, date);
          let best: Shift[] | undefined;
          for (const optionA of optionsA) for (const optionB of optionsB) {
            const candidate = [...rest, ...optionA.shifts, ...optionB.shifts];
            const cost = dayCost(candidate, day.blocks, weekday, target, ctx, date);
            if (cheaper(cost, bestCost)) { best = candidate; bestCost = cost; }
          }
          if (best) { onDay = best; changed = true; }
        }
      }
      if (!changed || !cheaper(dayCost(onDay, day.blocks, weekday, target, ctx, date), baseline)) break;
    }
    output.push(...onDay);
  }
  return output;
}

export function generateWeeklySchedule(input: WeeklyInput, existing: Shift[] = []): Shift[] {
  const ctx: Ctx = {
    minShift: input.rules?.some(r => r.priority === "coverage") ? 60 : 180,
    options: new Map(),
    costs: new Map(),
    stationSubsets: new Map(),
    employeeBits: new Map(input.employees.map((e, i) => [e.id, 1 << i])),
    models: new Map(),
    rules: input.rules ?? STAFFING_RULES,
    weights: input.weights ?? DAY_WEIGHTS,
    demandProfile: input.demandProfile,
    blocked: new Map(Object.entries(input.blockedDays ?? {}).map(([id, dates]) => [id, new Set(dates)])),
    tag: `${input.storeTag ?? "default"}|${JSON.stringify(input.demandProfile ?? null)}`,
    windows: new Map(
      input.employees
        .map((employee) => [employee.id, preferredWindowsOf(employee)] as const)
        .filter(([, windows]) => windows.length > 0),
    ),
    employeesById: new Map(input.employees.map((employee) => [employee.id, employee])),
    holidays: input.holidays ?? publicHolidays(input.year),
  };
  const holidays = input.holidays ?? publicHolidays(input.year);
  const days = new Map(datesOfMonth(input.year, input.month).map((date) => [
    date, resolveDay(input.workHours, date, holidays, input.overrides ?? {}),
  ]));
  const openDates = [...days].filter(([, day]) => !day.closed).map(([date]) => date);
  const byWeek = new Map<string, string[]>();
  for (const date of openDates) {
    const week = weekStartOf(date);
    byWeek.set(week, [...(byWeek.get(week) ?? []), date]);
  }
  const weekInfo = [...byWeek].map(([weekStart, weekDates]) => ({ weekStart, openDays: weekDates.length }));
  const weeks = [...byWeek].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const typeRank = (employee: Employee) => employee.employmentType === "VOLLZEIT" ? 0 : employee.employmentType === "TEILZEIT" ? 1 : 2;
  const hasCoverageObjective = ctx.rules.some(rule => rule.priority === "coverage");
  let balanceTargets: Ctx["balanceTargets"];
  if (hasCoverageObjective && input.demandProfile?.length) {
    const peakLevel = Math.max(...input.demandProfile.map(b => b.level));
    const slots: BalanceSlot[] = [];
    for (const [date, day] of days) {
      if (day.closed) continue;
      const weekday = effectiveWeekdayKey(date, holidays);
      for (const block of day.blocks) for (let minute = block.startMinutes; minute < block.endMinutes; minute += SLOT) {
        slots.push({ date, minute, duration: Math.min(SLOT, block.endMinutes - minute),
          weight: ctx.weights[weekday], peak: workloadAt(minute, weekday, ctx.weights, input.demandProfile) === peakLevel });
      }
    }
    const capacity = { service: 0, kitchen: 0, flexible: 0 };
    for (const e of input.employees) {
      const available = slots.filter(s => mayWorkOn(e, s.date) && !ctx.blocked.get(e.id)?.has(s.date) &&
        (!e.shiftWindow || (s.minute >= e.shiftWindow.startMinutes && s.minute + s.duration <= e.shiftWindow.endMinutes)))
        .reduce((sum, s) => sum + s.duration, 0);
      const quota = Math.floor(monthlyTargetMinutesFor(e, openDates, input.workHours) / SLOT) * SLOT;
      const role = e.station === "KITCHEN" ? "kitchen" : e.station === "BOTH" ? "flexible" : "service";
      capacity[role] += Math.min(quota, available);
    }
    balanceTargets = peakBalanceTargets(slots, capacity);
  }
  const flexibility = (employee: Employee) => {
    const window = employee.shiftWindow;
    return (employee.availableWeekdays?.length ?? 7) * (window ? window.endMinutes - window.startMinutes : 1440);
  };
  const employees = [...input.employees].sort((a, b) =>
    Number(Boolean(b.fixedShift)) - Number(Boolean(a.fixedShift)) ||
    (hasCoverageObjective ? flexibility(a) - flexibility(b) : 0) || typeRank(a) - typeRank(b) || a.id.localeCompare(b.id),
  );
  let result = [...existing];
  const monthDates = [...days.keys()];
  const monthBounds = { first: monthDates[0], last: monthDates[monthDates.length - 1] };
  // Wochenbudget je Person: Wochenvertrag × Anteil der Woche in diesem Monat nach
  // Tagesgewicht (contract.ts) – Randtage am Monatsende werden nicht überbesetzt.
  // Ohne Wochenvertrag: Monats-Soll nach offenen Tagen (ab Eintritt) verteilt.
  const budgets = new Map(employees.map((employee) => {
    if (employee.weeklyHours != null) return [employee.id, weeklyBudgetMinutes(employee, openDates, monthBounds, input.workHours)] as const;
    const empWeekInfo = weekInfo.map((week) => ({
      weekStart: week.weekStart,
      openDays: (byWeek.get(week.weekStart) ?? []).filter((date) => mayWorkOn(employee, date) && !ctx.blocked.get(employee.id)?.has(date)).length,
    }));
    // Full monthly quota, weighted only by dates the employee can work.
    return [employee.id, weeklyTargetMinutes(monthlyTargetMinutesFor(employee, openDates, input.workHours), empWeekInfo)] as const;
  }));
  // Ein Wochenbudget unter der Mindestschichtlänge (Monatsrand: ein oder zwei
  // offene Tage) ergäbe einen 1–2-Stunden-Dienst. Bei einem MONATSvertrag darf
  // dieser Rest in die Nachbarwoche wandern; ein WOCHENvertrag bleibt hart an
  // seiner Woche.
  for (const employee of employees) {
    if (employee.weeklyHours != null) continue;
    const weekly = budgets.get(employee.id)!;
    const order = [...weekly.keys()].sort();
    for (let index = 0; index < order.length; index++) {
      const week = order[index];
      const minutes = weekly.get(week) ?? 0;
      if (minutes <= 0 || minutes >= ctx.minShift) continue;
      const room = (other: string) =>
        (byWeek.get(other)?.length ?? 0) * MAX_PAID - (weekly.get(other) ?? 0);
      const neighbour = [order[index - 1], order[index + 1]]
        .filter((other): other is string => Boolean(other) && room(other) >= minutes)
        .sort((a, b) => room(b) - room(a))[0];
      if (!neighbour) continue;
      weekly.set(neighbour, (weekly.get(neighbour) ?? 0) + minutes);
      weekly.set(week, 0);
    }
  }

  // Tab „Tài liệu": giờ ngày = giờ tuần × (hệ số × phút mở) ÷ Σ(hệ số × phút mở),
  // chuẩn hoá trong từng ISO-week; ngày lễ tính như Chủ nhật (effectiveWeekdayKey).
  const dailyTargets = new Map<string, number>();
  const spreadByWeight = (weekDates: string[], total: number) => {
    const targets = weightedDailyTargets(
      weekDates,
      total,
      (date) => effectiveWeekdayKey(date, holidays),
      (date) => openMinutesOfBlocks(days.get(date)!.blocks),
      ctx.weights,
    );
    for (const [date, hours] of targets) dailyTargets.set(date, hours);
  };
  if (hasCoverageObjective) {
    spreadByWeight(openDates, [...budgets.values()].reduce((sum, weekly) => sum + [...weekly.values()].reduce((a,b) => a+b,0),0) / 60);
  } else {
  for (const [weekStart, weekDates] of byWeek) {
    const weekMinutes = [...budgets.values()].reduce((sum, weekly) => sum + (weekly.get(weekStart) ?? 0), 0);
    spreadByWeight(weekDates, weekMinutes / 60);
  }
  }
  // A flexible-role seed replaces the ordinary seed; do not generate both.
  if (!(hasCoverageObjective && input.employees.some(e => e.station === "BOTH"))) {
  for (const employee of employees) {
    const weekly = budgets.get(employee.id)!;
    for (const [weekStart, weekDates] of weeks) {
      const choices = chooseWeek(employee, weekDates, weekly.get(weekStart) ?? 0, result, days, holidays, dailyTargets, ctx);
      result.push(...choices.flatMap((choice) => choice.option.shifts));
    }
  }
  // Refit to actual available hours (new hires can reduce a week's budget).
  for (const [, weekDates] of hasCoverageObjective ? [] : byWeek) {
    const actual = result.filter((s) => weekDates.includes(s.date)).reduce((sum, s) => sum + s.paidMinutes, 0) / 60;
    spreadByWeight(weekDates, actual);
  }
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [weekStart, weekDates] of weeks) for (const employee of [...employees].reverse()) {
      const own = result.filter((s) => s.employeeId === employee.id && weekStartOf(s.date) === weekStart);
      const paid = own.reduce((sum, s) => sum + s.paidMinutes, 0);
      if (!paid || employee.fixedShift) continue;
      const others = result.filter((s) => !own.includes(s));
      const choices = chooseWeek(employee, weekDates, paid, others, days, holidays, dailyTargets, ctx);
      const next = choices.flatMap((choice) => choice.option.shifts);
      if (next.reduce((sum, s) => sum + s.paidMinutes, 0) !== paid) continue;
      const score = (shifts: Shift[]) => weekDates.reduce((sum, date) => addCost(sum, dayCost(
        [...others.filter((s) => s.date === date), ...shifts.filter((s) => s.date === date)],
        days.get(date)!.blocks, effectiveWeekdayKey(date, holidays), dailyTargets.get(date), ctx, date)), zeroCost());
      if (cheaper(score(next), score(own), 0.01)) {
        result = [...others, ...next];
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Rest-Minuten aus der Wochenrundung noch unterbringen (siehe topUpShortfalls).
  const monthlyTargets = new Map(
    employees.map((employee) => [
      employee.id,
      employee.weeklyHours != null
        ? [...(budgets.get(employee.id)?.values() ?? [])].reduce((sum, minutes) => sum + minutes, 0)
        : monthlyTargetMinutesFor(employee, openDates, input.workHours),
    ] as const),
  );
  // Ein WOCHENvertrag ist eine harte Grenze je Woche; ein Monatsvertrag nicht.
  const weeklyCaps = new Map(
    employees
      .filter((employee) => employee.weeklyHours != null)
      .map((employee) => [employee.id, budgets.get(employee.id)!] as const),
  );
  // Monthly quotas may move between weeks. Re-plan a week with the outstanding
  // minutes, allowing new workdays as well as longer existing shifts.
  for (const employee of employees) {
    if (employee.weeklyHours != null) continue;
    for (const [weekStart, weekDates] of weeks) {
      const total = result.filter(s => s.employeeId === employee.id).reduce((sum, s) => sum + s.paidMinutes, 0);
      const missing = Math.floor(((monthlyTargets.get(employee.id) ?? 0) - total) / SLOT) * SLOT;
      if (missing < SLOT) break;
      const own = result.filter(s => s.employeeId === employee.id && weekStartOf(s.date) === weekStart);
      const paid = own.reduce((sum, s) => sum + s.paidMinutes, 0);
      const others = result.filter(s => !own.includes(s));
      const next = chooseWeek(employee, weekDates, paid + missing, others, days, holidays, dailyTargets, ctx)
        .flatMap(choice => choice.option.shifts);
      if (next.reduce((sum, s) => sum + s.paidMinutes, 0) > paid) result = [...others, ...next];
    }
  }
  result = topUpShortfalls(result, employees, days, holidays, dailyTargets, monthlyTargets, weeklyCaps, ctx);

  result = improveCoverage(result, employees, days, holidays, dailyTargets, ctx);
  } else {
      result = generateWeeklySchedule({ ...input,
        employees: input.employees.map(e => e.station === "BOTH" && !e.ownerSupport ? { ...e, station: "SERVICE" as const } : e),
        rules: ctx.rules.map(rule => rule.priority ? { ...rule, priority: "required" as const } : rule),
      }, existing);
  }
  if (hasCoverageObjective) {
    result = repairMonthlyCoverage(result, employees, days, holidays, dailyTargets, ctx);
    result = improveCoverage(result, employees, days, holidays, dailyTargets, ctx);
    ctx.balanceTargets = balanceTargets;
    ctx.costs.clear();
    result = repairMonthlyCoverage(result, employees, days, holidays, dailyTargets, ctx);
    result = improveCoverage(result, employees, days, holidays, dailyTargets, ctx);
    result = redistributeDurations(result, employees, days, holidays, dailyTargets, ctx);
    result = swapWorkdays(result, employees, days, holidays, dailyTargets, ctx);
    // Remove concentrated surplus without restarting the monthly search.
    // This last transfer pass may change each day's total by at most one slot.
    ctx.peakPolish = true;
    ctx.costs.clear();
    result = redistributeDurations(result, employees, days, holidays, dailyTargets, ctx);
    result = improveCoverage(result, employees, days, holidays, dailyTargets, ctx);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.employeeId.localeCompare(b.employeeId));
}
