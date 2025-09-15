import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onChildAdded,
  remove,
  onDisconnect,
  push,
  get,
} from "firebase/database";
import { UUID } from "uuidv7";

// TODO : en produccion usar ENV vars
const firebaseConfig = {
  apiKey: "",
  authDomain: "watchtask-35eb1.firebaseapp.com",
  databaseURL: "https://watchtask-35eb1-default-rtdb.firebaseio.com",
  projectId: "watchtask-35eb1",
  storageBucket: "watchtask-35eb1.appspot.com",
  messagingSenderId: "421711878688",
  appId: "1:421711878688:web:xxxxxxxxxxxxxxxx",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/**
 * Estructura de la RTDB:
 * UUID:{
 *  peerID: { role, lastSeen }
 *  offers: { from_to: sdpOffer }
 *  answers: { from_to: sdpAnswer }
 *  ice: { from_to: [candidates] }
 * }
 */
const ROOM_ID = "Cartocor";

/**
 * addPeer
 *  añade el peer actual al listado en RTDB y revisa que otros peers estén activos.
 * @param {UUID} peerId Identificador único del peer
 * @param {String} role identificador del rol del peer (guest, admin, supervisor, mantenedor)
 * @returns {void}
 */
export function addPeer(peerId, user = { role: "guest" }) {
  const peerInfoRef = ref(db, `${ROOM_ID}/${peerId}/peerID`);
  // Return the set promise so callers can await persistence if needed
  user.lastSeen = Date.now();
  const p = set(peerInfoRef, user);
  onDisconnect(peerInfoRef).remove();
  return p;
}

/**
 * sendOffer
 *  envía un SDP offer a otro peer vía RTDB.
 * @param {UUID} peerId Identificador único del peer
 * @param {UUID} remoteId Identificador único del peer de destino
 * @param {RTCSessionDescription} sdpOffer SDP offer
 * @returns {Promise<void>}
 */
export function sendOffer(peerId, remoteId, sdpOffer) {
  return set(ref(db, `${ROOM_ID}/${remoteId}/offers/${peerId}`), sdpOffer);
}

/**
 * sendIceCandidate
 *  envía candidato ICE a otro peer.
 * @param {UUID} peerId Identificador único del peer
 * @param {UUID} remoteId Identificador único del peer remoto
 * @param {RTCIceCandidate} candidate Identificador único del peer remoto
 * @returns {Promise<void>}
 */
export function sendIceCandidate(peerId, remoteId, candidate) {
  return push(ref(db, `${ROOM_ID}/${remoteId}/ice/${peerId}`), candidate);
}

/**
 * sendAnswer
 *  listar peers en la sala y actualizar la lista en tiempo real.
 * @param {useState<Map<any, any>>} setNewPeer mapa de peers
 * @param {UUID} peerId Identificador único del peer
 * @param {RTCSessionDescription} sdpAnswer SDP answer
 * @returns {Promise<void>}
 */
export function sendAnswer(peerId, remoteId, sdpAnswer) {
  return set(ref(db, `${ROOM_ID}/${remoteId}/answers/${peerId}`), sdpAnswer);
}

/**
 * SearchPeers
 *  listar peers en la sala buscando un ADMIN -> SUPERVISOR -> MANTENEDOR.
 * @param {useState<Map<any, any>>} setNewPeer mapa de peers
 * @param {UUID} peerId Identificador único del peer
 */
export async function SearchPeers(peerId) {
  const peersRef = ref(db, `${ROOM_ID}`);
  let selectedPeer = null;
  try {
    const snapshot = await get(peersRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.val();
    let selectedRole = null;
    Object.entries(data).forEach(([id, info]) => {
      if (id === peerId) return;
      if (!info.peerID || !info.peerID.role) return;
      const role = info.peerID.role;
      if (role === "admin") {
        selectedPeer = id;
        selectedRole = role;
        return;
      } else if (role === "supervisor" && selectedRole !== "admin") {
        selectedPeer = id;
        selectedRole = role;
      } else if (role === "mantenedor" && !selectedRole) {
        selectedPeer = id;
        selectedRole = role;
      }
    });
    return selectedPeer;
  } catch (err) {
    console.error("SearchPeers error:", err);
    return null;
  }
}
/**
 * listarPeers
 *  listar peers en la sala y actualizar la lista en tiempo real.
 * @param {useState<Map<any, any>>} setNewPeer mapa de peers
 * @param {UUID} peerId Identificador único del peer
 * @returns {Function} función para desuscribirse del listener.
 */
export function listarPeers(setNewPeer, peerId) {
  const peersRef = ref(db, `${ROOM_ID}`);
  const unsub = onChildAdded(peersRef, (snapshot) => {
    const remoteId = snapshot.key;
    if (!remoteId || remoteId === peerId) return;
    const val = snapshot.val();
    const peerMeta = val && val.peerID;
    if (!peerMeta) return; // ignorar nodos huérfanos sin metadata
    setNewPeer((prev) => new Map(prev).set(remoteId, peerMeta));
  });
  return () => unsub();
}

/**
 * listenOffers
 *  listar las ofertas dirigidas a este peer.
 * @param {UUID} peerId Identificador único del peer
 * @param {onReceive} onReceive callback para procesar la oferta (remoteId, sdpOffer)
 * @returns {Function} función para desuscribirse del listener.
 */
export function listenOffers(peerId, onReceive) {
  const offersRef = ref(db, `${ROOM_ID}/${peerId}/offers`);
  const processed = new Set();
  const unsub = onChildAdded(offersRef, (snapshot) => {
    const remoteId = snapshot.key;
    if (!remoteId) return;
    if (processed.has(remoteId)) return;
    processed.add(remoteId);
    onReceive(remoteId, snapshot.val());
    remove(snapshot.ref).catch(() => {}); // Eliminar la oferta tras procesarla
  });
  return () => unsub();
}

/**
 * listenAnswers
 *  listar las answers dirigidas a este peer.
 * @param {UUID} peerId Identificador único del peer
 * @param {onReceive} onReceive callback para procesar la oferta (remoteId, sdpAnswer)
 * @returns {Function} función para desuscribirse del listener.
 */
export function listenAnswers(peerId, onReceive) {
  const answersRef = ref(db, `${ROOM_ID}/${peerId}/answers`);
  const processed = new Set();
  const unsub = onChildAdded(answersRef, (snapshot) => {
    const remoteId = snapshot.key;
    if (!remoteId) return;
    if (processed.has(remoteId)) return;
    processed.add(remoteId);
    onReceive(remoteId, snapshot.val());
    remove(snapshot.ref).catch(() => {});
  });
  return () => unsub();
}

/**
 * listenIceCandidates: escucha ICE candidates dirigidos a este peer.
 * - entrada: ownId, callback onReceive(fromId, candidate).
 */
/**
 * listenIceCandidates
 *  listar los ICE candidates dirigidas a este peer.
 * @param {UUID} peerId Identificador único del peer
 * @param {onReceive} onReceive callback para procesar la oferta (remoteId, candidate)
 * @returns {Function} función para desuscribirse del listener.
 */
export function listenIceCandidates(peerId, onReceive) {
  const iceRef = ref(db, `${ROOM_ID}/${peerId}/ice`);
  const perSenderUnsubs = new Map();
  const processed = new Set();
  const unsubSenders = onChildAdded(iceRef, (senderSnap) => {
    const remoteId = senderSnap.key;
    if (!remoteId) return;

    const candidatesRef = ref(db, `${ROOM_ID}/${peerId}/ice/${remoteId}`);
    const unsubCand = onChildAdded(candidatesRef, (candSnap) => {
      const candidate = candSnap.val();
      const key = `${remoteId}|${candSnap.key}`;
      if (processed.has(key)) return;
      processed.add(key);
      onReceive(remoteId, candidate);
      remove(candSnap.ref).catch(() => {
        console.log("No se pudo eliminar candidato ICE");
      });
    });
    perSenderUnsubs.set(remoteId, unsubCand);
  });
  return () => {
    try {
      unsubSenders();
    } catch (_) {}
    perSenderUnsubs.forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    perSenderUnsubs.clear();
  };
}

export default db;
