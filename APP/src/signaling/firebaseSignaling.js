import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onChildAdded,
  remove,
  onDisconnect,
  push,
} from "firebase/database";

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
const STRUCTURE = {
  peerID: {},
  offers: {},
  answers: {},
  ice: {},
};
const ROOM_ID = "Cartocor";
/**
 * registrarPeer: añade el peer actual al listado en RTDB y revisa que otros peers estén activos.
 * - entradas: peerId (cadena única)
 * - salidas: referencia de RTDB al path del peer.
 * - consideraciones: usar onDisconnect() para eliminar al desconectarse.
 */
export function registrarPeer(peerId, role = "guest") {
  const peerRef = ref(db, `${ROOM_ID}/${peerId}`);
  const peerInfoRef = ref(db, `${ROOM_ID}/${peerId}/peerID`);
  // Importante: no sobreescribir todo el nodo del peer para no borrar offers/answers/ice
  set(peerInfoRef, { role, lastSeen: Date.now() });
  // Sólo eliminamos la info del peer, no las ofertas/candidatos inmediatamente (permite reconexión breve)
  onDisconnect(peerInfoRef).remove();
  return peerRef;
}

// Heartbeat para actualizar lastSeen periódicamente
export function startPeerHeartbeat(peerId, intervalMs = 15000) {
  const peerInfoRef = ref(db, `${ROOM_ID}/${peerId}/peerID/lastSeen`);
  const tick = () => set(peerInfoRef, Date.now()).catch(() => {});
  const id = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(id);
}

/**
 * sendOffer: envía un SDP offer a otro peer vía RTDB.
 * - entradas: fromId, toId, sdpOffer (objeto SDP).
 * - salidas: Promise de la operación de escritura.
 * - consideraciones: formamos una clave combinada para identificar emisor y receptor.
 */
export function sendOffer(myPeerId, remoteId, sdpOffer) {
  return set(ref(db, `${ROOM_ID}/${remoteId}/offers/${myPeerId}`), sdpOffer);
}

/**
 * Funcion para listar peers en la sala y actualizar la lista en tiempo real.
 * - entrada: callback onNewPeer(setNewPeer, myPeerId)
 * * setNewPeer es un Map
 * - salidas: función para desuscribirse del listener.
 */
export function listarPeers(setNewPeer, myPeerId) {
  const peersRef = ref(db, `${ROOM_ID}`);
  const unsub = onChildAdded(peersRef, (snapshot) => {
    const peerId = snapshot.key;
    if (!peerId || peerId === myPeerId) return;
    const val = snapshot.val();
    const peerMeta = val && val.peerID;
    if (!peerMeta) return; // ignorar nodos huérfanos sin metadata
    setNewPeer((prev) => new Map(prev).set(peerId, peerMeta));
  });
  return () => unsub();
}

/**
 * sendAnswer: responde a una oferta con un SDP answer.
 * - entradas: fromId (este peer), toId (quien pidió conexión), sdpAnswer.
 * - salidas: Promise de escritura.
 */
export function sendAnswer(ownId, remoteId, sdpAnswer) {
  return set(ref(db, `${ROOM_ID}/${remoteId}/answers/${ownId}`), sdpAnswer);
}
/**
 * listenOffers: escucha ofertas dirigidas a este peer.
 * - entrada: ownId, callback onReceive(fromId, sdpOffer).
 */
export function listenOffers(ownId, onReceive) {
  const offersRef = ref(db, `${ROOM_ID}/${ownId}/offers`);
  const processed = new Set();
  const unsub = onChildAdded(offersRef, (snapshot) => {
    const key = snapshot.key;
    if (!key) return;
    if (processed.has(key)) return;
    processed.add(key);
    onReceive(key, snapshot.val());
    remove(snapshot.ref).catch(() => {}); // Eliminar la oferta tras procesarla
  });
  return () => unsub();
}

/**
 * listenAnswers: escucha respuestas dirigidas a este peer.
 * - entrada: ownId, callback onReceive(fromId, sdpAnswer).
 */
export function listenAnswers(ownId, onReceive) {
  const answersRef = ref(db, `${ROOM_ID}/${ownId}/answers`);
  const processed = new Set();
  const unsub = onChildAdded(answersRef, (snapshot) => {
    const key = snapshot.key;
    if (!key) return;
    if (processed.has(key)) return;
    processed.add(key);
    onReceive(key, snapshot.val());
    remove(snapshot.ref).catch(() => {}); // Eliminar la respuesta tras procesarla
  });
  return () => unsub();
}

/**
 * sendIceCandidate: envía candidato ICE a otro peer.
 * - entradas: fromId, toId, candidate (objeto ICE).
 */
export function sendIceCandidate(fromId, toId, candidate) {
  return push(ref(db, `${ROOM_ID}/${toId}/ice/${fromId}`), candidate);
}

/**
 * listenIceCandidates: escucha ICE candidates dirigidos a este peer.
 * - entrada: ownId, callback onReceive(fromId, candidate).
 */
export function listenIceCandidates(ownId, onReceive) {
  const iceRef = ref(db, `${ROOM_ID}/${ownId}/ice`);
  const perSenderUnsubs = new Map();
  const processed = new Set(); // fromId|candidateKey

  const unsubSenders = onChildAdded(iceRef, (senderSnap) => {
    const fromId = senderSnap.key;
    if (!fromId) return;

    const candidatesRef = ref(db, `${ROOM_ID}/${ownId}/ice/${fromId}`);
    const unsubCand = onChildAdded(candidatesRef, (candSnap) => {
      const candidate = candSnap.val();
      const key = `${fromId}|${candSnap.key}`;
      if (processed.has(key)) return;
      processed.add(key);
      onReceive(fromId, candidate);
      // Eliminar el candidato tras procesarlo para evitar reprocesamientos
      remove(candSnap.ref).catch(() => {
        console.log("No se pudo eliminar candidato ICE");
      });
    });
    perSenderUnsubs.set(fromId, unsubCand);
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
