const fallback = new Map<string, string>();
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("runsun-object-content", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("objects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function putObject(key: string, content: string) {
  if (typeof indexedDB === "undefined") {
    fallback.set(key, content);
    return;
  }
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("objects", "readwrite");
    tx.objectStore("objects").put(content, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function getObject(key: string): Promise<string | null> {
  if (typeof indexedDB === "undefined") return fallback.get(key) || null;
  const db = await open();
  const result = await new Promise<string | null>((resolve, reject) => {
    const request = db.transaction("objects").objectStore("objects").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
export async function deleteObject(key: string) {
  if (typeof indexedDB === "undefined") {
    fallback.delete(key);
    return;
  }
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("objects", "readwrite");
    tx.objectStore("objects").delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
