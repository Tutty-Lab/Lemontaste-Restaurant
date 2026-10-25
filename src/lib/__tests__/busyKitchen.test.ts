import { expect, it } from "vitest";
import { initialScheduleFor, STORES } from "../stores";
import { generateSchedule } from "../scheduler";
import { staffAt } from "../staffing";
import { busyKitchenTarget } from "../coveragePolicy";
import { datesOfMonth } from "../demand";

it("targets two cooks only at Friday–Sunday peaks and preserves service", () => {
  expect(busyKitchenTarget("2026-01-02", 720)).toBe(2);
  expect(busyKitchenTarget("2026-01-02", 660)).toBe(1);
  expect(busyKitchenTarget("2026-01-01", 720)).toBe(1);
});

it("measures busy-day cook coverage and opening service in January", () => {
  const store=STORES[0], base={...initialScheduleFor(store),year:2026,month:1};
  const shifts=generateSchedule({...base,rules:store.staffingRules,weights:store.dayWeights,demandProfile:store.demandProfile,storeTag:store.id});
  const byId=new Map(base.employees.map(e=>[e.id,e]));
  let missing=0, extraOpeningService=0;
  for(const date of datesOfMonth(2026,1)) for(let minute=660;minute<1200;minute+=30) {
    const present=staffAt(shifts.filter(s=>s.date===date),byId,minute);
    if(busyKitchenTarget(date,minute)===2) {
      missing+=Math.max(0,2-present.filter(e=>e.station==="KITCHEN").length)*30;
      expect(present.some(e=>e.station==="SERVICE"),`${date} ${minute}`).toBe(true);
    }
    if(minute<720) extraOpeningService+=Math.max(0,present.filter(e=>e.station==="SERVICE").length-1)*30;
  }
  console.log({busyKitchenMissingHours:missing/60,openingServiceSurplusHours:extraOpeningService/60});
  expect(missing).toBe(0);
  expect(extraOpeningService).toBe(0);
},60000);
