import { useMemo } from "react";
import type { Schedule } from "../types";
import { serviceCoverage } from "../lib/serviceCoverage";
import { minutesToTime } from "../lib/time";

const hours = (minutes: number) => `${(minutes / 60).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} h`;

export function ServiceCoverageReport({ schedule }: { schedule: Schedule }) {
  const report = useMemo(() => serviceCoverage(schedule), [schedule]);
  return <details className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
    <summary className="cursor-pointer font-medium">Bồi: trống {hours(report.emptyMinutes)} · trùng {hours(report.overlapMinutes)} — xem khung giờ thiếu</summary>
    <p className="mt-2">Mở cửa {hours(report.openMinutes)}; định mức Bồi {hours(report.budgetMinutes)}.
      Chỉ xét tổng giờ, phải trống ít nhất {hours(report.budgetLowerBound)}. Đây là cận dưới, chưa tính ngày nghỉ, khung ca, ca liền và Pause; phần còn lại chưa thể kết luận đều do thuật toán.</p>
    <p className="mt-1">Ưu tiên: Bếp suốt giờ mở và Bồi cao điểm; tiếp theo Bồi chuẩn bị 11–12, 17–18; rồi phủ Bồi cả ngày. Chỉ ca liền. Mọi khoảng thiếu vẫn hiện cảnh báo.</p>
    <ul className="mt-2 max-h-64 list-disc overflow-auto pl-5 text-xs">
      {report.gaps.map(gap => <li key={`${gap.date}-${gap.start}`}>
        {gap.date.split("-").reverse().join(".")} {minutesToTime(gap.start)}–{minutesToTime(gap.end)}:
        {gap.unavailable ? " không Bồi nào được phép làm theo ngày/khung ca đã nhập." : " chưa có Bồi; cần xem giới hạn ca, ngày làm và cách xếp."}
      </li>)}
      {!report.gaps.length && <li>Có Bồi suốt giờ mở cửa.</li>}
    </ul>
  </details>;
}
