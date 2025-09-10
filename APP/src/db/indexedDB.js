let db;

export const openDB = (name, version, upgradeCallback) => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onerror = (e) => reject(e.target.error);
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      upgradeCallback(db);
    };
  });
};

export const saveData = (store, value) => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([store], "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getData = (store, key) => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([store], "readonly");
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

export const getAllData = (store) => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([store], "readonly");
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

export const deleteData = (store, key) => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([store], "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
};
