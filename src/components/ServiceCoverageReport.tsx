import { useMemo } from "react";
import type { Schedule } from "../types";
import { serviceCoverage } from "../lib/serviceCoverage";
import { minutesToTime } from "../lib/time";
import { staffingDiagnostics } from "../lib/staffingDiagnostics";

const hours = (minutes: number) => `${(minutes / 60).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} h`;

export function ServiceCoverageReport({ schedule }: { schedule: Schedule }) {
  const report = useMemo(() => serviceCoverage(schedule), [schedule]);
  const diagnosis = useMemo(() => staffingDiagnostics(schedule), [schedule]);
  return <details className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
    <summary className="cursor-pointer font-medium">Bồi: thiếu bắt buộc {hours(report.requiredEmptyMinutes)} · trống cho phép {hours(report.emptyMinutes-report.requiredEmptyMinutes)} · trùng {hours(report.overlapMinutes)} — xem khung giờ thiếu</summary>
    <p className="mt-2">Bắt buộc ít nhất 1 Bồi + 1 Bếp liên tục 11:00–14:00 và 17:00–20:00. Khung 14:00–17:00 và sau 20:00 cho phép thiếu, còn giờ thì phủ thêm. Ngày đông ưu tiên giờ dư; nhân viên chỉ làm cuối tuần được tận dụng trước để người linh hoạt phủ ngày thường.</p>
    <p className="mt-1">Chỉ ca liền. Độ dài ca mong muốn là ưu tiên mềm. Giờ của người chọn Cả 2 chỉ tính một vị trí mỗi thời điểm.</p>
    <div className="mt-3 space-y-1">{diagnosis.conclusions.map(text=><p key={text}>{text}</p>)}</div>
    {diagnosis.adjustments.length>0&&<ul className="mt-2 list-disc pl-5 text-xs">{diagnosis.adjustments.map(text=><li key={text}>{text}</li>)}</ul>}
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">Giờ từng bộ phận, nhân viên cần xem lại cấu hình</summary>
      <p className="mt-2 text-xs">Đề xuất bên dưới cần khách xác nhận, chưa tự đổi giờ hoặc ngày nghỉ. Người Cả 2 chuyển sang Bếp khi không có Bếp khác, còn lại làm Bồi; giờ nghỉ không tính nhân sự.</p>
      <div className="mt-2 overflow-auto"><table className="min-w-[650px] text-xs">
        <thead><tr><th className="p-1 text-left">Nhân viên</th><th>Định mức</th><th>Đã xếp Bồi</th><th>Đã xếp Bếp</th><th className="p-1 text-left">Cần xem lại khi còn thiếu</th></tr></thead>
        <tbody>{diagnosis.employees.map(e=><tr key={e.id} className="border-t border-amber-200">
          <td className="p-1">{e.name} · {e.role}</td><td className="p-1">{hours(e.target)}</td><td className="p-1">{hours(e.service)}</td><td className="p-1">{hours(e.kitchen)}</td>
          <td className="p-1">{e.impossibleQuota>0&&<strong>Không đủ ngày/khung ca để xếp ít nhất {hours(e.impossibleQuota)} giờ hợp đồng. </strong>}{e.restrictions.join("; ") || "Không có giới hạn riêng cần nới."}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
    <ul className="mt-2 max-h-64 list-disc overflow-auto pl-5 text-xs">
      {report.gaps.map(gap => <li key={`${gap.date}-${gap.start}`}>
        {gap.required ? "Bắt buộc — " : "Cho phép trống — "}{gap.date.split("-").reverse().join(".")} {minutesToTime(gap.start)}–{minutesToTime(gap.end)}:
        {gap.unavailable ? " không Bồi nào được phép làm theo ngày/khung ca đã nhập." : gap.required ? " chưa có Bồi; cần xem giới hạn ca, ngày làm và cách xếp." : " chưa có Bồi trong khung tùy chọn."}
      </li>)}
      {!report.gaps.length && <li>Có Bồi suốt giờ mở cửa.</li>}
    </ul>
  </details>;
}
