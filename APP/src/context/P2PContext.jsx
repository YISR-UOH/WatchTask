import React, { createContext, useState, useEffect, useContext } from "react";
import {
  firstConection,
  myPeerId,
  connectWithPeer,
  ListenWebRTC,
} from "@/webrtc/connection";
import { AuthContext } from "@/context/AuthContext";
import { openDB, saveData } from "@/db/indexedDB";
import { addPeer } from "@/signaling/firebaseSignaling";
import { hashHex } from "@/utils/hash";
export const P2PContext = createContext();

export function P2PProvider({ children }) {
  const [online, setOnline] = useState(navigator.onLine);
  const { checking, user, role, setUser } = useContext(AuthContext);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const tryFirstConnection = async () => {
    if (!checking && online && !user) {
      let a = await firstConection();
      if (!a) {
        // openDB = (name, version)
        await openDB("WatchTaskDB");
        const hashedPassword = await hashHex("0000");
        const user = {
          code: "0000",
          name: "Administrador",
          hashPassword: hashedPassword,
          role: "ADMIN",
          speciality: "",
          active: true,
        };
        await saveData("public_users", user);
      }
      if (a) {
        await connectWithPeer(a);
      }
    } else if (checking && online && user) {
      const mypeerID = await myPeerId;
      setUser({
        user: user.user,
        code: user.code,
        peerId: mypeerID,
      });
      let a = await addPeer(myPeerId, {
        user: user.user,
        code: user.code,
        peerId: mypeerID,
        role: role.toLowerCase(),
      });
      await ListenWebRTC();
    }
  };

  useEffect(() => {
    tryFirstConnection();
  }, [checking, online]);

  return (
    <P2PContext.Provider
      value={{
        online,
      }}
    >
      {children}
    </P2PContext.Provider>
  );
}
