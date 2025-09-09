import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid"; // library uuid (fallback below if unavailable)
import {
  db,
  ref,
  set,
  onValue,
  push,
  remove,
  onDisconnect,
  update,
  get,
  child,
} from "../../firebase";
import { openDB } from "idb";

// Lightweight fallback UUID (RFC4122-ish) in case uuid library not present
function fallbackUUID() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

const PEERS_PATH = "peers";
const PROFILES_DB = "profilesDB";
const PROFILES_STORE = "profiles";
const ORDERS_DB = "pdfDataDB"; // existing orders DB
const ORDERS_STORE = "pdfData";

// Ensure profiles DB & store
async function getProfilesDB() {
  return openDB(PROFILES_DB, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PROFILES_STORE)) {
        db.createObjectStore(PROFILES_STORE, { keyPath: "code" });
      }
    },
  });
}

export function usePeerMesh({ autoStart = true } = {}) {
  const [peerId] = useState(() => fallbackUUID());
  const [profile, setProfile] = useState(null); // active logged profile
  const [knownProfiles, setKnownProfiles] = useState([]); // from IndexedDB
  const [peers, setPeers] = useState({}); // map peerId -> {profile?, state}
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("idle");
  const [loginValidated, setLoginValidated] = useState(false);
  const pendingValidationRef = useRef(null); // code awaiting remote validation

  const peerConnectionsRef = useRef({}); // peerId -> { pc, dc }
  // Track last profiles length sent per peer to allow re-sync on additions
  const profilesSentRef = useRef({}); // peerId -> number (length)
  const unsubPeersRef = useRef(null);
  const isAdminRef = useRef(false);
  const profileRequestTimerRef = useRef(null); // interval id for requestProfiles retries
  const pingSeqRef = useRef(0); // incremental sequence para ping
  const pendingPingsRef = useRef({}); // seq -> timestamp
  const pingIntervalRef = useRef(null);

  // UTIL LOG
  const log = useCallback((m) => setMessages((prev) => [...prev, m]), []);

  // Load all profiles from IndexedDB
  const refreshProfiles = useCallback(async () => {
    const dbp = await getProfilesDB();
    const all = await dbp.getAll(PROFILES_STORE);
    setKnownProfiles(all);
  }, []);

  const storeProfile = useCallback(
    async (prof) => {
      if (!prof || !prof.code) return;
      const dbp = await getProfilesDB();
      const existing = await dbp.get(PROFILES_STORE, prof.code);
      if (!existing) {
        await dbp.put(PROFILES_STORE, prof);
        await refreshProfiles();
        log(`Perfil ${prof.code} almacenado`);
      }
    },
    [refreshProfiles, log]
  );

  // Definir antes de createConnectionToPeer para evitar ReferenceError en array de dependencias
  const handleDataMessage = useCallback(
    (fromId, raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.__type === "profile") {
          setPeers((p) => ({
            ...p,
            [fromId]: { ...(p[fromId] || {}), profile: msg.profile },
          }));
          storeProfile(msg.profile);
          return;
        }
        if (msg.__type === "profilesSync" && Array.isArray(msg.profiles)) {
          msg.profiles.forEach((pf) => storeProfile(pf));
          return;
        }
        if (msg.__type === "requestProfiles") {
          // remote solicita base de perfiles
          if (knownProfiles.length) {
            const entry = peerConnectionsRef.current[fromId];
            const lastLen = profilesSentRef.current[fromId] || 0;
            if (
              entry?.dc?.readyState === "open" &&
              lastLen < knownProfiles.length
            ) {
              entry.dc.send(
                JSON.stringify({
                  __type: "profilesSync",
                  profiles: knownProfiles,
                })
              );
              profilesSentRef.current[fromId] = knownProfiles.length;
              log(
                `[sync:respond] Enviado profilesSync a ${fromId} tras request`
              );
            }
          }
          return;
        }
        if (msg.__type === "loginValidateRequest") {
          const { code, password } = msg;
          (async () => {
            const dbp = await getProfilesDB();
            const pf = await dbp.get(PROFILES_STORE, code);
            const ok = !!pf && (!pf.password || pf.password === password);
            const entry = peerConnectionsRef.current[fromId];
            if (entry?.dc?.readyState === "open") {
              entry.dc.send(
                JSON.stringify({ __type: "loginValidateResult", code, ok })
              );
            }
          })();
          return;
        }
        if (msg.__type === "loginValidateResult") {
          if (
            pendingValidationRef.current &&
            pendingValidationRef.current.code === msg.code &&
            msg.ok
          ) {
            setLoginValidated(true);
            pendingValidationRef.current = null;
            setStatus("login validado (remoto)");
            log("Login validado remotamente");
          }
          return;
        }
        if (msg.__type === "ping") {
          const entry = peerConnectionsRef.current[fromId];
          if (entry?.dc?.readyState === "open") {
            entry.dc.send(
              JSON.stringify({ __type: "pong", seq: msg.seq, t: msg.t })
            );
          }
          log(`[ping<-] de ${fromId} seq=${msg.seq}`);
          return;
        }
        if (msg.__type === "pong") {
          const sent = pendingPingsRef.current[msg.seq];
          if (sent) {
            const rtt = Date.now() - sent;
            delete pendingPingsRef.current[msg.seq];
            log(`[pong<-] de ${fromId} seq=${msg.seq} rtt=${rtt}ms`);
          } else {
            log(`[pong<-] desconocido seq=${msg.seq} de ${fromId}`);
          }
          return;
        }
      } catch {}
      log(`${fromId}: ${raw}`);
    },
    [log, storeProfile, knownProfiles]
  );

  // Seed root admin (testing) code 1111 / pass 1234
  const seedRootAdmin = useCallback(async () => {
    try {
      const dbp = await getProfilesDB();
      const existing = await dbp.get(PROFILES_STORE, "1111");
      if (!existing) {
        const root = {
          code: "1111",
          name: "Root Admin",
          uuid: fallbackUUID(),
          role: "admin",
          speciality: "admin",
          password: "1234",
        };
        await dbp.put(PROFILES_STORE, root);
        log("Perfil root admin creado (1111 / 1234)");
        await refreshProfiles();
      }
    } catch (e) {
      log("No se pudo crear root admin");
    }
  }, [log, refreshProfiles]);

  // Add profile (admin only)
  const addProfile = useCallback(
    async (profileObj) => {
      if (!isAdminRef.current)
        throw new Error("Solo admin puede agregar perfiles");
      const dbp = await getProfilesDB();
      await dbp.put(PROFILES_STORE, profileObj);
      await refreshProfiles();
      // Broadcast nuevo perfil a la red
      Object.values(peerConnectionsRef.current).forEach(({ dc }) => {
        if (dc?.readyState === "open") {
          dc.send(JSON.stringify({ __type: "profile", profile: profileObj }));
          // Forzar posible re-sync completo (el efecto de profiles enviará si length creció)
        }
      });
    },
    [refreshProfiles]
  );

  // Validate login via another connected peer (simplified: local DB lookup only for now)
  const login = useCallback(
    async (code, password) => {
      const dbp = await getProfilesDB();
      const prof = await dbp.get(PROFILES_STORE, code);
      if (!prof) throw new Error("Perfil no encontrado local");
      if (prof.password && prof.password !== password)
        throw new Error("Password incorrecto local");
      // Si no hay peers conectados (ningún canal abierto / conexión conocida), validar inmediatamente
      const hasAnyPeer = Object.values(peerConnectionsRef.current).some(
        ({ dc }) => dc?.readyState === "open" || dc?.readyState === "connecting"
      );
      setProfile(prof); // provisional login local
      isAdminRef.current = prof.role === "admin";
      if (!hasAnyPeer) {
        setLoginValidated(true);
        setStatus("login validado (sin peers)");
        log("Login validado localmente (no peers disponibles)");
        return;
      }
      // solicitar validación remota
      setStatus("validando login remoto");
      pendingValidationRef.current = { code, password };
      const sendRequest = () => {
        Object.values(peerConnectionsRef.current).forEach(({ dc }) => {
          if (dc?.readyState === "open") {
            dc.send(
              JSON.stringify({ __type: "loginValidateRequest", code, password })
            );
          }
        });
      };
      sendRequest();
      // Retry up to 3 times if not yet validated
      let attempts = 0;
      const interval = setInterval(() => {
        if (loginValidated) {
          clearInterval(interval);
          return;
        }
        attempts++;
        sendRequest();
        if (attempts >= 2) {
          // total 3 envíos: inicial + 2 retries
          clearInterval(interval);
        }
      }, 1200);
      // Timeout fallback 4s (un poco más largo para permitir retries)
      setTimeout(() => {
        if (!loginValidated) {
          setLoginValidated(true);
          setStatus("login validado (fallback)");
          log("Login validado por fallback tras retries");
        }
      }, 4000);
    },
    [log, loginValidated]
  );

  // Register this peer presence
  const registerPresence = useCallback(async () => {
    const myRef = ref(db, `${PEERS_PATH}/${peerId}`);
    await set(myRef, { ts: Date.now(), profileCode: null, profileName: null });
    onDisconnect(myRef)
      .remove()
      .catch(() => {});
  }, [peerId]);

  // Discover peers
  const startPeerListener = useCallback(() => {
    if (unsubPeersRef.current) return; // already
    const peersRef = ref(db, PEERS_PATH);
    unsubPeersRef.current = onValue(peersRef, (snap) => {
      const val = snap.val() || {};
      const others = Object.keys(val).filter((id) => id !== peerId);
      // Add new PCs for unknown peers
      others.forEach((id) => {
        if (!peerConnectionsRef.current[id]) createConnectionToPeer(id);
      });
      // Remove stale peers
      Object.keys(peerConnectionsRef.current).forEach((id) => {
        if (!others.includes(id)) {
          peerConnectionsRef.current[id].pc.close();
          delete peerConnectionsRef.current[id];
          setPeers((p) => ({
            ...p,
            [id]: { ...(p[id] || {}), state: "offline" },
          }));
        }
      });
      // merge presence metadata into peers state for quick recognition
      setPeers((prev) => {
        const updated = { ...prev };
        others.forEach((id) => {
          const presence = val[id] || {};
          updated[id] = {
            ...(updated[id] || {}),
            presenceProfileCode: presence.profileCode || null,
            presenceProfileName: presence.profileName || null,
          };
        });
        return updated;
      });
    });
  }, [peerId]);

  // Negotiation helpers moved above createConnectionToPeer to avoid TDZ
  const negotiate = useCallback(
    async (targetId) => {
      const entry = peerConnectionsRef.current[targetId];
      if (!entry) return;
      const { pc } = entry;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const offerRef = ref(db, `${PEERS_PATH}/${targetId}/offers/${peerId}`);
        await set(offerRef, offer);
      } catch (e) {
        log(`Error creando offer a ${targetId}`);
      }
    },
    [log, peerId]
  );

  const listenRemoteOffersAnswers = useCallback(
    (targetId, pc) => {
      const offersRef = ref(db, `${PEERS_PATH}/${peerId}/offers/${targetId}`);
      onValue(offersRef, async (snap) => {
        const remoteOffer = snap.val();
        if (
          remoteOffer &&
          (!pc.currentRemoteDescription ||
            pc.currentRemoteDescription.type !== "offer")
        ) {
          await pc.setRemoteDescription(remoteOffer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await set(
            ref(db, `${PEERS_PATH}/${targetId}/answers/${peerId}`),
            answer
          );
        }
      });
      const answersRef = ref(db, `${PEERS_PATH}/${peerId}/answers/${targetId}`);
      onValue(answersRef, async (snap) => {
        const remoteAnswer = snap.val();
        if (remoteAnswer && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(remoteAnswer);
        }
      });
    },
    [peerId]
  );

  const listenRemoteCandidates = useCallback(
    (targetId, pc) => {
      const candRef = ref(db, `${PEERS_PATH}/${peerId}/candidates/${targetId}`);
      onValue(candRef, async (snap) => {
        const val = snap.val() || {};
        for (const key of Object.keys(val)) {
          const c = val[key];
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch {}
        }
      });
    },
    [peerId]
  );

  // Create RTCPeerConnection and begin signaling
  const createConnectionToPeer = useCallback(
    (targetId) => {
      const pc = new RTCPeerConnection();
      const setupChannel = (dc) => {
        peerConnectionsRef.current[targetId].dc = dc;
        setPeers((p) => ({
          ...p,
          [targetId]: { ...(p[targetId] || {}), state: dc.readyState },
        }));
        dc.onopen = () => {
          setPeers((p) => ({
            ...p,
            [targetId]: { ...(p[targetId] || {}), state: "open" },
          }));
          log(`Canal abierto con ${targetId}`);
          if (profile) dc.send(JSON.stringify({ __type: "profile", profile }));
          if (
            knownProfiles.length &&
            (profilesSentRef.current[targetId] || 0) < knownProfiles.length
          ) {
            dc.send(
              JSON.stringify({
                __type: "profilesSync",
                profiles: knownProfiles,
              })
            );
            profilesSentRef.current[targetId] = knownProfiles.length;
            log(
              `ProfilesSync enviado onopen a ${targetId} (len=${knownProfiles.length})`
            );
          }
          if (!knownProfiles.length) {
            dc.send(JSON.stringify({ __type: "requestProfiles" }));
            log(`[sync:request] requestProfiles inicial a ${targetId}`);
          }
          if (pendingValidationRef.current) {
            const { code, password } = pendingValidationRef.current;
            dc.send(
              JSON.stringify({ __type: "loginValidateRequest", code, password })
            );
          }
        };
        dc.onmessage = (e) => handleDataMessage(targetId, e.data);
        dc.onclose = () =>
          setPeers((p) => ({
            ...p,
            [targetId]: { ...(p[targetId] || {}), state: "closed" },
          }));
      };

      peerConnectionsRef.current[targetId] = {
        pc,
        dc: null,
        makingOffer: false,
      };
      setPeers((p) => ({
        ...p,
        [targetId]: { ...(p[targetId] || {}), state: "connecting" },
      }));

      const iAmOfferer = peerId < targetId; // deterministic to avoid glare
      if (iAmOfferer) {
        const dc = pc.createDataChannel("mesh");
        setupChannel(dc);
      } else {
        pc.ondatachannel = (ev) => {
          if (!peerConnectionsRef.current[targetId]) return;
          setupChannel(ev.channel);
        };
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          const cRef = ref(
            db,
            `${PEERS_PATH}/${targetId}/candidates/${peerId}`
          );
          push(cRef, ev.candidate.toJSON());
        }
      };
      pc.onconnectionstatechange = () => {
        setPeers((p) => ({
          ...p,
          [targetId]: { ...(p[targetId] || {}), connState: pc.connectionState },
        }));
      };

      if (iAmOfferer) negotiate(targetId);
      listenRemoteOffersAnswers(targetId, pc);
      listenRemoteCandidates(targetId, pc);
    },
    [
      log,
      profile,
      peerId,
      knownProfiles,
      handleDataMessage,
      negotiate,
      listenRemoteOffersAnswers,
      listenRemoteCandidates,
    ]
  );

  // Mover arriba para evitar TDZ cuando se usa en setupChannel antes de su inicialización en bundle

  const broadcast = useCallback(
    (text) => {
      Object.entries(peerConnectionsRef.current).forEach(([id, { dc }]) => {
        if (dc?.readyState === "open") dc.send(text);
      });
      log(`Yo: ${text}`);
    },
    [log]
  );

  // Envío diferido: cuando se cargan perfiles y hay canales abiertos que aún no recibieron
  useEffect(() => {
    if (!knownProfiles.length) return;
    Object.entries(peerConnectionsRef.current).forEach(([id, { dc }]) => {
      const lastLen = profilesSentRef.current[id] || 0;
      if (dc?.readyState === "open" && lastLen < knownProfiles.length) {
        dc.send(
          JSON.stringify({ __type: "profilesSync", profiles: knownProfiles })
        );
        profilesSentRef.current[id] = knownProfiles.length;
        log(
          `ProfilesSync enviado diferido a ${id} (len=${knownProfiles.length})`
        );
      }
    });
  }, [knownProfiles, log]);

  // Ping periódico cada 5s a cada canal abierto
  useEffect(() => {
    if (pingIntervalRef.current) return;
    pingIntervalRef.current = setInterval(() => {
      Object.entries(peerConnectionsRef.current).forEach(([id, { dc }]) => {
        if (dc?.readyState === "open") {
          const seq = ++pingSeqRef.current;
          const t = Date.now();
          pendingPingsRef.current[seq] = t;
          try {
            dc.send(JSON.stringify({ __type: "ping", seq, t }));
            log(`[ping->] a ${id} seq=${seq}`);
          } catch {}
        }
      });
    }, 5000);
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
  }, [log]);

  // Retry loop: si no tenemos perfiles aún, cada 2.5s solicitar a peers abiertos (máx 8 intentos)
  useEffect(() => {
    if (knownProfiles.length) {
      if (profileRequestTimerRef.current) {
        clearInterval(profileRequestTimerRef.current);
        profileRequestTimerRef.current = null;
      }
      return;
    }
    // verificar si hay algún canal abierto
    const hasOpen = Object.values(peerConnectionsRef.current).some(
      ({ dc }) => dc?.readyState === "open"
    );
    if (!hasOpen) return; // esperar a que se abra alguno
    if (profileRequestTimerRef.current) return; // ya corriendo
    let attempts = 0;
    profileRequestTimerRef.current = setInterval(() => {
      if (knownProfiles.length) {
        clearInterval(profileRequestTimerRef.current);
        profileRequestTimerRef.current = null;
        return;
      }
      attempts++;
      Object.entries(peerConnectionsRef.current).forEach(([id, { dc }]) => {
        if (dc?.readyState === "open") {
          dc.send(JSON.stringify({ __type: "requestProfiles" }));
        }
      });
      log(`[sync:retry] requestProfiles intento ${attempts}`);
      if (attempts >= 8) {
        clearInterval(profileRequestTimerRef.current);
        profileRequestTimerRef.current = null;
        log(`[sync:retry] máximo de intentos alcanzado`);
      }
    }, 2500);
    return () => {
      if (profileRequestTimerRef.current) {
        clearInterval(profileRequestTimerRef.current);
        profileRequestTimerRef.current = null;
      }
    };
  }, [knownProfiles, log]);

  // INITIALIZATION
  useEffect(() => {
    if (!autoStart) return;
    registerPresence();
    startPeerListener();
    (async () => {
      await seedRootAdmin();
      await refreshProfiles();
    })();
    return () => {
      if (unsubPeersRef.current) unsubPeersRef.current();
      Object.values(peerConnectionsRef.current).forEach(({ pc }) => pc.close());
      if (profileRequestTimerRef.current) {
        clearInterval(profileRequestTimerRef.current);
        profileRequestTimerRef.current = null;
      }
    };
  }, [
    autoStart,
    registerPresence,
    startPeerListener,
    refreshProfiles,
    seedRootAdmin,
  ]);

  // Update presence metadata & broadcast profile when profile changes
  useEffect(() => {
    if (!profile) return;
    const myRef = ref(db, `${PEERS_PATH}/${peerId}`);
    update(myRef, {
      profileCode: profile.code || null,
      profileName: profile.name || null,
    }).catch(() => {});
    Object.values(peerConnectionsRef.current).forEach(({ dc }) => {
      if (dc?.readyState === "open") {
        dc.send(JSON.stringify({ __type: "profile", profile }));
      }
    });
  }, [profile, peerId]);

  return {
    peerId,
    status,
    messages,
    peers: Object.entries(peers).map(([id, info]) => ({ id, ...info })),
    knownProfiles,
    profile,
    addProfile,
    login,
    broadcast,
    isAdmin: isAdminRef.current,
    loginValidated,
  };
}

export default usePeerMesh;
