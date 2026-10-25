import type { Employee, Schedule, Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToDecimalHours, minutesToTime } from "../lib/time";
import { MONTH_NAMES_DE } from "../lib/dateFormat";
import { publicHolidayNames } from "../lib/holidays";
import { format } from "date-fns";
import { hourStatsFor } from "../lib/surchargeHours";
import { employmentLabelDe } from "../lib/employment";

// Deutscher Monats-Titel für das offizielle Dokument.
function monthLabelDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

/**
 * Ein A4-freundlicher Stundenzettel für einen Mitarbeiter.
 * Wird sowohl für die Bildschirm-Vorschau als auch für den Druck verwendet.
 */
export function StundenzettelPage({
  schedule,
  employee,
  dates,
  periodLabel,
}: {
  schedule: Schedule;
  employee: Employee;
  /** Nur diese Tage zeigen (Wochen-Stundenzettel); fehlend => ganzer Monat. */
  dates?: string[];
  /** Zeitraum-Text oben rechts; fehlend => Monat/Jahr. */
  periodLabel?: string;
}) {
  const rows = dates ?? datesOfMonth(schedule.year, schedule.month);
  // MEHRERE Dienste je Tag: wer mittags und abends arbeitet, hat zwei. Vorher
  // stand hier eine Map auf EINEN Dienst – der zweite fiel lautlos aus dem
  // Stundenzettel, und damit aus der Lohnabrechnung.
  const byDate = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    if (s.employeeId !== employee.id) continue;
    const liste = byDate.get(s.date);
    if (liste) liste.push(s);
    else byDate.set(s.date, [s]);
  }
  for (const liste of byDate.values()) liste.sort((a, b) => a.startMinutes - b.startMinutes);

  const holidayNames = publicHolidayNames(schedule.year);
  const closedByDate = new Map(
    schedule.dateOverrides.filter((o) => o.closed).map((o) => [o.date, o] as const),
  );

  return (
    <div className="stundenzettel-page bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Stundenaufzeichnung</h2>
          <p className="text-slate-600">{schedule.companyName || "—"}</p>
          {schedule.address && <p className="text-slate-500 text-[11px]">{schedule.address}</p>}
        </div>
        <div className="text-right text-slate-600">
          <div>{periodLabel ?? monthLabelDe(schedule.year, schedule.month)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-3">
        <Info label="Firmenname" value={schedule.companyName || "—"} />
        <Info label="Beschäftigungsart" value={employmentLabelDe(employee.employmentType)} />
        <Info label="Mitarbeiter" value={employee.name} />
        <Info label="Monat" value={MONTH_NAMES_DE[schedule.month - 1]} />
        <Info label="Jahr" value={String(schedule.year)} />
      </div>

      <table className="stundenzettel-table w-full text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            <Th>Datum / Wochentag</Th>
            <Th>Arbeitsbeginn</Th>
            <Th>Arbeitsende</Th>
            <Th>Pause</Th>
            <Th>Arbeitszeit</Th>
            <Th className="text-left">Bemerkung</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const dienste = [...(byDate.get(d) ?? [])].sort(
              (a, b) => a.startMinutes - b.startMinutes,
            );
            const wd = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
            const holiday = holidayNames.get(d);
            const closed = closedByDate.get(d);
            const isWeekend = wd === "Samstag" || wd === "Sonntag";
            const rowCls = isWeekend || holiday || closed ? "bg-slate-50" : "";
            const datum = format(parseIsoDate(d), "dd.MM.yyyy");

            if (dienste.length === 0) {
              const bemerkung = closed
                ? closed.note || "Betriebsruhe"
                : holiday
                  ? `Frei (Feiertag: ${holiday})`
                  : "Frei";
              return (
                <tr key={d} className={rowCls}>
                  <Td className="whitespace-nowrap align-middle">
                    <div className="font-semibold text-slate-800">{datum}</div>
                    <div className="text-slate-500">{wd}</div>
                  </Td>
                  <Td className="text-center" />
                  <Td className="text-center" />
                  <Td className="text-center" />
                  <Td className="text-center">0,00</Td>
                  <Td className="text-left text-slate-500">{bemerkung}</Td>
                </tr>
              );
            }

            if (dienste.length === 1) {
              const x = dienste[0];
              return (
                <tr key={d} className={rowCls}>
                  <Td className="whitespace-nowrap align-middle">
                    <div className="font-semibold text-slate-800">{datum}</div>
                    <div className="text-slate-500">{wd}</div>
                  </Td>
                  <Td className="text-center font-medium align-middle">{minutesToTime(x.startMinutes)}</Td>
                  <Td className="text-center font-medium align-middle">{minutesToTime(x.endMinutes)}</Td>
                  <Td className="text-center align-middle">{x.pauseMinutes} Min</Td>
                  <Td className="text-center font-medium align-middle">{minutesToDecimalHours(x.paidMinutes)}</Td>
                  <Td className="text-left text-slate-500 align-middle">
                    {holiday ? `Feiertag: ${holiday}` : ""}
                  </Td>
                </tr>
              );
            }

            // Ngày có từ 2 ca trở lên (ví dụ: thứ 3 làm ca sáng và ca chiều):
            // Giữ nguyên 1 dòng cho ngày đó, các ô ca được kẻ vạch phân tách rõ ràng.
            return (
              <tr key={d} className={rowCls}>
                <Td className="whitespace-nowrap align-middle">
                  <div className="font-semibold text-slate-800">{datum}</div>
                  <div className="text-slate-500">{wd}</div>
                </Td>
                <Td noPadding className="text-center font-medium align-middle">
                  {dienste.map((x, i) => (
                    <div
                      key={i}
                      className={`py-[3px] px-2 ${i > 0 ? "border-t border-slate-300 shift-split-divider" : ""}`}
                    >
                      {minutesToTime(x.startMinutes)}
                    </div>
                  ))}
                </Td>
                <Td noPadding className="text-center font-medium align-middle">
                  {dienste.map((x, i) => (
                    <div
                      key={i}
                      className={`py-[3px] px-2 ${i > 0 ? "border-t border-slate-300 shift-split-divider" : ""}`}
                    >
                      {minutesToTime(x.endMinutes)}
                    </div>
                  ))}
                </Td>
                <Td noPadding className="text-center align-middle">
                  {dienste.map((x, i) => (
                    <div
                      key={i}
                      className={`py-[3px] px-2 ${i > 0 ? "border-t border-slate-300 shift-split-divider" : ""}`}
                    >
                      {x.pauseMinutes} Min
                    </div>
                  ))}
                </Td>
                <Td noPadding className="text-center font-medium align-middle">
                  {dienste.map((x, i) => (
                    <div
                      key={i}
                      className={`py-[3px] px-2 ${i > 0 ? "border-t border-slate-300 shift-split-divider" : ""}`}
                    >
                      {minutesToDecimalHours(x.paidMinutes)}
                    </div>
                  ))}
                </Td>
                <Td noPadding className="text-left text-slate-500 align-middle">
                  {dienste.map((_, i) => (
                    <div
                      key={i}
                      className={`py-[3px] px-2 ${i > 0 ? "border-t border-slate-300 shift-split-divider" : ""}`}
                    >
                      {i === 0 && holiday ? `Feiertag: ${holiday}` : "\u00A0"}
                    </div>
                  ))}
                </Td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold bg-slate-100">
            <Td className="text-left" colSpan={4}>
              Gesamtstunden
            </Td>
            <Td className="text-center">{" "}</Td>
            <Td />
          </tr>
        </tfoot>
      </table>

      <div className="mt-3 text-[12px]">
        <div className="text-slate-500">Gesamtstunden</div>
        <BlankLine />
      </div>

      <div className="mt-10 grid grid-cols-3 gap-8 text-[11px]">
        <Signature label="Unterschrift Mitarbeiter" />
        <Signature label="Unterschrift Arbeitgeber" />
        <Signature label="Datum" />
      </div>
    </div>
  );
}

/** `blank` = Feld zum Ausfüllen von Hand statt eines gedruckten Werts. */
function Info({ label, value, blank }: { label: string; value?: string; blank?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 min-w-[110px]">{label}:</span>
      {blank ? (
        <span className="flex-1 border-b border-slate-400" />
      ) : (
        <span className="font-medium">{value}</span>
      )}
    </div>
  );
}

/** Leere Schreiblinie – markiert ein Feld, das von Hand ergänzt wird. */
function BlankLine() {
  return <div className="border-b border-slate-400 h-[1.2em] w-full max-w-[80px]" />;
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-1 text-center font-semibold ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
  noPadding,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
  noPadding?: boolean;
}) {
  return (
    <td colSpan={colSpan} className={`${noPadding ? "p-0" : "px-2 py-[2px]"} ${className}`}>
      {children}
    </td>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <div>
      <div className="border-t border-slate-500 pt-1 mt-8 text-slate-600">{label}</div>
    </div>
  );
}

export function StundenUebersichtPage({
  schedule,
  employees,
  dates,
  periodLabel,
}: {
  schedule: Schedule;
  employees: readonly Employee[];
  dates?: string[];
  periodLabel?: string;
}) {
  const days = dates ?? datesOfMonth(schedule.year, schedule.month);
  const rows = employees.map((employee) => ({ employee, stats: hourStatsFor(schedule.shifts, employee.id, days) }));
  const sum = rows.reduce(
    (acc, { stats }) => ({ total: acc.total + stats.total, night: acc.night + stats.night, sunday: acc.sunday + stats.sunday }),
    { total: 0, night: 0, sunday: 0 },
  );
  const num = "px-2 py-1.5 text-right tabular-nums";
  return (
    <div className="stundenzettel-page bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Stundenübersicht</h2>
          <p className="text-slate-600">{schedule.companyName || "—"}</p>
          {schedule.address && <p className="text-slate-500 text-[11px]">{schedule.address}</p>}
        </div>
        <div className="text-right text-slate-600">{periodLabel ?? monthLabelDe(schedule.year, schedule.month)}</div>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-slate-100 border-b border-slate-600">
            <th className="px-2 py-1.5 text-left font-semibold">Mitarbeiter</th>
            <th className={`${num} font-semibold`}>Gesamtstunden</th>
            <th className={`${num} font-semibold`}>Nachtstunden (ab 20 Uhr)</th>
            <th className={`${num} font-semibold`}>Sonntagsstunden</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ employee, stats }) => (
            <tr key={employee.id} className="border-b border-slate-200">
              <td className="px-2 py-1.5">{employee.name}</td>
              <td className={num}>{minutesToDecimalHours(stats.total)}</td>
              <td className={num}>{minutesToDecimalHours(stats.night)}</td>
              <td className={num}>{minutesToDecimalHours(stats.sunday)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-600 font-semibold">
            <td className="px-2 py-1.5">Summe</td>
            <td className={num}>{minutesToDecimalHours(sum.total)}</td>
            <td className={num}>{minutesToDecimalHours(sum.night)}</td>
            <td className={num}>{minutesToDecimalHours(sum.sunday)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-[10px] text-slate-500">
        Nachtstunden: bezahlte Arbeitszeit ab 20:00 Uhr (ohne Pause), ohne Sonntage. Sonntagsstunden: gesamte
        bezahlte Arbeitszeit an Sonntagen (nicht doppelt als Nacht gezählt). Angaben in Stunden.
      </p>
    </div>
  );
}
