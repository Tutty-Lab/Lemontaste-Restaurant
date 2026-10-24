import type { ScheduleAnalysis } from "../lib/analyze";
import { WEEKDAY_SHORT_VI } from "../lib/demand";
import { minutesToTime } from "../lib/time";
import { ruleById, staffingRuleId } from "../lib/rules";

function hours(value: number) {
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h`;
}

export function StaffingReport({ analysis }: { analysis: ScheduleAnalysis }) {
  const open = analysis.days.filter((day) => !day.closed);
  const gaps = open.flatMap((day) => day.peaks.filter((peak) => !peak.ok && ruleById(staffingRuleId(peak.label)).kind === "hard").map((peak) => ({ day, peak })));

  return (
    <details className={`mb-3 rounded-lg border px-3 py-2 text-sm ${gaps.length
      ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
      <summary className="cursor-pointer font-medium">
        {gaps.length ? `${gaps.length} khung bắt buộc thiếu/thừa nhân sự` : "Đã phủ các khung bắt buộc 11–14h, 17–20h"}
        <span className="ml-2 text-xs font-normal">Xem hệ số 1,5 và nhân sự theo giờ</span>
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[650px] border-collapse text-xs">
          <thead><tr><th className="border px-2 py-1 text-left">Ngày</th><th className="border px-2 py-1">Giờ mục tiêu</th><th className="border px-2 py-1">Giờ đã xếp</th><th className="border px-2 py-1 text-left">Kiểm tra nhân sự</th></tr></thead>
          <tbody>{open.map((day) => <tr key={day.date}>
            <td className="border px-2 py-1">{day.date.split("-").reverse().join(".")} · {WEEKDAY_SHORT_VI[day.weekday]}</td>
            <td className="border px-2 py-1 text-right">{hours(day.targetHours)}</td>
            <td className="border px-2 py-1 text-right">{hours(day.paidHours)}</td>
            <td className="border px-2 py-1">{day.peaks.map((peak) =>
              <span key={`${peak.label}-${peak.startMinutes}`} className={peak.ok ? "mr-2 text-emerald-800" : ruleById(staffingRuleId(peak.label)).kind === "hard" ? "mr-2 font-medium text-rose-700" : "mr-2 text-amber-800"}>
                {peak.label} {minutesToTime(peak.startMinutes)}–{minutesToTime(peak.endMinutes)}: {peak.minStaff}–{peak.maxStaff} / {ruleById(staffingRuleId(peak.label)).kind === "hard" ? "cần" : "ưu tiên"} {peak.required}{Number.isFinite(peak.allowed) ? `–${peak.allowed}` : "+"}
              </span>)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
