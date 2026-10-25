/** Lemontaste: mandatory staffing; other opening hours are optional coverage. */
export const REQUIRED_COVERAGE = [
  { startMinutes: 660, endMinutes: 840 },
  { startMinutes: 1020, endMinutes: 1200 },
] as const;

export const isRequiredCoverage = (minute: number) =>
  REQUIRED_COVERAGE.some(w => minute >= w.startMinutes && minute < w.endMinutes);

export const coverageBoundaries = (from: number, to: number) =>
  REQUIRED_COVERAGE.flatMap(w => [w.startMinutes, w.endMinutes]).filter(t => t > from && t < to);

/** Two cooks at actual Friday–Sunday peaks; always preserve baseline service. */
export function busyKitchenTarget(date: string | undefined, minute: number): number {
  if (!date) return 1;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 || day >= 5) && ((minute >= 720 && minute < 840) || (minute >= 1080 && minute < 1200)) ? 2 : 1;
}
