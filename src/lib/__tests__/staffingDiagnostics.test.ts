import { expect,it } from "vitest";
import { staffingDiagnostics } from "../staffingDiagnostics";
import { initialScheduleFor,STORES } from "../stores";

it("allows optional gaps in December without claiming extra mandatory hours",()=>{
 const report=staffingDiagnostics({...initialScheduleFor(STORES[0]),year:2026,month:12});
 expect(report.budget).toBe(630*60);
 expect(report.minimumExtra).toBe(0);
 expect(report.requiredMinutes).toBe(31*6*60);
 expect(report.requiredServiceGap).toBe(report.requiredMinutes);
 expect(report.requiredKitchenGap).toBe(report.requiredMinutes);
 expect(report.gaps.some(g=>!g.required)).toBe(true);
 expect(report.employees.find(e=>e.id==="lt-van-diep")?.target).toBe(0);
});
it("does not double-count flexible capacity or claim gaps prove infeasibility",()=>{
 const report=staffingDiagnostics({...initialScheduleFor(STORES[0]),year:2026,month:10});
 expect(report.budget).toBe(723*60);
 expect(report.minimumExtra).toBe(0);
 expect(report.conclusions.join(" ")).toContain("chưa thể kết luận phải tăng giờ");
 expect(report.employees.find(e=>e.id==="lt-dinh-bien")?.restrictions.join(" ")).toContain("khung ca");
});
