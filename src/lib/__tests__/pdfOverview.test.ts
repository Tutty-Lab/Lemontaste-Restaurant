import { mkdirSync, writeFileSync } from "node:fs";
import { weeksOfMonth } from "../weeks";
import { expect, it } from "vitest";
import { buildStundenzettelPdfFor } from "../pdf";
import { hourStatsFor } from "../surchargeHours";
import { initialScheduleFor, STORES } from "../stores";
import type { Shift } from "../../types";
it("prepends one overview before each store's individual sheets", async () => {
 const schedule = initialScheduleFor(STORES[0]);
 const employees = schedule.employees.slice(0,1);
 const doc = await buildStundenzettelPdfFor([{ schedule, employees }, { schedule, employees }]);
 expect(doc.getNumberOfPages()).toBe(4);
 const pages = doc.internal.pages as unknown as string[][];
 expect(pages[1].join(" ")).toContain("Stunden");
 expect(pages[1].join(" ")).toContain("Gesamtstunden");
 expect(pages[3].join(" ")).toContain("Gesamtstunden");
 const text=pages.flat().join(" ");
 expect(text).not.toContain("Parameterblatt");
 expect(text).not.toContain("Sollstunden");
 expect(text).not.toContain("Differenz");
});
it("excludes pauses and avoids counting Sunday hours again as night hours", () => {
 const shift: Shift = { id:"s", employeeId:"e", date:"2026-10-04", startMinutes:1080, endMinutes:1290, paidMinutes:180, pauseMinutes:30, pauseStartMinutes:1200, shiftType:"LATE", generated:true };
 expect(hourStatsFor([shift],"e",[shift.date])).toEqual({ total:180, night:0, sunday:180 });
 expect(hourStatsFor([{...shift,date:"2026-10-05"}],"e",["2026-10-05"])).toEqual({ total:180, night:60, sunday:0 });
});

it("prints only selected weekly dates without parameter or contract fields", async () => {
 const schedule={...initialScheduleFor(STORES[0]),year:2026,month:10};
 const week=weeksOfMonth(2026,10)[1];
 const doc=await buildStundenzettelPdfFor([{schedule,employees:schedule.employees.slice(0,1)}],{dates:week.dates,periodLabel:`Woche ${week.label}`});
 expect(doc.getNumberOfPages()).toBe(2);
 const text=(doc.internal.pages as unknown as string[][]).flat().join(" ");
 expect(text).toContain("Woche");
 expect(text).not.toContain("Parameterblatt");
 expect(text).not.toContain("Sollstunden");
 expect(text).not.toContain("Differenz");
 if(process.env.WRITE_PDF_SAMPLE) { mkdirSync("tmp/pdfs",{recursive:true}); writeFileSync("tmp/pdfs/weekly-timesheet.pdf",Buffer.from(doc.output("arraybuffer"))); }
});
