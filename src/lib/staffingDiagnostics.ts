import { coverageBoundaries, isRequiredCoverage } from "./coveragePolicy";
import type { Employee, Schedule } from "../types";
import { datesOfMonth, WEEKDAY_SHORT_VI, type WeekdayKey } from "./demand";
import { publicHolidays } from "./holidays";
import { resolveDay } from "./workHours";
import { mayWorkOn } from "./availability";
import { monthlyTargetMinutesFor } from "./contract";
import { coveragePoints, staffAt } from "./staffing";
import { calculatePause } from "./time";
import { weekStartOf } from "./weeks";

const hours=(minutes:number)=>(minutes/60).toLocaleString("vi-VN",{maximumFractionDigits:2})+"h";
const roleOf=(e:Employee)=>e.station==="BOTH"?"Cả 2":e.station==="KITCHEN"?"Bếp":"Bồi";
const weekdays:WeekdayKey[]=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

/** Proven budget bounds are separate from observed scheduling gaps. A bound
 * can prove a shortage; a remaining heuristic gap cannot prove infeasibility. */
export function staffingDiagnostics(schedule:Schedule) {
  const holidays=publicHolidays(schedule.year), overrides=Object.fromEntries(schedule.dateOverrides.map(d=>[d.date,d]));
  const days=datesOfMonth(schedule.year,schedule.month).map(date=>({date,...resolveDay(schedule.workHours,date,holidays,overrides)})).filter(d=>!d.closed);
  const dates=days.map(d=>d.date), byId=new Map(schedule.employees.map(e=>[e.id,e]));
  let openMinutes=0, requiredMinutes=0, serviceGap=0, kitchenGap=0, requiredServiceGap=0, requiredKitchenGap=0;
  const roles=new Map(schedule.employees.map(e=>[e.id,{service:0,kitchen:0}]));
  const gaps:{date:string;start:number;end:number;station:"SERVICE"|"KITCHEN";required:boolean;blockedNames:string[]}[]=[];
  for(const day of days) for(const block of day.blocks) {
    const shifts=schedule.shifts.filter(s=>s.date===day.date);
    const points=[...new Set([...coveragePoints(shifts,block.startMinutes,block.endMinutes), ...coverageBoundaries(block.startMinutes,block.endMinutes)])].sort((a,b)=>a-b);
    for(let i=0;i<points.length-1;i++) {
      const start=points[i],end=points[i+1],duration=end-start;
      openMinutes+=duration;
      const required=isRequiredCoverage(start);
      if(required) requiredMinutes+=duration;
      const present=staffAt(shifts,byId,start);
      for(const e of present) roles.get(e.id)![e.station==="KITCHEN"?"kitchen":"service"]+=duration;
      for(const station of ["SERVICE","KITCHEN"] as const) if(!present.some(e=>(e.station??"SERVICE")===station)) {
        if(station==="SERVICE") { serviceGap+=duration; if(required) requiredServiceGap+=duration; }
        else { kitchenGap+=duration; if(required) requiredKitchenGap+=duration; }
        const eligible=schedule.employees.filter(e=>e.station===station||e.station==="BOTH"||(station==="SERVICE"&&!e.station));
        gaps.push({date:day.date,start,end,station,required,blockedNames:eligible.filter(e=>{
          const w=e.fixedShift??e.shiftWindow;
          return !mayWorkOn(e,day.date)||!!w&&(w.startMinutes>start||w.endMinutes<end);
        }).map(e=>e.name)});
      }
    }
  }
  const employees=schedule.employees.map(employee=>{
    const target=Math.floor(monthlyTargetMinutesFor(employee,dates,schedule.workHours)/30)*30;
    const assigned=schedule.shifts.filter(s=>s.employeeId===employee.id).reduce((sum,s)=>sum+s.paidMinutes,0);
    const weekly=new Map<string,number[]>();
    for(const day of days) {
      if(!mayWorkOn(employee,day.date)) continue;
      const windows=employee.fixedShift?[employee.fixedShift]:day.blocks.map(b=>({startMinutes:Math.max(b.startMinutes,employee.shiftWindow?.startMinutes??0),endMinutes:Math.min(b.endMinutes,employee.shiftWindow?.endMinutes??1440)}));
      const span=Math.max(0,...windows.map(w=>w.endMinutes-w.startMinutes));
      let capacity=0;
      for(let paid=30;paid<=480;paid+=30) if(paid+calculatePause(paid)<=span) capacity=paid;
      const week=weekStartOf(day.date); weekly.set(week,[...(weekly.get(week)??[]),capacity]);
    }
    const capacity=[...weekly.values()].reduce((sum,values)=>sum+values.sort((a,b)=>b-a).slice(0,Math.min(6,employee.maxDaysPerWeek??6)).reduce((a,b)=>a+b,0),0);
    const restrictions:string[]=[];
    if(employee.availableWeekdays?.length) restrictions.push(`chỉ ${employee.availableWeekdays.map(d=>WEEKDAY_SHORT_VI[d]).join(", ")}; có thể mở thêm ${weekdays.filter(d=>!employee.availableWeekdays!.includes(d)).map(d=>WEEKDAY_SHORT_VI[d]).join(", ")}`);
    if(employee.maxDaysPerWeek!=null&&employee.maxDaysPerWeek<6) restrictions.push(`tối đa ${employee.maxDaysPerWeek} ngày/tuần; cân nhắc thêm ngày`);
    if(employee.shiftWindow) restrictions.push("khung ca bị giới hạn; cân nhắc mở rộng giờ được làm");
    if(employee.fixedShift) restrictions.push("ca cố định; cần xác nhận trước khi đổi khung");
    if(employee.unavailableRanges?.length) restrictions.push("có khoảng nghỉ; cân nhắc giảm ngày nghỉ nếu nhân viên đồng ý");
    if(employee.endDate) restrictions.push(`nghỉ việc sau ${employee.endDate}; cần người thay thế từ ngày tiếp theo`);
    if(employee.startDate) restrictions.push(`bắt đầu ${employee.startDate}`);
    return {id:employee.id,name:employee.name,role:roleOf(employee),target,assigned,capacity,
      unassigned:Math.max(0,target-assigned),impossibleQuota:Math.max(0,target-capacity),restrictions,
      ...roles.get(employee.id)!};
  });
  const budget=employees.reduce((sum,e)=>sum+Math.min(e.target,e.capacity),0);
  const pureService=employees.filter(e=>e.role==="Bồi").reduce((sum,e)=>sum+Math.min(e.target,e.capacity),0);
  const pureKitchen=employees.filter(e=>e.role==="Bếp").reduce((sum,e)=>sum+Math.min(e.target,e.capacity),0);
  const flexible=employees.filter(e=>e.role==="Cả 2").reduce((sum,e)=>sum+Math.min(e.target,e.capacity),0);
  const ownerCapacity=schedule.employees.filter(e=>e.ownerSupport).length*requiredMinutes;
  const minimumExtra=Math.max(0,2*requiredMinutes-budget-ownerCapacity,requiredMinutes-pureKitchen-flexible-ownerCapacity,requiredMinutes-pureService-flexible-ownerCapacity);
  const conclusions:string[]=[];
  if(minimumExtra) conclusions.push(`Thiếu ngân sách ít nhất ${hours(minimumExtra)} để có 1 Bồi + 1 Bếp trong khung bắt buộc 11–14h, 17–20h. Đây là cận dưới, còn giới hạn ngày và ca.`);
  if(requiredMinutes>pureKitchen+flexible+ownerCapacity) conclusions.push(`Bếp thiếu ít nhất ${hours(requiredMinutes-pureKitchen-flexible-ownerCapacity)}: tăng giờ người có thể làm Bếp hoặc bổ sung Bếp.`);
  if(requiredMinutes>pureService+flexible+ownerCapacity) conclusions.push(`Bồi thiếu ít nhất ${hours(requiredMinutes-pureService-flexible-ownerCapacity)}: tăng giờ người có thể làm Bồi hoặc bổ sung Bồi.`);
  if(!minimumExtra&&(requiredServiceGap||requiredKitchenGap)) conclusions.push("Tổng ngân sách chưa chứng minh thiếu người. Lịch còn khoảng trống; cần tối ưu tiếp hoặc kiểm tra các giới hạn bên dưới, chưa thể kết luận phải tăng giờ.");
  if(!requiredServiceGap&&!requiredKitchenGap) conclusions.push("Đã phủ ít nhất 1 Bồi và 1 Bếp liên tục 11–14h, 17–20h. Khung 14–17h và sau 20h cho phép còn trống.");
  const adjustments=minimumExtra ? employees.filter(e=>e.target>0 && e.capacity>e.target)
    .sort((a,b)=>Number(b.role==="Cả 2")-Number(a.role==="Cả 2")||(b.capacity-b.target)-(a.capacity-a.target)).slice(0,3)
    .map(e=>`${e.name} (${e.role}): phương án tăng ${hours(Math.min(minimumExtra,e.capacity-e.target))}, từ ${hours(e.target)} lên ${hours(e.target+Math.min(minimumExtra,e.capacity-e.target))}. Đây là lựa chọn thay thế, phải tạo lại để kiểm chứng độ phủ.`) : [];
  return {openMinutes,requiredMinutes,budget,minimumExtra,serviceGap,kitchenGap,requiredServiceGap,requiredKitchenGap,gaps,employees,conclusions,adjustments};
}
