import type { Shift } from "../types";
import type { GenerateInput } from "./scheduler";

export type ScheduleRequest = Omit<GenerateInput, "rules">;
export type ScheduleResponse = { shifts: Shift[]; error?: never } | { error: string; shifts?: never };

/** Run CPU-heavy planning off the UI thread. Rules contain functions, so the
 * worker loads the store's rules itself instead of trying to clone them. */
export function generateScheduleInWorker(input: ScheduleRequest): Promise<Shift[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./scheduler.worker.ts", import.meta.url), { type: "module" });
    const fail = (error: Error) => { worker.terminate(); reject(error); };
    worker.onmessage = (event: MessageEvent<ScheduleResponse>) => {
      worker.terminate();
      if (event.data.error !== undefined) reject(new Error(event.data.error));
      else resolve(event.data.shifts);
    };
    worker.onerror = event => fail(new Error(event.message || "Không thể tạo lịch."));
    worker.onmessageerror = () => fail(new Error("Không đọc được kết quả tạo lịch."));
    try { worker.postMessage(input); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}
