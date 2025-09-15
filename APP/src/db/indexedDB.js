let db;

/**
 * Check if IndexedDB "public_users" exists
 * @returns {boolean} true if "public_users" exists, false otherwise
 */
export function checkPublicUsersStore() {
  return new Promise((resolve) => {
    const request = indexedDB.open("WatchTaskDB");
    request.onsuccess = (e) => {
      const database = e.target.result;
      const exists = database.objectStoreNames.contains("public_users");
      database.close();
      resolve(exists);
    };
    request.onerror = () => resolve(false);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      database.close();
      resolve(false);
    };
  });
}

/**
 * First DB initialization
 * @param {string} name Database name
 * @param {number} version Database version
 * @param {Function} upgradeCallback Callback to create/upgrade object stores
 * @returns {Promise<IDBDatabase>} Promise that resolves to the opened database
 */
export const openDB = (name) => {
  try {
    if (db) {
      return Promise.resolve(db);
    }
  } catch (e) {
    console.error("Error checking db:", e);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);

    request.onerror = (e) => reject(e.target.error);
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      resolve(db);
    };
  });
};

export const saveData = (store, value, key = 0) => {
  if (!db) throw new Error("Database not initialized");
  if (!db.objectStoreNames.contains(store)) {
    const version = db.version + 1;
    db.close();
    const request = indexedDB.open("WatchTaskDB", version);
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store, { keyPath: "code" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      saveData(store, value, key);
    };
    request.onerror = (e) => {
      throw new Error("Error upgrading database: " + e.target.error);
    };
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    if (key !== 0) {
      tx.objectStore(store).put(key, value);
    } else {
      tx.objectStore(store).put(value);
    }
    tx.oncomplete = () => resolve(db);
    tx.onerror = (e) => reject(e.target.error);
  });
};

export const getData = (store, key) => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
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

/**
 * ensureStore
 * Crea el object store indicado si no existe, incrementando la versión de la DB.
 * Por convención, el store usa keyPath: 'code' para public_users.
 * @param {string} store Nombre del object store
 * @returns {Promise<boolean>} true si existe/creó correctamente
 */
export const ensureStore = async (store) => {
  // Asegurar DB abierta
  if (!db) {
    await openDB("WatchTaskDB");
  }
  try {
    if (db && db.objectStoreNames.contains(store)) return true;
  } catch (_) {}

  const nextVersion = (db?.version || 1) + 1;
  try {
    db && db.close();
  } catch (_) {}

  return new Promise((resolve, reject) => {
    const request = indexedDB.open("WatchTaskDB", nextVersion);
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store, { keyPath: "code" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(true);
    };
    request.onerror = (e) => reject(e.target.error);
  });
};
