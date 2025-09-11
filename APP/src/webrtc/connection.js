import {
  sendOffer,
  listenAnswers,
  sendIceCandidate,
  listenIceCandidates,
  registrarPeer,
  listarPeers,
  sendAnswer,
  listenOffers,
} from "@/signaling/firebaseSignaling";
import { syncDatosPublicos } from "@/db/sync";
import { uuidv7 } from "uuidv7";

// Configuración ICE (p.ej. servidores STUN públicos)
// TODO: existen otros?, buscar implementacion propia?
const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

// Identificador local simple y persistente
const PEER_ID_KEY = "p2p_peer_id";
export const myPeerId = (() => {
  try {
    let id = localStorage.getItem(PEER_ID_KEY);
    if (!id) {
      id = uuidv7();
      localStorage.setItem(PEER_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return uuidv7();
  }
})();

/**
 * Crear una entrada en firebaseSignaling
 * - propósito: registrar este peer en el sistema de signaling.
 */
export function firstConection() {
  if (!myPeerId) return;
  const register = registrarPeer(myPeerId);
  return register;
}

/**
 * listarPeers
 * - propósito: obtener la lista de peers registrados (excluyendo este).
 * - entradas: ninguna.
 * - salidas: Promise<Array> con IDs de otros peers.
 */
export function obtenerPeers(setPeers) {
  // Devuelve función de desuscripción directamente
  return listarPeers(setPeers, myPeerId);
}

/**
 * Enviar Offer a una lista de peers
 * - propósito: iniciar conexiones WebRTC con varios peers.
 * - entradas: peerIds (dict de peers).
 * - salidas: Promise que resuelve cuando se han enviado todas las ofertas.
 */
export async function enviarOffers(peers, peerConnections, setPeerConnections) {
  for (const peerId of peers.keys()) {
    if (peerId !== myPeerId) {
      await crearConexionP2P(peerId, peerConnections, setPeerConnections);
    }
  }
}
/**
 * crearConexionP2P
 * - propósito: inicializar una conexión WebRTC con otro peer (negociación de DataChannel).
 * - entradas: remoteId (peerId del otro extremo).
 * - salidas: Promise<RTCPeerConnection> con la conexión completa (DataChannel listo).
 * - consideraciones: este peer inicia la oferta. Se asume que listenOffers se ha inicializado en otro lugar.
 */
export async function crearConexionP2P(
  remoteId,
  peerConnections,
  setPeerConnections
) {
  return new Promise(async (resolve, reject) => {
    const alreadyConnected = (() => {
      if (!peerConnections) return false;
      // Support Map or plain object for safety
      if (peerConnections instanceof Map) return peerConnections.has(remoteId);
      return !!peerConnections[remoteId];
    })();

    if (!remoteId) {
      return reject("Invalid remoteId");
    }
    if (alreadyConnected) {
      const existing =
        peerConnections instanceof Map
          ? peerConnections.get(remoteId)
          : peerConnections[remoteId];
      if (existing) return resolve(existing);
    }

    const pc = new RTCPeerConnection({ iceServers });
    const pendingRemoteCandidates = [];
    let dataChannel = null;
    const cleanupFns = [];
    const attachDataChannel = (dc) => {
      pc.dataChannel = dc;
      dataChannel = dc;
      dataChannel.onopen = () => {
        addPeerConnection(remoteId, pc, setPeerConnections);
        try {
          const message = {
            type: "greeting",
            payload: `Hola, mundo! ${myPeerId}`,
          };
          dataChannel.send(JSON.stringify(message));
        } catch (_) {}
        cleanupFns.forEach((fn) => {
          try {
            if (typeof fn === "function") fn();
          } catch (_) {}
        });
        resolve(pc);
      };
      dataChannel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          manejarMensajeP2P(remoteId, message);
        } catch (e) {
          console.error("Error parsing P2P message:", e);
        }
      };
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const cand = event.candidate.toJSON
          ? event.candidate.toJSON()
          : event.candidate;
        sendIceCandidate(myPeerId, remoteId, cand);
      }
    };
    pc.onsignalingstatechange = () => {
      console.debug("signalingState", remoteId, pc.signalingState);
    };

    try {
      // Deterministic initiator to avoid glare
      const iAmInitiator = String(myPeerId) < String(remoteId);

      // Listen for ICE candidates addressed to me; filter by sender
      const stopIce = listenIceCandidates(
        myPeerId,
        async (fromId, candidate) => {
          if (fromId !== remoteId) return;
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              console.error("Error adding ICE candidate:", e);
            }
          } else {
            pendingRemoteCandidates.push(candidate);
          }
        }
      );
      cleanupFns.push(stopIce);

      if (iAmInitiator) {
        // Offerer: create DataChannel and send offer
        attachDataChannel(pc.createDataChannel("dataChannel"));

        const stopAnswers = listenAnswers(myPeerId, async (fromId, answer) => {
          if (fromId !== remoteId) return;
          // Only accept answer when we are in have-local-offer
          if (pc.signalingState !== "have-local-offer") return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            // flush queued remote ICE
            while (pendingRemoteCandidates.length) {
              const c = pendingRemoteCandidates.shift();
              try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
              } catch (err) {
                console.warn("Error flushing ICE candidate", err);
              }
            }
          } catch (err) {
            console.warn("Ignoring remote answer (state)", err);
          }
        });
        cleanupFns.push(stopAnswers);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendOffer(myPeerId, remoteId, offer);
      } else {
        // Answerer: wait for remote offer and create an answer
        pc.ondatachannel = (event) => attachDataChannel(event.channel);

        const stopOffers = listenOffers(myPeerId, async (fromId, sdpOffer) => {
          if (fromId !== remoteId) return;
          // Only accept remote offer when stable (no local offer pending)
          if (pc.signalingState !== "stable") {
            console.warn(
              "Received offer while not stable; dropping to avoid glare",
              pc.signalingState
            );
            return;
          }
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdpOffer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendAnswer(myPeerId, remoteId, answer);
            // After setting local description (answer), flush queued ICE
            while (pendingRemoteCandidates.length) {
              const c = pendingRemoteCandidates.shift();
              try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
              } catch (err) {
                console.warn("Error flushing ICE candidate", err);
              }
            }
          } catch (err) {
            console.error("Error handling incoming offer:", err);
          }
        });
        cleanupFns.push(stopOffers);
      }
    } catch (e) {
      console.error("Error creating connection to", remoteId, e);
      pc.close();
      reject(e);
    }

    if (pc.connectionState === "failed") {
      console.error("Connection failed to", remoteId);
      pc.close();
      reject("Connection failed");
    }
    // Safety timeout: if not connected in 30s, abort
    setTimeout(() => {
      if (pc.connectionState !== "connected") {
        console.error("Connection timeout to", remoteId);
        pc.close();
        reject("Connection timeout");
      }
    }, 30000);

    // Conexión se añadirá al abrir el DataChannel
  });
}

function addPeerConnection(peerId, pc, setPeerConnections) {
  if (typeof setPeerConnections !== "function") return;
  setPeerConnections((prev) => {
    if (prev instanceof Map) {
      const next = new Map(prev);
      next.set(peerId, pc);
      return next;
    }
    const updated = { ...(prev || {}) };
    updated[peerId] = pc;
    return updated;
  });
}
/**
 * manejarMensajeP2P
 * - propósito: procesar mensajes recibidos por DataChannel de otro peer.
 * - entrada: fromPeerId (emisor), message (objeto JSON).
 * - salidas: ninguna; se ejecutan acciones según el tipo de mensaje.
 * - consideraciones: mensajes definidos en protocolo (p.ej. 'auth', 'sync', etc.).
 */
function manejarMensajeP2P(fromPeerId, message) {
  switch (message.type) {
    case "syncPublicDB":
      // Sincronizar base pública (llama a función del módulo db)
      syncDatosPublicos(message.payload);
      break;
    case "newData":
      // Actualización incremental (p.ej. un registro actualizado)
      handleNewData(message.payload);
      break;
    // ... otros tipos (chat, comandos, etc.)
    case "greeting":
      console.log("Received greeting from", fromPeerId, message.payload);
      break;
    case "ping":
      console.log("Received ping from", fromPeerId, message.at);
      break;
    default:
      console.warn("Tipo de mensaje P2P desconocido:", message.type);
  }
}

function handleNewData(payload) {
  // Placeholder: implementar según esquema de datos
  console.log("newData recibido", payload);
}
