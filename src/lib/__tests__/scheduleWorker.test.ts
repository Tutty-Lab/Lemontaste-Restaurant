import { afterEach, expect, it, vi } from "vitest";
import { generateScheduleInWorker, type ScheduleResponse } from "../scheduleWorker";
import { initialScheduleFor, STORES } from "../stores";

afterEach(() => vi.unstubAllGlobals());

function setup(response: ScheduleResponse | "crash") {
  const terminate = vi.fn();
  let request: unknown;
  vi.stubGlobal("Worker", class {
    onmessage?: (event: { data: ScheduleResponse }) => void;
    onerror?: (event: { message: string }) => void;
    terminate = terminate;
    postMessage(input: unknown) {
      request = structuredClone(input);
      queueMicrotask(() => response === "crash" ? this.onerror?.({ message: "worker failed" }) : this.onmessage?.({ data: response }));
    }
  });
  return { terminate, request: () => request };
}

const input = { ...initialScheduleFor(STORES[0]), storeTag: STORES[0].id };

it("returns the worker result asynchronously and releases the worker", async () => {
  const mock = setup({ shifts: [] });
  await expect(generateScheduleInWorker(input)).resolves.toEqual([]);
  expect(mock.request()).toMatchObject({ storeTag: "lemontaste", employees: input.employees });
  expect(mock.terminate).toHaveBeenCalledOnce();
});

it("reports scheduler failures without saving an empty replacement plan", async () => {
  const mock = setup({ error: "invalid plan" });
  await expect(generateScheduleInWorker(input)).rejects.toThrow("invalid plan");
  expect(mock.terminate).toHaveBeenCalledOnce();
});

it("reports worker load failures and releases the worker", async () => {
  const mock = setup("crash");
  await expect(generateScheduleInWorker(input)).rejects.toThrow("worker failed");
  expect(mock.terminate).toHaveBeenCalledOnce();
});
