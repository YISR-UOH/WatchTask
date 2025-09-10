import { saveData, getAllData } from "@/db/indexedDB";

/**
 * syncDatosPublicos
 * - propósito: sincronizar datos de la base pública recibidos de otro peer.
 * - entradas: datosRemotos (Array u objeto JSON de usuarios).
 * - salidas: Promise que resuelve cuando se ha actualizado IndexedDB local.
 * - consideraciones: por simplicidad, se pueden iterar los registros y hacer put();
 *   también puede manejarse lógica de conflicto (p.ej. últimos cambios).
 */
export async function syncDatosPublicos(datosRemotos) {
  // Supongamos que datosRemotos es una lista de objetos { username, name, role, hashPassword }.
  if (!Array.isArray(datosRemotos)) return;
  for (const user of datosRemotos) {
    await saveData("public_users", user);
  }
}

/**
 * exportarDatosPublicos
 * - propósito: obtener todos los registros de la base pública (para enviar a peers).
 * - entradas: ninguna.
 * - salidas: Promise<Array> con todos los usuarios públicos.
 */
export async function exportarDatosPublicos() {
  return await getAllData("public_users");
}
