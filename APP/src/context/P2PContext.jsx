import React, { createContext, useState, useEffect, use } from "react";
import {
  myPeerId,
  crearConexionP2P,
  firstConection,
  obtenerPeers,
  enviarOffers,
} from "@/webrtc/connection";
import { set } from "firebase/database";

export const P2PContext = createContext();

export function P2PProvider({ children }) {
  const [peerConnections, setPeerConnections] = useState(new Map());
  const [peers, setPeers] = useState(new Map());
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      for (const peerId of peerConnections.keys()) {
        disconnectPeer(peerId);
      }
      setOnline(true);
      setPeerConnections(new Map());
      setPeers(new Map());
      localStorage.removeItem("p2p_peer_id");
      firstConection();
      obtenerPeers(setPeers);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  useEffect(() => {
    firstConection();
    const unsub = obtenerPeers(setPeers);
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);
  useEffect(() => {
    // Intenta iniciar conexiones para todos los peers conocidos
    enviarOffers(peers, peerConnections, setPeerConnections);
  }, [peers]);

  /**
   * connectToPeer: inicia una conexión WebRTC con otro peer.
   * - entrada: peerId (identificador del peer remoto).
   * - salidas: instancia de RTCPeerConnection creada y almacenada en context.
   * - consideraciones: usa crearConexionP2P() del módulo webrtc; registra event handlers.
   */
  async function connectToPeer(peerId) {
    const pc = await crearConexionP2P(
      peerId,
      peerConnections,
      setPeerConnections
    );
  }

  function disconnectPeer(peerId) {
    const pc =
      peerConnections instanceof Map
        ? peerConnections.get(peerId)
        : peerConnections && peerConnections[peerId];
    if (!pc) return;
    try {
      pc.close();
    } catch (_) {}
    setPeerConnections((prev) => {
      if (prev instanceof Map) {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      }
      const updated = { ...(prev || {}) };
      delete updated[peerId];
      return updated;
    });
  }

  async function sendMessage(peerId, data) {
    const pc =
      peerConnections instanceof Map
        ? peerConnections.get(peerId)
        : peerConnections && peerConnections[peerId];
    if (pc && pc.dataChannel && pc.dataChannel.readyState === "open") {
      pc.dataChannel.send(JSON.stringify(data));
    }
  }

  return (
    <P2PContext.Provider
      value={{ peerConnections, connectToPeer, disconnectPeer, sendMessage }}
    >
      {children}
    </P2PContext.Provider>
  );
}
