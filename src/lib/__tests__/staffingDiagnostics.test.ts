import { expect,it } from "vitest";
import { staffingDiagnostics } from "../staffingDiagnostics";
import { initialScheduleFor,STORES } from "../stores";

it("proves December's 21-hour shortage after the cook leaves",()=>{
 const report=staffingDiagnostics({...initialScheduleFor(STORES[0]),year:2026,month:12});
 expect(report.budget).toBe(630*60);
 expect(report.minimumExtra).toBe(21*60);
 expect(report.employees.find(e=>e.id==="lt-van-diep")?.target).toBe(0);
});
it("does not double-count flexible capacity or claim gaps prove infeasibility",()=>{
 const report=staffingDiagnostics({...initialScheduleFor(STORES[0]),year:2026,month:10});
 expect(report.budget).toBe(723*60);
 expect(report.minimumExtra).toBe(0);
 expect(report.conclusions.join(" ")).toContain("chưa thể kết luận phải tăng giờ");
 expect(report.employees.find(e=>e.id==="lt-dinh-bien")?.restrictions.join(" ")).toContain("khung ca");
});
