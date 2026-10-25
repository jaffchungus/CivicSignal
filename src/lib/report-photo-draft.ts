// Selected report photos are too large for localStorage, so drafts keep them
// in IndexedDB. Every operation degrades to a no-op when storage is blocked or
// unavailable; a draft is a convenience, never a requirement for submitting.

const DATABASE_NAME = "civicsignal-report-drafts";
const STORE_NAME = "photos";
const DATABASE_VERSION = 1;

type StoredPhoto = {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

let databasePromise: Promise<IDBDatabase | null> | undefined;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function database(): Promise<IDBDatabase | null> {
  databasePromise ??= openDatabase();
  return databasePromise;
}

export async function loadDraftPhoto(key: string): Promise<File | null> {
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const stored = request.result as Partial<StoredPhoto> | undefined;
        if (!stored?.blob) {
          resolve(null);
          return;
        }
        try {
          resolve(new File([stored.blob], stored.name || "issue-photo", {
            type: stored.type || stored.blob.type,
            lastModified: typeof stored.lastModified === "number"
              ? stored.lastModified
              : Date.now(),
          }));
        } catch {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveDraftPhoto(key: string, file: File): Promise<void> {
  const db = await database();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        blob: file,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
      } satisfies StoredPhoto, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearDraftPhoto(key: string): Promise<void> {
  const db = await database();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
