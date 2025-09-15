import React, { createContext, useEffect, useState } from "react";
import { getData, checkPublicUsersStore } from "@/db/indexedDB";
import { hashHex } from "@/utils/hash";
export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [checking, setChecking] = useState(false);

  const exists = async () => await checkPublicUsersStore();

  useEffect(() => {
    const verifyStore = async () => {
      setChecking(true);
      let a = await exists();
      if (!a) {
        setChecking(false);
        return;
      }
      setChecking(false);
    };
    verifyStore();
  }, []);

  const login = async (code, password) => {
    const hashedPassword = await hashHex(password);
    const users = await getData("public_users", code);
    if (!users || users.length === 0) return false;
    if (users.hashPassword === hashedPassword) {
      setUser({ user: users.name, code: users.code });
      setRole(users.role);
      setChecking(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    setRole(null);
  };

  useEffect(() => {
    if (!checking) return;
  }, [checking]);

  return (
    <AuthContext.Provider value={{ user, role, checking, login, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
