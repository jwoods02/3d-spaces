// Keeps the last uploaded scan in IndexedDB (too big for localStorage) so it
// survives a page reload.
const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('3d-spaces', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
};

export const saveScan = (file) => tx('readwrite', (s) => s.put(file, 'scan'));
export const loadScan = () => tx('readonly', (s) => s.get('scan'));
export const clearScan = () => tx('readwrite', (s) => s.delete('scan'));
