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
// Nota: Para NAT estrictos se recomienda TURN. Configurable por env: VITE_TURN_URL, VITE_TURN_USER, VITE_TURN_CREDENTIAL
const baseStun = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// Carga dinámica de servidores TURN desde variables de entorno
const getTurnServers = () => {
  try {
    const url = import.meta.env.VITE_TURN_URL;
    const username = import.meta.env.VITE_TURN_USER;
    const credential = import.meta.env.VITE_TURN_CREDENTIAL;

    if (!url || !username || !credential) {
      console.warn("Configuración TURN incompleta. Usando solo STUN.");
      return [];
    }

    // Manejar múltiples URLs separadas por coma
    const urls = url.includes(",") ? url.split(",").map((s) => s.trim()) : url;

    console.log(
      "Usando servidores TURN:",
      Array.isArray(urls) ? urls.join(", ") : urls
    );
    return [{ urls, username, credential }];
  } catch (err) {
    console.error("Error al configurar TURN:", err);
    return [];
  }
};

// Configuración dinámica de servidores ICE
const getTurnConfig = () => {
  const turnServers = getTurnServers();
  const hasTurn = turnServers.length > 0;
  const iceServers = [...baseStun, ...turnServers];

  // Modo debug para ver más información en consola
  const debug = import.meta.env.VITE_DEBUG_WEBRTC === "true";
  if (debug) {
    console.log("Configuración ICE:", {
      servidores: iceServers.length,
      hasTurn,
      modo: hasTurn ? "relay forzado" : "cualquier candidato",
    });
  }

  return {
    hasTurn,
    config: hasTurn
      ? {
          iceServers,
          iceTransportPolicy: "relay",
          iceCandidatePoolSize: 5, // Reservar candidatos para arranque más rápido
        }
      : {
          iceServers,
          iceCandidatePoolSize: 5,
        },
  };
};

// Obtener configuración RTCPeerConnection para la conexión actual
function getRTCConfig() {
  const { hasTurn, config } = getTurnConfig();
  // Si hay TURN, forzar RELAY para evitar intentos directos bloqueados por NAT/Firewall
  return config;
}

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
 * connectWithPeer
 * conectar con un peer específico y sincronizar datos.
 * @param {string} remoteId ID del peer remoto
 * @returns {Promise<Object>} Referencias al PC y dataChannel
 */
export async function connectWithPeer(remoteId) {
  if (!myPeerId) return;
  console.log("Connecting to peer:", remoteId);

  // Usar timeout para detectar problemas de conexión
  const connectionTimeout = setTimeout(() => {
    console.warn(
      "Timeout de conexión - es posible que necesites un servidor TURN"
    );
  }, 15000);

  const pc = new RTCPeerConnection(getRTCConfig());
  let remoteDescSet = false;
  const pendingRemoteIce = [];
  let gotRemoteIceEnd = false;
  let connectionClosed = false;

  // Mejorar monitorización de errores ICE
  pc.onicecandidateerror = (e) => {
    const errorMsg = e.errorText || e.errorCode;
    console.warn("[offerer] ICE candidate error:", errorMsg);

    // Si vemos errores de timeout en STUN, sugerir TURN
    if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
      console.warn(
        "⚠️ Detectado timeout de STUN - Verifica tu configuración TURN en .env.local"
      );
    }
  };

  // Monitorizar estados de la negociación
  pc.onnegotiationneeded = () => console.log("[offerer] negotiationneeded");
  pc.onsignalingstatechange = () => {
    console.log("[offerer] signaling:", pc.signalingState);
    if (pc.signalingState === "stable") {
      console.log("[offerer] Señalización completada");
    }
  };

  pc.onicegatheringstatechange = () => {
    console.log("[offerer] iceGathering:", pc.iceGatheringState);
    if (pc.iceGatheringState === "complete") {
      console.log("[offerer] Recolección ICE completada");
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("[offerer] iceConnection:", pc.iceConnectionState);

    // Monitorizar estados de conexión ICE críticos
    if (
      pc.iceConnectionState === "connected" ||
      pc.iceConnectionState === "completed"
    ) {
      console.log(
        "✅ [offerer] Conexión ICE establecida:",
        pc.iceConnectionState
      );
      clearTimeout(connectionTimeout);
    } else if (pc.iceConnectionState === "failed") {
      console.error(
        "❌ [offerer] Conexión ICE fallida - intenta añadir un servidor TURN"
      );

      // Solo si no se ha cerrado ya la conexión
      if (!connectionClosed) {
        console.log("[offerer] Intentando reiniciar ICE...");
        try {
          pc.restartIce();
        } catch (e) {
          console.error("Error al reiniciar ICE:", e);
        }
      }
    } else if (pc.iceConnectionState === "disconnected") {
      console.warn(
        "⚠️ [offerer] Conexión ICE interrumpida - puede recuperarse automáticamente"
      );
    }
  };

  // Crear DataChannel del lado que inicia (offerer)
  const dataChannel = pc.createDataChannel("p2p", {
    ordered: true,
    maxRetransmits: 3, // Reintentar mensajes fallidos hasta 3 veces
  });

  // Monitorizar estado del DataChannel
  dataChannel.onopen = () => {
    console.log("✅ DataChannel abierto con:", remoteId);
    clearTimeout(connectionTimeout);

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

  dataChannel.onclose = () => {
    console.log("DataChannel cerrado con:", remoteId);
    connectionClosed = true;
  };

  dataChannel.onerror = (e) => {
    console.error("DataChannel error:", e);
    // Intentar reconectar si hay un error
    if (!connectionClosed) {
      console.log("Intentando reconectar después de error...");
    }
  };
  // Recepción de datos del callee (usuarios públicos)
  dataChannel.onmessage = async (e) => {
    try {
      console.log(
        `[offerer] Mensaje recibido de ${remoteId}:`,
        e.data.substring(0, 100) + (e.data.length > 100 ? "..." : "")
      );

      // Intentar parsear como JSON
      try {
        const msg = JSON.parse(e.data);

        // Manejar diferentes tipos de mensajes
        if (msg && msg.__type === "public_users" && Array.isArray(msg.data)) {
          console.log(
            `📥 [offerer] Recibidos ${msg.data.length} usuarios públicos de ${remoteId}`
          );

          // Asegurar que la base de datos está abierta
          await openDB("WatchTaskDB");
          await ensureStore("public_users");

          // Sincronizar datos recibidos
          await syncDatosPublicos(msg.data);
          console.log(
            `✅ [offerer] Sincronizados ${msg.data.length} usuarios públicos de ${remoteId}`
          );

          // Confirmar sincronización
          try {
            dataChannel.send(
              JSON.stringify({
                __type: "info",
                msg: `sync-complete-${msg.data.length}`,
              })
            );
          } catch (_) {}
        } else if (msg && msg.__type === "info") {
          console.log(`[offerer] Info de ${remoteId}:`, msg.msg);
        } else if (msg && msg.__type === "error") {
          console.error(`[offerer] Error de ${remoteId}:`, msg.code, msg.msg);
        } else {
          console.log(`[offerer] Mensaje no reconocido de ${remoteId}:`, msg);
        }
      } catch (jsonErr) {
        // No es JSON, manejar como texto plano
        if (typeof e.data === "string") {
          console.log(`[offerer] Texto plano de ${remoteId}:`, e.data);
        } else {
          console.warn(
            `[offerer] Datos binarios o no reconocidos de ${remoteId}`
          );
        }
      }
    } catch (err) {
      console.error(
        `❌ [offerer] Error procesando mensaje de ${remoteId}:`,
        err
      );
    }
  };

  // Suscribirse a respuestas e ICE dirigidos a este peer y desde el remoto seleccionado
  const stopAnswers = listenAnswers(myPeerId, async (fromId, answer) => {
    if (fromId !== remoteId) return;

    try {
      console.log(`Recibida respuesta de ${fromId}`);
      await pc.setRemoteDescription(answer);
      console.log(`✅ Respuesta aplicada de ${fromId}`);
      remoteDescSet = true;

      // Drenar candidatos ICE pendientes
      if (pendingRemoteIce.length) {
        console.log(
          `[offerer] Aplicando ${pendingRemoteIce.length} ICE pendientes de ${fromId}`
        );
        for (const cand of pendingRemoteIce.splice(0)) {
          try {
            await pc.addIceCandidate(cand);
            console.log(`[offerer] ICE pendiente aplicado de ${fromId}`);
          } catch (err) {
            console.error(
              `[offerer] Error al agregar ICE pendiente de ${fromId}:`,
              err
            );
          }
        }
      }

      // Aplicar fin de candidatos si estaba pendiente
      if (gotRemoteIceEnd) {
        try {
          await pc.addIceCandidate(null);
          console.log(
            `[offerer] ✅ Fin de ICE aplicado (null) pendiente de ${fromId}`
          );
        } catch (_) {}
      }
    } catch (err) {
      console.error(`❌ Error al aplicar respuesta de ${fromId}:`, err);
    }
  });

  const stopIce = listenIceCandidates(myPeerId, async (fromId, candidate) => {
    if (fromId !== remoteId) return;

    try {
      console.log(`[offerer] ICE recibido de ${fromId}`);

      // Manejar fin de candidatos
      if (candidate && candidate.endOfCandidates) {
        if (remoteDescSet) {
          try {
            await pc.addIceCandidate(null);
            console.log(`[offerer] ✅ Fin de ICE aplicado (null) de ${fromId}`);
          } catch (_) {}
        } else {
          gotRemoteIceEnd = true;
          console.log(`[offerer] ⏳ Fin de ICE en cola (EOC) de ${fromId}`);
        }
        return;
      }

      // Encolar candidatos si aún no hay remoteDescription
      if (!remoteDescSet) {
        pendingRemoteIce.push(candidate);
        console.log(
          `[offerer] ⏳ ICE en cola (${pendingRemoteIce.length}) de ${fromId}`
        );
      } else {
        await pc.addIceCandidate(candidate);
        console.log(`[offerer] ✅ ICE aplicado de ${fromId}`);
      }
    } catch (err) {
      console.error(`❌ Error al agregar ICE de ${fromId}:`, err);
    }
  });

  // Limpieza de listeners cuando cambie el estado de conexión
  const cleanup = () => {
    console.log(`Limpiando conexión con ${remoteId}`);
    try {
      stopAnswers && stopAnswers();
    } catch (_) {}
    try {
      stopIce && stopIce();
    } catch (_) {}
    connectionClosed = true;
  };

  pc.onconnectionstatechange = () => {
    console.log(`Estado de conexión con ${remoteId}:`, pc.connectionState);

    if (pc.connectionState === "connected") {
      console.log(`✅ Conexión establecida con ${remoteId}`);
      clearTimeout(connectionTimeout);
    } else if (pc.connectionState === "disconnected") {
      console.log(`⚠️ Desconexión con ${remoteId}`);
    } else if (pc.connectionState === "failed") {
      console.error(`❌ Fallo de conexión con ${remoteId}`);
      cleanup();
    } else if (pc.connectionState === "closed") {
      console.log(`Conexión cerrada con ${remoteId}`);
      cleanup();
    }
  };

  // Envío de candidatos ICE
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(
        `[offerer] Enviando ICE a ${remoteId}`,
        event.candidate.candidate?.slice(0, 20) || ""
      );
      sendIceCandidate(myPeerId, remoteId, event.candidate);
    } else {
      console.log(`[offerer] Fin de ICE → enviando EOC a ${remoteId}`);
      sendIceCandidate(myPeerId, remoteId, { endOfCandidates: true });
    }
  };

  // Crear y enviar oferta
  try {
    console.log(`Creando oferta para ${remoteId}...`);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`Enviando oferta a ${remoteId}...`);
    await sendOffer(myPeerId, remoteId, offer);
    console.log(`✅ Oferta enviada a ${remoteId}`);
  } catch (err) {
    console.error(`❌ Error creando/enviando oferta a ${remoteId}:`, err);
    cleanup();
  }

  // Devolver referencias por si se quieren usar externamente
  return {
    pc,
    dataChannel,
    stop: cleanup,
    // Método para enviar usuarios públicos explícitamente
    sendPublicUsers: async () => {
      if (dataChannel.readyState !== "open") {
        console.warn(`⚠️ DataChannel no está abierto con ${remoteId}`);
        return false;
      }

      try {
        console.log(`Enviando usuarios públicos a ${remoteId}...`);
        await openDB("WatchTaskDB");
        const hasStore = await ensureStore("public_users");
        if (!hasStore) {
          console.warn("⚠️ No se pudo crear/verificar el store public_users");
          return false;
        }

        const usuarios = await exportarDatosPublicos();
        const payload = { __type: "public_users", data: usuarios || [] };
        dataChannel.send(JSON.stringify(payload));
        console.log(
          `✅ Enviados ${payload.data.length} usuarios públicos a ${remoteId}`
        );
        return true;
      } catch (err) {
        console.error(
          `❌ Error enviando usuarios públicos a ${remoteId}:`,
          err
        );
        return false;
      }
    },
  };
}

/**
 * escuchar ofertas/answers/ice de otros peers, responder y establecer conexión.
 * @returns {Function} Función para detener la escucha
 */
export async function ListenWebRTC() {
  if (!myPeerId) return;
  console.log("👂 Iniciando escucha de ofertas WebRTC...");

  // Crear una referencia al unsubscribe para devolverla
  let stopListening = null;

  // Lista de conexiones activas para limpiar
  const activeConnections = new Map();

  // Función para limpiar una conexión
  const cleanupConnection = (peerId) => {
    try {
      const connection = activeConnections.get(peerId);
      if (connection) {
        console.log(`Limpiando conexión con ${peerId}`);
        if (connection.stopIce) connection.stopIce();
        if (connection.pc) {
          try {
            connection.pc.close();
          } catch (_) {}
        }
        activeConnections.delete(peerId);
      }
    } catch (e) {
      console.error(`Error limpiando conexión con ${peerId}:`, e);
    }
  };

  // Función para limpiar todas las conexiones
  const cleanupAllConnections = () => {
    console.log(`Limpiando ${activeConnections.size} conexiones activas`);
    for (const peerId of activeConnections.keys()) {
      cleanupConnection(peerId);
    }
  };

  stopListening = listenOffers(myPeerId, async (peerId, offer) => {
    console.log(`📥 Recibida oferta de ${peerId}`);

    // Limpiar cualquier conexión previa con este peer
    if (activeConnections.has(peerId)) {
      console.log(`Conexión previa detectada con ${peerId}, limpiando...`);
      cleanupConnection(peerId);
    }

    // Timeout para detectar problemas de conexión
    const connectionTimeout = setTimeout(() => {
      console.warn(
        `⏱️ Timeout de conexión con ${peerId} - es posible que necesites TURN`
      );
    }, 20000); // 20 segundos es un buen tiempo para detectar problemas

    const pc = new RTCPeerConnection(getRTCConfig());
    let remoteDescSet = false;
    const pendingRemoteIce = [];
    let gotRemoteIceEnd = false;
    let connectionClosed = false;

    // Mejorar monitorización de errores ICE
    pc.onicecandidateerror = (e) => {
      const errorMsg = e.errorText || e.errorCode;
      console.warn(`[answerer] ❌ ICE error con ${peerId}:`, errorMsg);

      // Si vemos errores de timeout en STUN, sugerir TURN
      if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
        console.warn(
          "⚠️ Detectado timeout de STUN - Verifica tu configuración TURN en .env.local"
        );
      }
    };

    // Monitorizar estados de la negociación
    pc.onnegotiationneeded = () =>
      console.log(`[answerer] Renegociación necesaria con ${peerId}`);

    pc.onsignalingstatechange = () => {
      console.log(`[answerer] Señalización con ${peerId}:`, pc.signalingState);
      if (pc.signalingState === "stable") {
        console.log(`[answerer] ✅ Señalización completada con ${peerId}`);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(
        `[answerer] ICE gathering con ${peerId}:`,
        pc.iceGatheringState
      );
      if (pc.iceGatheringState === "complete") {
        console.log(`[answerer] ✅ Recolección ICE completada con ${peerId}`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(
        `[answerer] ICE connection con ${peerId}:`,
        pc.iceConnectionState
      );

      // Monitorizar estados de conexión ICE críticos
      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        console.log(
          `✅ [answerer] Conexión ICE establecida con ${peerId}:`,
          pc.iceConnectionState
        );
        clearTimeout(connectionTimeout);
      } else if (pc.iceConnectionState === "failed") {
        console.error(
          `❌ [answerer] Conexión ICE fallida con ${peerId} - intenta añadir un servidor TURN`
        );

        // Solo si no se ha cerrado ya la conexión
        if (!connectionClosed) {
          console.log(`[answerer] Intentando reiniciar ICE con ${peerId}...`);
          try {
            pc.restartIce();
          } catch (e) {
            console.error(`Error al reiniciar ICE con ${peerId}:`, e);
          }
        }
      } else if (pc.iceConnectionState === "disconnected") {
        console.warn(
          `⚠️ [answerer] Conexión ICE interrumpida con ${peerId} - puede recuperarse automáticamente`
        );
      } else if (pc.iceConnectionState === "closed") {
        console.log(`[answerer] Conexión ICE cerrada con ${peerId}`);
        connectionClosed = true;
        clearTimeout(connectionTimeout);
        cleanupConnection(peerId);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(
        `[answerer] Estado de conexión con ${peerId}:`,
        pc.connectionState
      );
      if (pc.connectionState === "connected") {
        console.log(`✅ [answerer] Conexión establecida con ${peerId}`);
        clearTimeout(connectionTimeout);
      } else if (pc.connectionState === "disconnected") {
        console.log(`⚠️ [answerer] Desconexión con ${peerId}`);
      } else if (pc.connectionState === "failed") {
        console.error(`❌ [answerer] Fallo de conexión con ${peerId}`);
        clearTimeout(connectionTimeout);
        cleanupConnection(peerId);
      } else if (pc.connectionState === "closed") {
        console.log(`[answerer] Conexión cerrada con ${peerId}`);
        connectionClosed = true;
        clearTimeout(connectionTimeout);
        cleanupConnection(peerId);
      }
    };
    // Como answerer, escuchar el DataChannel creado por el offerer
    pc.ondatachannel = (event) => {
      const dataChannel = event.channel;

      console.log(`📢 DataChannel recibido de ${peerId}: ${dataChannel.label}`);

      dataChannel.onopen = async () => {
        console.log(`✅ DataChannel abierto con ${peerId}`);
        clearTimeout(connectionTimeout);

        try {
          // Mensajes simples para verificar conectividad desde el answerer
          dataChannel.send("ping-answerer");
          dataChannel.send(
            JSON.stringify({ __type: "info", msg: "hello-from-answerer" })
          );

          // Asegurar apertura de la DB antes de exportar
          console.log("Abriendo base de datos para sincronización...");
          await openDB("WatchTaskDB");

          // Crear el store si no existe
          const hasStore =
            (await checkPublicUsersStore()) ||
            (await ensureStore("public_users"));

          if (!hasStore) {
            console.warn("⚠️ No se pudo crear/verificar el store public_users");
            dataChannel.send(
              JSON.stringify({
                __type: "error",
                code: "STORE_ERROR",
                msg: "No se pudo crear/verificar el store public_users",
              })
            );
            return;
          }

          console.log("Exportando datos públicos para enviar...");
          const usuarios = await exportarDatosPublicos();
          console.log(
            `Encontrados ${usuarios?.length || 0} usuarios para enviar`
          );

          const payload = { __type: "public_users", data: usuarios || [] };

          // Enviar el dataset completo (se asume tamaño pequeño)
          dataChannel.send(JSON.stringify(payload));
          console.log(
            `✅ Enviados ${payload.data.length} usuarios públicos a ${peerId}`
          );
        } catch (err) {
          console.error(`❌ Error enviando public_users a ${peerId}:`, err);
          try {
            dataChannel.send(
              JSON.stringify({
                __type: "error",
                code: "SYNC_ERROR",
                msg: `Error: ${err.message || "Error desconocido"}`,
              })
            );
          } catch (_) {}
        }
      };

      dataChannel.onclose = () => {
        console.log(`DataChannel cerrado con ${peerId}`);
        connectionClosed = true;
      };

      dataChannel.onerror = (e) => {
        console.error(`❌ DataChannel error con ${peerId}:`, e);
      };

      // Manejar mensajes entrantes del offerer
      dataChannel.onmessage = async (e) => {
        try {
          console.log(
            `[answerer] Mensaje recibido de ${peerId}:`,
            e.data.substring(0, 100) + (e.data.length > 100 ? "..." : "")
          );

          // Intentar parsear como JSON
          try {
            const msg = JSON.parse(e.data);

            // Manejar diferentes tipos de mensajes
            if (
              msg &&
              msg.__type === "public_users" &&
              Array.isArray(msg.data)
            ) {
              console.log(
                `📥 Recibidos ${msg.data.length} usuarios públicos de ${peerId}`
              );

              // Asegurar que la base de datos está abierta
              await openDB("WatchTaskDB");
              await ensureStore("public_users");

              // Sincronizar datos recibidos
              await syncDatosPublicos(msg.data);
              console.log(
                `✅ Sincronizados ${msg.data.length} usuarios públicos de ${peerId}`
              );

              // Confirmar sincronización
              try {
                dataChannel.send(
                  JSON.stringify({
                    __type: "info",
                    msg: `sync-complete-${msg.data.length}`,
                  })
                );
              } catch (_) {}
            } else if (msg && msg.__type === "info") {
              console.log(`[answerer] Info de ${peerId}:`, msg.msg);
            } else if (msg && msg.__type === "error") {
              console.error(
                `[answerer] Error de ${peerId}:`,
                msg.code,
                msg.msg
              );
            } else {
              console.log(
                `[answerer] Mensaje no reconocido de ${peerId}:`,
                msg
              );
            }
          } catch (jsonErr) {
            // No es JSON, manejar como texto plano
            if (typeof e.data === "string") {
              console.log(`[answerer] Texto plano de ${peerId}:`, e.data);
            } else {
              console.warn(
                `[answerer] Datos binarios o no reconocidos de ${peerId}`
              );
            }
          }
        } catch (err) {
          console.error(`❌ Error procesando mensaje de ${peerId}:`, err);
        }
      };
    };

    console.log(`Procesando oferta de ${peerId}...`);

    if (offer && pc) {
      // Escuchar ICE candidates del oferente
      const stopIce = listenIceCandidates(
        myPeerId,
        async (fromId, candidate) => {
          // Aceptar candidatos de este oferente únicamente
          if (fromId !== peerId) return;

          try {
            console.log(`[answerer] ICE recibido de ${fromId}`);

            // Manejar fin de candidatos
            if (candidate && candidate.endOfCandidates) {
              if (remoteDescSet) {
                try {
                  await pc.addIceCandidate(null);
                  console.log(
                    `[answerer] ✅ Fin de ICE aplicado (null) de ${fromId}`
                  );
                } catch (_) {}
              } else {
                gotRemoteIceEnd = true;
                console.log(
                  `[answerer] ⏳ Fin de ICE en cola (EOC) de ${fromId}`
                );
              }
              return;
            }

            // Encolar candidatos si aún no hay remoteDescription
            if (!remoteDescSet) {
              pendingRemoteIce.push(candidate);
              console.log(
                `[answerer] ⏳ ICE en cola (${pendingRemoteIce.length}) de ${fromId}`
              );
            } else {
              await pc.addIceCandidate(candidate);
              console.log(`[answerer] ✅ ICE aplicado de ${fromId}`);
            }
          } catch (err) {
            console.error(`❌ Error al agregar ICE de ${fromId}:`, err);
          }
        }
      );

      // Guardar referencia para limpieza
      activeConnections.set(peerId, { pc, stopIce });

      // Configurar envío de ICE ANTES de generar la answer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          // Enviar ICE de vuelta al oferente (peerId)
          console.log(
            `[answerer] Enviando ICE a ${peerId}`,
            event.candidate.candidate?.slice(0, 20) || ""
          );
          sendIceCandidate(myPeerId, peerId, event.candidate);
        } else {
          // Enviar marcador de fin de candidatos
          console.log(`[answerer] Fin de ICE → enviando EOC a ${peerId}`);
          sendIceCandidate(myPeerId, peerId, { endOfCandidates: true });
        }
      };

      try {
        // Aplicar la oferta recibida
        console.log(`Aplicando oferta de ${peerId}...`);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        remoteDescSet = true;
        console.log(`✅ Oferta aplicada de ${peerId}`);

        // Drenar candidatos ICE pendientes
        if (pendingRemoteIce.length) {
          console.log(
            `[answerer] Aplicando ${pendingRemoteIce.length} ICE pendientes de ${peerId}`
          );
          for (const cand of pendingRemoteIce.splice(0)) {
            try {
              await pc.addIceCandidate(cand);
            } catch (err) {
              console.error(
                `❌ [answerer] Error agregando ICE pendiente de ${peerId}:`,
                err
              );
            }
          }
        }

        // Aplicar fin de candidatos si estaba pendiente
        if (gotRemoteIceEnd) {
          try {
            await pc.addIceCandidate(null);
            console.log(
              `[answerer] ✅ Fin de ICE aplicado (null) pendiente de ${peerId}`
            );
          } catch (_) {}
        }

        // Crear respuesta
        console.log(`Creando respuesta para ${peerId}...`);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`Enviando respuesta a ${peerId}...`);
        await sendAnswer(myPeerId, peerId, answer);
        console.log(`✅ Respuesta enviada a ${peerId}`);
      } catch (err) {
        console.error(`❌ Error procesando oferta de ${peerId}:`, err);
        cleanupConnection(peerId);
      }
    }
  });

  // Devolver función para detener la escucha
  return () => {
    console.log("Deteniendo escucha WebRTC...");
    if (stopListening) stopListening();
    cleanupAllConnections();
  };
}
