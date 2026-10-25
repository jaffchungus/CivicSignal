import { afterEach, describe, expect, it, vi } from "vitest";

import { clearDraftPhoto, loadDraftPhoto, saveDraftPhoto } from "../src/lib/report-photo-draft";

type Handler = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

/** Minimal in-memory IndexedDB covering the operations the draft store uses. */
function fakeIndexedDb() {
  const stores = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => { stores.set(name, new Map()); },
    transaction(name: string) {
      const store = stores.get(name);
      if (!store) throw new Error(`Missing object store ${name}`);
      const transaction = {
        oncomplete: null as Handler,
        onerror: null as Handler,
        onabort: null as Handler,
        objectStore() {
          return {
            get(key: string) {
              const request = new FakeRequest<unknown>();
              queueMicrotask(() => {
                request.result = store.get(key);
                request.onsuccess?.();
                transaction.oncomplete?.();
              });
              return request;
            },
            put(value: unknown, key: string) {
              store.set(key, value);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            delete(key: string) {
              store.delete(key);
              queueMicrotask(() => transaction.oncomplete?.());
            },
          };
        },
      };
      return transaction;
    },
  };

  return {
    open() {
      const request = new FakeRequest<typeof database>();
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("report photo drafts", () => {
  it("round-trips a selected photo through IndexedDB and clears it", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb());

    const file = new File(["image-bytes"], "issue.png", {
      type: "image/png",
      lastModified: 1_700_000_000_000,
    });
    await saveDraftPhoto("guest", file);

    const restored = await loadDraftPhoto("guest");
    expect(restored).toBeInstanceOf(File);
    expect(restored?.name).toBe("issue.png");
    expect(restored?.type).toBe("image/png");
    expect(restored?.size).toBe(file.size);
    expect(restored?.lastModified).toBe(1_700_000_000_000);

    await clearDraftPhoto("guest");
    await expect(loadDraftPhoto("guest")).resolves.toBeNull();
  });
});
