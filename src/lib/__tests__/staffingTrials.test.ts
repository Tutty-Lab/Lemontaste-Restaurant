import { afterAll,expect,it } from "vitest";
import { mkdirSync,writeFileSync } from "node:fs";
import type { Employee } from "../../types";
import { initialScheduleFor,STORES } from "../stores";
import { generateSchedule } from "../scheduler";
import { staffingDiagnostics } from "../staffingDiagnostics";
import { validateSchedule } from "../validation";

const trials:{name:string;gap:number;kitchen:number}[]=[];
const changes:[string,string,Partial<Employee>][]=[
 ["Dinh Bien Nguyen: cho phép bắt đầu 14:30 thay vì 18:00, giữ 43h", "lt-dinh-bien",{shiftWindow:{startMinutes:870,endMinutes:1290}}],
 ["Thi Huong Bui: thêm T2, T3, giữ 43h", "lt-thi-huong",{availableWeekdays:["monday","tuesday","friday","saturday","sunday"]}],
 ["Tran Dinh Hoang: tối đa 6 thay vì 5 ngày/tuần, giữ 150h", "lt-moi-b",{maxDaysPerWeek:6}],
];
for(const [name,id,patch] of changes) it(`September trial: ${name}`,()=>{
 const store=STORES[0], initial=initialScheduleFor(store);
 const base={...initial,year:2026,month:9,employees:initial.employees.map(e=>e.id===id?{...e,...patch}:e)};
 const shifts=generateSchedule({...base,rules:store.staffingRules,weights:store.dayWeights,demandProfile:store.demandProfile,storeTag:store.id});
 const report=staffingDiagnostics({...base,shifts});
 trials.push({name,gap:report.serviceGap/60,kitchen:report.kitchenGap/60});
 console.log("Trial",trials[trials.length-1]);
 expect(validateSchedule(base.employees,shifts,2026).errors.filter(e=>e.severity!=="warning")).toEqual([]);
 expect(report.employees.every(e=>e.unassigned===0)).toBe(true);
 if(id==="lt-moi-b") {
  expect(report.serviceGap).toBe(0);
  expect(report.kitchenGap).toBe(0);
 }
},60000);
afterAll(()=>{
 if(!process.env.WRITE_SCHEDULE_REPORT||trials.length!==3) return;
 mkdirSync("reports",{recursive:true});
 writeFileSync("reports/staffing-adjustments.md",[
 "# Phương án đã thử cho khách xác nhận","",
 "Tháng 9/2026, dữ liệu mặc định: lịch gốc còn 4h trống Bồi, 0h trống Bếp. Mỗi dòng dưới chỉ đổi một người; giữ nguyên tổng giờ hợp đồng. Các thử nghiệm không lưu vào dữ liệu khách.","",
 "| Điều chỉnh | Trống Bồi sau thử (h) | Trống Bếp sau thử (h) |","|---|---:|---:|",
 ...trials.map(t=>`| ${t.name} | ${t.gap} | ${t.kitchen} |`),"",
 "Kết quả chỉ xác nhận cho tháng và cấu hình đã thử. Cần khách đồng ý trước khi đổi ngày nghỉ/khung giờ. Không kết luận cấu hình gốc bất khả thi chỉ từ khoảng trống thuật toán.",""
 ].join("\n"));
});
