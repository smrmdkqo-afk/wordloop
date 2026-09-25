let connection;
export function openDB() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const r = indexedDB.open("wordloop", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("local");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(new Error("다른 워드루프 창을 닫고 다시 열어 주세요."));
  });
  return connection;
}
export async function read(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction("local").objectStore("local").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function write(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("local", "readwrite");
    tx.objectStore("local").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("저장하지 못했어요."));
  });
}
