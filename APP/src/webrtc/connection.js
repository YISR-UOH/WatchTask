import {
  addPeer,
  SearchPeers,
  listenAnswers,
  listenOffers,
  listenIceCandidates,
  sendIceCandidate,
  sendOffer,
  sendAnswer,
} from "@/signaling/firebaseSignaling";
import { syncDatosPublicos, exportarDatosPublicos } from "@/db/sync";
import { openDB, checkPublicUsersStore, ensureStore } from "@/db/indexedDB";
import { uuidv7 } from "uuidv7";

// Configuración ICE (p.ej. servidores STUN públicos)
// Nota: Para entornos NAT estrictos se necesita TURN. Aquí ampliamos la lista de STUN.
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// Identificador local simple y persistente
const PEER_ID_KEY = "p2p_peer_id";
export const myPeerId = (() => {
  try {
    let id = localStorage.getItem(PEER_ID_KEY);
    if (!id) {
      id = uuidv7();
      localStorage.setItem(PEER_ID_KEY, id);
      console.log("Generated new peer ID:", id);
    }
    return id;
  } catch (_) {
    return uuidv7();
  }
})();

/**
 *  añade el peer actual al listado en RTDB y revisa que otros peers estén activos.
 * @returns {void}
 */
export async function firstConection() {
  if (!myPeerId) return;
  const selected = await SearchPeers(myPeerId);
  if (selected) {
    console.log("Peer seleccionado:", selected);
    await addPeer(myPeerId);
    return selected;
  } else {
    console.log("No hay otros peers conectados");
    return false;
  }
}

/**
 * conectar con un peer específico y sincronizar datos.
 * @returns {void}
 */
export async function connectWithPeer(remoteId) {
  if (!myPeerId) return;
  console.log("Connecting to peer:", remoteId);
  const pc = new RTCPeerConnection({ iceServers });
  let remoteDescSet = false;
  const pendingRemoteIce = [];
  let gotRemoteIceEnd = false;
  pc.onicecandidateerror = (e) =>
    console.warn("[offerer] ICE candidate error:", e.errorText || e.errorCode);
  pc.onsignalingstatechange = () =>
    console.log("[offerer] signaling:", pc.signalingState);
  pc.onicegatheringstatechange = () =>
    console.log("[offerer] iceGathering:", pc.iceGatheringState);
  pc.oniceconnectionstatechange = () =>
    console.log("[offerer] iceConnection:", pc.iceConnectionState);
  // Crear DataChannel del lado que inicia (offerer)
  const dataChannel = pc.createDataChannel("p2p");
  dataChannel.onopen = () => {
    console.log("DataChannel abierto con:", remoteId);
    // Mensajes simples para verificar conectividad desde el offerer
    try {
      dataChannel.send("ping-offerer");
      dataChannel.send(
        JSON.stringify({ __type: "info", msg: "hello-from-offerer" })
      );
    } catch (e) {
      console.warn("No se pudo enviar mensaje simple (offerer):", e);
    }
  };
  dataChannel.onclose = () => console.log("DataChannel cerrado con:", remoteId);
  dataChannel.onerror = (e) => console.error("DataChannel error:", e);
  // Recepción de datos del callee (usuarios públicos)
  dataChannel.onmessage = async (e) => {
    try {
      console.log("[offerer] Mensaje recibido:", e.data);
      const msg = JSON.parse(e.data);
      if (msg && msg.__type === "public_users" && Array.isArray(msg.data)) {
        console.log(`Recibidos ${msg.data.length} usuarios públicos`);
        await openDB("WatchTaskDB");
        await ensureStore("public_users");
        await syncDatosPublicos(msg.data);
      } else if (msg && msg.__type === "info") {
        console.log("[offerer] info:", msg.msg);
      }
    } catch (err) {
      // Puede no ser JSON o un tipo diferente; registrar texto plano
      if (typeof e.data === "string") {
        console.log("[offerer] texto plano:", e.data);
      } else {
        console.warn("Mensaje DataChannel no reconocido:", err);
      }
    }
  };

  // Suscribirse a respuestas e ICE dirigidos a este peer y desde el remoto seleccionado
  const stopAnswers = listenAnswers(myPeerId, async (fromId, answer) => {
    if (fromId !== remoteId) return;
    try {
      await pc.setRemoteDescription(answer);
      console.log("Remote description (answer) aplicada de:", fromId);
      remoteDescSet = true;
      // Drenar candidatos ICE pendientes
      if (pendingRemoteIce.length) {
        console.log(
          `[offerer] Agregando ${pendingRemoteIce.length} ICE pendientes`
        );
        for (const cand of pendingRemoteIce.splice(0)) {
          try {
            await pc.addIceCandidate(cand);
          } catch (err) {
            console.error("[offerer] Error al agregar ICE pendiente:", err);
          }
        }
      }
      if (gotRemoteIceEnd) {
        try {
          await pc.addIceCandidate(null);
          console.log("[offerer] Fin de ICE aplicado (null)");
        } catch (_) {}
      }
    } catch (err) {
      console.error("Error al aplicar remoteDescription:", err);
    }
  });
  const stopIce = listenIceCandidates(myPeerId, async (fromId, candidate) => {
    if (fromId !== remoteId) return;
    try {
      console.log("[offerer] Recibido ICE de:", fromId);
      if (candidate && candidate.endOfCandidates) {
        if (remoteDescSet) {
          try {
            await pc.addIceCandidate(null);
            console.log("[offerer] Fin de ICE aplicado (null)");
          } catch (_) {}
        } else {
          gotRemoteIceEnd = true;
          console.log("[offerer] Fin de ICE en cola (EOC)");
        }
        return;
      }
      if (!remoteDescSet) {
        pendingRemoteIce.push(candidate);
        console.log("[offerer] ICE en cola (sin remoteDescription)");
      } else {
        await pc.addIceCandidate(candidate);
        console.log("[offerer] ICE candidate agregado");
      }
    } catch (err) {
      console.error("Error al agregar ICE candidate:", err);
    }
  });

  // Limpieza de listeners cuando cambie el estado de conexión
  const cleanup = () => {
    try {
      stopAnswers && stopAnswers();
    } catch (_) {}
    try {
      stopIce && stopIce();
    } catch (_) {}
  };
  pc.onconnectionstatechange = () => {
    console.log("Connection state change:", pc.connectionState);
    if (pc.connectionState === "connected") {
      console.log("Peers connected!");
      cleanup();
    } else if (pc.connectionState === "disconnected") {
      console.log("Peer disconnected");
    } else if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed"
    ) {
      console.log("Connection failed/closed");
      cleanup();
    }
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(
        "[offerer] Enviando ICE a",
        remoteId,
        event.candidate.candidate?.slice(0, 20) || ""
      );
      sendIceCandidate(myPeerId, remoteId, event.candidate);
    } else {
      console.log("[offerer] Fin de ICE → enviando EOC");
      sendIceCandidate(myPeerId, remoteId, { endOfCandidates: true });
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendOffer(myPeerId, remoteId, offer);

  // Devolver referencias por si se quieren usar externamente
  return { pc, dataChannel, stop: cleanup };
}

/**
 * escuchar ofertas/answers/ice de otros peers, responder y establecer conexión.
 * @returns {void}
 */
export async function ListenWebRTC() {
  if (!myPeerId) return;
  listenOffers(myPeerId, async (peerId, offer) => {
    const pc = new RTCPeerConnection({ iceServers });
    let remoteDescSet = false;
    const pendingRemoteIce = [];
    let gotRemoteIceEnd = false;
    pc.onicecandidateerror = (e) =>
      console.warn(
        "[answerer] ICE candidate error:",
        e.errorText || e.errorCode
      );
    pc.onsignalingstatechange = () =>
      console.log("[answerer] signaling:", pc.signalingState);
    pc.onicegatheringstatechange = () =>
      console.log("[answerer] iceGathering:", pc.iceGatheringState);
    pc.oniceconnectionstatechange = () =>
      console.log("[answerer] iceConnection:", pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      console.log("Connection state change:", pc.connectionState);
      if (pc.connectionState === "connected") {
        console.log("Peers connected!");
      } else if (pc.connectionState === "disconnected") {
        console.log("Peer disconnected");
      } else if (pc.connectionState === "failed") {
        console.log("Connection failed");
      }
    };
    // Como answerer, escuchar el DataChannel creado por el offerer
    pc.ondatachannel = (event) => {
      const dataChannel = event.channel;
      dataChannel.onopen = async () => {
        console.log("DataChannel abierto con:", peerId);
        try {
          // Mensajes simples para verificar conectividad desde el answerer
          dataChannel.send("ping-answerer");
          dataChannel.send(
            JSON.stringify({ __type: "info", msg: "hello-from-answerer" })
          );
          // Asegurar apertura de la DB antes de exportar
          await openDB("WatchTaskDB");
          const hasStore =
            (await checkPublicUsersStore()) ||
            (await ensureStore("public_users"));
          const usuarios = hasStore ? await exportarDatosPublicos() : [];
          const payload = { __type: "public_users", data: usuarios || [] };
          // Enviar el dataset completo (se asume tamaño pequeño). Para tamaños grandes, implementar chunking.
          dataChannel.send(JSON.stringify(payload));
          console.log(`Enviados ${payload.data.length} usuarios públicos`);
        } catch (err) {
          console.error("Error enviando public_users:", err);
        }
      };
      dataChannel.onclose = () =>
        console.log("DataChannel cerrado con:", peerId);
      dataChannel.onerror = (e) => console.error("DataChannel error:", e);
      // Opcional: manejar mensajes entrantes simétricos
      dataChannel.onmessage = async (e) => {
        try {
          console.log("[answerer] Mensaje recibido:", e.data);
          const msg = JSON.parse(e.data);
          if (msg && msg.__type === "public_users" && Array.isArray(msg.data)) {
            await openDB("WatchTaskDB");
            await ensureStore("public_users");
            await syncDatosPublicos(msg.data);
          } else if (msg && msg.__type === "info") {
            console.log("[answerer] info:", msg.msg);
          }
        } catch (err) {
          if (typeof e.data === "string") {
            console.log("[answerer] texto plano:", e.data);
          }
        }
      };
    };
    console.log("Received offer from peer:", peerId);
    if (offer && pc) {
      const stopIce = listenIceCandidates(
        myPeerId,
        async (fromId, candidate) => {
          // Aceptar candidatos de este oferente únicamente
          if (fromId !== peerId) return;
          try {
            console.log("[answerer] Recibido ICE de:", fromId);
            if (candidate && candidate.endOfCandidates) {
              if (remoteDescSet) {
                try {
                  await pc.addIceCandidate(null);
                  console.log("[answerer] Fin de ICE aplicado (null)");
                } catch (_) {}
              } else {
                gotRemoteIceEnd = true;
                console.log("[answerer] Fin de ICE en cola (EOC)");
              }
              return;
            }
            if (!remoteDescSet) {
              pendingRemoteIce.push(candidate);
              console.log(
                "[answerer] ICE en cola (antes de setRemoteDescription)"
              );
            } else {
              await pc.addIceCandidate(candidate);
            }
          } catch (err) {
            console.error("Error al agregar ICE candidate:", err);
          }
        }
      );
      // Configurar envío de ICE ANTES de generar la answer para no perder candidatos tempranos
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          // Enviar ICE de vuelta al oferente (peerId)
          console.log(
            "[answerer] Enviando ICE a",
            peerId,
            event.candidate.candidate?.slice(0, 20) || ""
          );
          sendIceCandidate(myPeerId, peerId, event.candidate);
        }
      };
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescSet = true;
      // Drenar candidatos ICE pendientes
      if (pendingRemoteIce.length) {
        console.log(
          `[answerer] Agregando ${pendingRemoteIce.length} ICE pendientes`
        );
        for (const cand of pendingRemoteIce.splice(0)) {
          try {
            await pc.addIceCandidate(cand);
          } catch (err) {
            console.error("[answerer] Error agregando ICE pendiente:", err);
          }
        }
      }
      if (gotRemoteIceEnd) {
        try {
          await pc.addIceCandidate(null);
          console.log("[answerer] Fin de ICE aplicado (null)");
        } catch (_) {}
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendAnswer(myPeerId, peerId, answer);
      // Limpieza al cerrar/fracasar
      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed" ||
          pc.connectionState === "disconnected"
        ) {
          try {
            stopIce && stopIce();
          } catch (_) {}
        }
      };
    }
  });
}
