import React, { createContext, useState } from "react";
import { getData } from "@/db/indexedDB";
import { hashHex } from "@/utils/hash";
export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);

  /**
   * login: verifica credenciales en la base pública local (IndexedDB).
   * - entradas: nombre de usuario, contraseña (texto plano).
   * - salidas: Promise que resuelve true/false (éxito o fallo).
   * - consideraciones: compara hash de contraseña; establece user y role en contexto.
   */
  async function login(username, password) {
    try {
      // Buscar usuario en la store pública
      const stored = await getData("public_users", username);
      if (!stored) return false;

      const computed = await hashHex(password + stored.salt);

      if (computed === stored.hash) {
        setUser(username);
        setRole(stored.role);
        return true;
      }
      return false;
    } catch (e) {
      // Si la DB aún no está lista o falla, devolvemos false
      return false;
    }
  }

  function logout() {
    setUser(null);
    setRole(null);
    // desconectar conexiones P2P, limpiar estado, etc.
  }

  return (
    <AuthContext.Provider value={{ user, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
