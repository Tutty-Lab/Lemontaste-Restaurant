import { afterAll, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { initialScheduleFor, STORES } from "../stores";
import { generateSchedule } from "../scheduler";
import { staffingDiagnostics } from "../staffingDiagnostics";
import { validateSchedule } from "../validation";
import { datesOfMonth } from "../demand";

const results:{month:number;seconds:number;report:ReturnType<typeof staffingDiagnostics>}[]=[];
for(let month=1;month<=12;month++) it(`Lemontaste 2026/${month}: quotas, rest, breaks and real coverage`,()=>{
  const store=STORES[0], base={...initialScheduleFor(store),year:2026,month};
  const start=performance.now();
  const shifts=generateSchedule({...base,rules:store.staffingRules,weights:store.dayWeights,demandProfile:store.demandProfile,storeTag:store.id});
  const seconds=(performance.now()-start)/1000, report=staffingDiagnostics({...base,shifts});
  results.push({month,seconds,report});
  console.log(`Month ${month}: ${seconds.toFixed(2)}s; ${report.budget/60}h budget; gaps service ${report.serviceGap/60}h, kitchen ${report.kitchenGap/60}h; bound ${report.minimumExtra/60}h`);
  expect(validateSchedule(base.employees,shifts,2026,datesOfMonth(2026,month),base.workHours).errors.filter(e=>e.severity!=="warning")).toEqual([]);
  expect(new Set(shifts.map(s=>`${s.employeeId}/${s.date}`)).size).toBe(shifts.length);
  for(const e of report.employees) {
    expect(e.assigned,`${e.name} quota`).toBeLessThanOrEqual(e.target);
    expect(e.unassigned,`${e.name} missing contractual hours`).toBe(0);
  }
  if(month<=10) {
    expect(report.kitchenGap).toBe(0);
    // Observed unresolved gaps remain in the report. These ceilings prevent
    // regressions; they do not assert that all twelve plans have full coverage.
    const serviceCeilings=[150,90,30,150,90,180,60,90,240,0];
    expect(report.serviceGap).toBeLessThanOrEqual(serviceCeilings[month-1]);
  }
},60000);

afterAll(()=>{
  if(!process.env.WRITE_SCHEDULE_REPORT || results.length!==12) return;
  mkdirSync("reports",{recursive:true});
  writeFileSync("reports/lemontaste-2026.json",JSON.stringify(results,null,2));
  const h=(minutes:number)=>(minutes/60).toFixed(2);
  const rows=results.map(({month,seconds,report:r})=>`| ${month} | ${h(r.budget)} | ${h(r.serviceGap)} | ${h(r.kitchenGap)} | ${h(r.minimumExtra)} | ${seconds.toFixed(2)} |`);
  const last=results.find(r=>r.month===10)?.report;
  writeFileSync("reports/lemontaste-2026.md",[
    "# Kiểm thử lịch Lemontaste năm 2026","","Dữ liệu mặc định 8 nhân viên. Van Diep Mai nghỉ việc sau 31/10/2026. Giờ theo lưới 30 phút; 14,39h làm tròn xuống 14h. Thời gian đo trên máy local, chưa gồm tải trang.","",
    "| Tháng | Ngân sách giờ | Trống Bồi (h) | Trống Bếp (h) | Giờ cần thêm ít nhất | Tạo lịch (giây) |","|---|---:|---:|---:|---:|---:|",...rows,"",
    "Khoảng trống thực tế không phải bằng chứng cấu hình bất khả thi. Chỉ cận dưới ngân sách chứng minh cần thêm giờ; còn giới hạn ngày, ca và phân bổ bộ phận.","",
    "## Nhân viên cần khách xác nhận khi còn khoảng trống","",
    ...(last?.employees.filter(e=>e.restrictions.length).map(e=>`- **${e.name} (${e.role}, ${h(e.target)}h/tháng):** ${e.restrictions.join("; ")}.` )??[]),"",
    "Độ dài ca mong muốn là luật mềm. Tối đa 8 giờ công/ngày, tối đa 6 ngày liên tiếp, nghỉ giải lao và ngày nghỉ đã nhập được giữ. Không tự tăng giờ hợp đồng hoặc giảm ngày nghỉ. Người Cả 2 chỉ tính một vị trí ở mỗi thời điểm.","",
    ...results.filter(r=>r.report.serviceGap||r.report.kitchenGap).map(({month,report:r})=>`## Tháng ${month}\n\n${r.conclusions.join("\n\n")}\n\n${r.adjustments.join("\n\n")}\n\n${r.gaps.map(g=>`- ${g.date} ${Math.floor(g.start/60)}:${String(g.start%60).padStart(2,"0")}–${Math.floor(g.end/60)}:${String(g.end%60).padStart(2,"0")}: thiếu ${g.station==="SERVICE"?"Bồi":"Bếp"}.`).join("\n")}`),""
  ].join("\n"));
});
