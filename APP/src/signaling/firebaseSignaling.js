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
  onDisconnect(peerRef).remove();
  return peerRef;
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
    if (peerId && peerId !== myPeerId) {
      const peerData = snapshot.val().peerID;
      setNewPeer((prev) => new Map(prev).set(peerId, peerData));
    }
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
  const unsub = onChildAdded(offersRef, (snapshot) => {
    const key = snapshot.key;
    if (!key) return;
    onReceive(key, snapshot.val());
  });
  return () => unsub();
}

/**
 * listenAnswers: escucha respuestas dirigidas a este peer.
 * - entrada: ownId, callback onReceive(fromId, sdpAnswer).
 */
export function listenAnswers(ownId, onReceive) {
  const answersRef = ref(db, `${ROOM_ID}/${ownId}/answers`);
  const unsub = onChildAdded(answersRef, (snapshot) => {
    const key = snapshot.key;
    if (!key) return;
    onReceive(key, snapshot.val());
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

  const unsubSenders = onChildAdded(iceRef, (senderSnap) => {
    const fromId = senderSnap.key;
    if (!fromId) return;

    const candidatesRef = ref(db, `${ROOM_ID}/${ownId}/ice/${fromId}`);
    const unsubCand = onChildAdded(candidatesRef, (candSnap) => {
      const candidate = candSnap.val();
      onReceive(fromId, candidate);
      // limpiar candidato consumido para evitar relecturas
      remove(candSnap.ref).catch(() => {});
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
