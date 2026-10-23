import { generateSchedule } from "./scheduler";
import { STORES } from "./stores";
import type { ScheduleRequest, ScheduleResponse } from "./scheduleWorker";

self.onmessage = (event: MessageEvent<ScheduleRequest>) => {
  let response: ScheduleResponse;
  try {
    const store = STORES.find(s => s.id === event.data.storeTag);
    if (!store) throw new Error("Không tìm thấy cấu hình quán.");
    response = { shifts: generateSchedule({ ...event.data, rules: store.staffingRules }) };
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
