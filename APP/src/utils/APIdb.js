import { openDB } from "idb";

const PROFILES_DB = "profilesDB";
const PROFILES_STORE = "profiles";
const ORDERS_DB = "pdfDataDB"; // existing orders DB
const ORDERS_STORE = "pdfData";

const isSafari =
  typeof navigator !== "undefined" &&
  /safari/i.test(navigator.userAgent) &&
  !/chrome|crios|android/i.test(navigator.userAgent);

/* -------------------------------------------------------------------
*                IndexedDB Profiles Store 
--------------------------------------------------------------------
*/
/**
 * Obtiene (o inicializa) la base IndexedDB de perfiles.
 * @returns {Promise<IDBPDatabase>} instancia abierta con objectStore `profiles`.
 */
async function getProfilesDB() {
  // comprobar si existe
  if (openDB.databases) {
    const dbs = await openDB.databases();
    const existing = dbs.find((db) => db.name === PROFILES_DB);
    if (existing) {
      return openDB(PROFILES_DB, existing.version);
    }
  }
  // si no, crearla
  const version = 1;
  return openDB(PROFILES_DB, version, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PROFILES_STORE)) {
        db.createObjectStore(PROFILES_STORE, { keyPath: "code" });
      }
    },
  });
}

/**
 * Almacena un perfil si no existe ya (clave code).
 * solo admin pueden añadir perfiles.
 * @param {Profile} prof Perfil a almacenar
 */
async function addProfilesDB(prof, actualProfile) {
  if (!actualProfile.role === "admin")
    throw new Error("Solo admin puede añadir perfiles");
  if (!prof?.code) throw new Error("Perfil inválido, falta código");
  const db = await getProfilesDB();
  const existing = await db.get(PROFILES_STORE, prof.code);
  if (!existing) {
    await db.add(PROFILES_STORE, prof);
  } else {
    throw new Error("Perfil ya existe, no se puede añadir");
  }
}

/**
 * Elimina un perfil por código.
 * @param {string} code Código del perfil a eliminar.
 */
async function removeProfilesDB(code) {
  if (!code) throw new Error("Código inválido");
  const db = await getProfilesDB();
  await db.delete(PROFILES_STORE, code);
}

/**
 * Obtiene todos los perfiles almacenados.
 * @returns {Promise<Profile[]>} Array de perfiles.
 */
async function getAllProfilesDB() {
  const db = await getProfilesDB();
  return db.getAll(PROFILES_STORE);
}

/**
 * Actualiza un perfil existente.
 * @param {Profile} prof Perfil a actualizar (debe existir).
 */
async function updateProfilesDB(prof) {
  if (!prof?.code) throw new Error("Perfil inválido, falta código");
  const db = await getProfilesDB();
  const existing = await db.get(PROFILES_STORE, prof.code);
  if (existing) {
    await db.put(PROFILES_STORE, { ...existing, ...prof });
  } else {
    throw new Error("Perfil no existe, no se puede actualizar");
  }
}

/* -------------------------------------------------------------------
*                IndexedDB Orders Store 
--------------------------------------------------------------------
*/

/** Obtiene (o inicializa) la base IndexedDB de órdenes (PDFs).
 * @returns {Promise<IDBPDatabase>} instancia abierta con objectStore `pdfData`.
 */
async function getOrdersDB() {
  return openDB(ORDERS_DB, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(ORDERS_STORE)) {
        db.createObjectStore(ORDERS_STORE, { keyPath: "id" });
      }
    },
  });
}
/**
 * Cuenta las órdenes almacenadas.
 * @returns {Promise<number>} número de órdenes.
 */
async function countOrdersDB() {
  const db = await getOrdersDB();
  return db.count(ORDERS_STORE);
}
/**
 * Elimina todas las órdenes almacenadas.
 */
async function clearOrdersDB() {
  const db = await getOrdersDB();
  const tx = db.transaction(ORDERS_STORE, "readwrite");
  await tx.store.clear();
  await tx.done;
}
/** Obtiene todas las órdenes almacenadas.
 * @returns {Promise<Order[]>} Array de órdenes.
 */
async function getAllOrdersDB() {
  const db = await getOrdersDB();
  return db.getAll(ORDERS_STORE);
}
/** Añade o actualiza una orden.
 * @param {Order} order Orden a añadir o actualizar.
 */
async function updateOrderDB(order) {
  if (!order?.id) throw new Error("Orden inválida, falta id");
  const db = await getOrdersDB();
  await db.put(ORDERS_STORE, order);
}
/**
 * Elimina una orden por id.
 * @param {string} id Id de la orden a eliminar.
 */
async function removeOrderDB(id) {
  if (!id) throw new Error("Id inválido");
  const db = await getOrdersDB();
  await db.delete(ORDERS_STORE, id);
}

export {
  getProfilesDB,
  addProfilesDB,
  removeProfilesDB,
  getAllProfilesDB,
  updateProfilesDB,
  getOrdersDB,
  countOrdersDB,
  clearOrdersDB,
  getAllOrdersDB,
  updateOrderDB,
  removeOrderDB,
  isSafari,
};
