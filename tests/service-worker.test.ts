// @vitest-environment node

import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/sw.js");

type WorkerFetchEvent = {
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response>) => void;
};

it("retries an asset fetch when a response body cannot be cloned for caching", async () => {
  const listeners = new Map<string, (event: WorkerFetchEvent) => void>();
  const consumedResponse = new Response("consumed");
  await consumedResponse.text();
  const freshResponse = new Response("fresh bundle");
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(consumedResponse)
    .mockResolvedValueOnce(freshResponse);
  const context = {
    self: {
      location: { origin: "https://civicsignal.test" },
      addEventListener: (type: string, listener: (event: WorkerFetchEvent) => void) => listeners.set(type, listener),
      skipWaiting: vi.fn(),
      clients: {},
    },
    caches: {
      match: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
    },
    fetch: fetchMock,
    URL,
    Response,
  };
  vm.runInNewContext(readFileSync(workerPath, "utf8"), context);

  const waitUntilPromises: Promise<unknown>[] = [];
  let responsePromise: Promise<Response> | undefined;
  listeners.get("fetch")?.({
    request: new Request("https://civicsignal.test/assets/app.js", { mode: "cors" }),
    waitUntil: (promise: Promise<unknown>) => waitUntilPromises.push(promise),
    respondWith: (promise: Promise<Response>) => { responsePromise = promise; },
  });

  const response = await responsePromise;
  await expect(response?.text()).resolves.toBe("fresh bundle");
  await Promise.all(waitUntilPromises);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
