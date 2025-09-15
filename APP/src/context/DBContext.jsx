import React, { createContext, useEffect, useState } from "react";
import { openDB, saveData, getData, getAllData } from "@/db/indexedDB";
import { hashHex } from "@/utils/hash";

export const DBContext = createContext();

export function DBProvider({ children }) {
  const [dbReady, setDbReady] = useState(false);
  const [publicDB, setPublicDB] = useState([]);
  // contiene los perfiles, hashes, roles replicados entre peers

  // 📌 Funciones expuestas por el contexto

  /**
   * syncPublicDB
   * Sincroniza la DB pública recibida desde un peer P2P
   * Entrada: array de usuarios [{ username, role, hash, salt }]
   * Salida: void (actualiza IndexedDB y estado en memoria)
   */
  const syncPublicDB = async (users) => {
    for (const user of users) {
      await saveData("public_users", user);
    }
    const all = await getAllData("public_users");
    setPublicDB(all);
  };

  /**
   * getPublicUsers
   * Obtiene todos los usuarios de la DB pública
   * Entrada: void
   * Salida: array de usuarios
   */
  const getPublicUsers = async () => {
    return await getAllData("public_users");
  };

  /**
   * verifyCredentials
   * Verifica username/password contra la DB pública
   * Entrada: { username, password }
   * Salida: true/false según validez
   */
  const verifyCredentials = async ({ username, password }) => {
    const user = await getData("public_users", username);
    if (!user) return false;

    // TODO: usar bcrypt o similar en producción
    const computed = await hashHex(password + user.salt);
    return computed === user.hash;
  };

  /**
   * exportPublicDB
   * Exporta la DB pública local para enviarla a otros peers
   * Entrada: void
   * Salida: array de usuarios
   */
  const exportPublicDB = async () => {
    return await getAllData("public_users");
  };

  return (
    <DBContext.Provider
      value={{
        dbReady,
        publicDB,
        syncPublicDB,
        getPublicUsers,
        verifyCredentials,
        exportPublicDB,
      }}
    >
      {children}
    </DBContext.Provider>
  );
}
