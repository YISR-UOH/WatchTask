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
  const unsubPeersRef = useRef(null);
  const isAdminRef = useRef(false);

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
      // solicitar validación remota
      setStatus("validando login remoto");
      pendingValidationRef.current = { code, password };
      setProfile(prof); // provisional
      isAdminRef.current = prof.role === "admin";
      Object.values(peerConnectionsRef.current).forEach(({ dc }) => {
        if (dc?.readyState === "open") {
          dc.send(
            JSON.stringify({ __type: "loginValidateRequest", code, password })
          );
        }
      });
      // Timeout fallback 3s
      setTimeout(() => {
        if (!loginValidated) {
          setLoginValidated(true); // aceptar si nadie respondió
          setStatus("login validado (timeout)");
          log(`Login validado por timeout`);
        }
      }, 3000);
    },
    [log, loginValidated]
  );

  // Register this peer presence
  const registerPresence = useCallback(async () => {
    const myRef = ref(db, `${PEERS_PATH}/${peerId}`);
    await set(myRef, { ts: Date.now() });
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
    });
  }, [peerId]);

  // Create RTCPeerConnection and begin signaling
  const createConnectionToPeer = useCallback(
    (targetId) => {
      const pc = new RTCPeerConnection();
      const dataChannel = pc.createDataChannel("mesh");
      peerConnectionsRef.current[targetId] = {
        pc,
        dc: dataChannel,
        makingOffer: false,
      };
      setPeers((p) => ({
        ...p,
        [targetId]: { ...(p[targetId] || {}), state: "connecting" },
      }));

      dataChannel.onopen = async () => {
        setPeers((p) => ({
          ...p,
          [targetId]: { ...(p[targetId] || {}), state: "open" },
        }));
        log(`Canal abierto con ${targetId}`);
        if (profile) {
          dataChannel.send(JSON.stringify({ __type: "profile", profile }));
        }
        // Admin envía lista completa de perfiles para sincronizar
        if (isAdminRef.current && knownProfiles.length) {
          dataChannel.send(
            JSON.stringify({ __type: "profilesSync", profiles: knownProfiles })
          );
        } else if (!isAdminRef.current && !knownProfiles.length) {
          // solicitar perfiles si aún no tenemos
          dataChannel.send(JSON.stringify({ __type: "requestProfiles" }));
        }
        // reenviar solicitud de validación si estaba pendiente
        if (pendingValidationRef.current) {
          const { code, password } = pendingValidationRef.current;
          dataChannel.send(
            JSON.stringify({ __type: "loginValidateRequest", code, password })
          );
        }
      };
      dataChannel.onmessage = (e) => handleDataMessage(targetId, e.data);
      dataChannel.onclose = () =>
        setPeers((p) => ({
          ...p,
          [targetId]: { ...(p[targetId] || {}), state: "closed" },
        }));

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

      negotiate(targetId);
      listenRemoteOffersAnswers(targetId, pc);
      listenRemoteCandidates(targetId, pc);
    },
    [log, profile, peerId]
  );

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
          } catch {} // ignore
        }
      });
    },
    [peerId]
  );

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
          if (isAdminRef.current && knownProfiles.length) {
            const entry = peerConnectionsRef.current[fromId];
            if (entry?.dc?.readyState === "open") {
              entry.dc.send(
                JSON.stringify({
                  __type: "profilesSync",
                  profiles: knownProfiles,
                })
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
      } catch {}
      log(`${fromId}: ${raw}`);
    },
    [log, storeProfile, knownProfiles]
  );

  const broadcast = useCallback(
    (text) => {
      Object.entries(peerConnectionsRef.current).forEach(([id, { dc }]) => {
        if (dc?.readyState === "open") dc.send(text);
      });
      log(`Yo: ${text}`);
    },
    [log]
  );

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
    };
  }, [
    autoStart,
    registerPresence,
    startPeerListener,
    refreshProfiles,
    seedRootAdmin,
  ]);

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
