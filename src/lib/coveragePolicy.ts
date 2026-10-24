/** Lemontaste: mandatory staffing; other opening hours are optional coverage. */
export const REQUIRED_COVERAGE = [
  { startMinutes: 660, endMinutes: 840 },
  { startMinutes: 1020, endMinutes: 1200 },
] as const;

export const isRequiredCoverage = (minute: number) =>
  REQUIRED_COVERAGE.some(w => minute >= w.startMinutes && minute < w.endMinutes);

export const coverageBoundaries = (from: number, to: number) =>
  REQUIRED_COVERAGE.flatMap(w => [w.startMinutes, w.endMinutes]).filter(t => t > from && t < to);
