import React, { useState, useRef, useEffect } from "react";
import { db, ref, set, onValue, push } from "../../firebase";
import { openDB } from "idb";
import "@/style/style.css";
// Ruta fija para señalización global
const SIGNAL_PATH = "globalRoom";

function Connection() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("idle");
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const firebaseUnsubsRef = useRef([]); // guardar funciones para limpiar

  // Helper para agregar listeners y poder limpiarlos
  const addFirebaseListener = (path, cb) => {
    const r = ref(db, path);
    const unsubscribe = onValue(r, cb);
    firebaseUnsubsRef.current.push(() => unsubscribe());
    return r;
  };

  const ensurePeer = () => {
    if (!pcRef.current) {
      pcRef.current = new RTCPeerConnection();
      pcRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          const role = pcRef.current.__role; // 'caller' o 'callee'
          const bucket =
            role === "caller" ? "callerCandidates" : "calleeCandidates";
          push(ref(db, `${SIGNAL_PATH}/${bucket}`), event.candidate.toJSON());
        }
      };
      pcRef.current.ondatachannel = (event) => {
        channelRef.current = event.channel;
        channelRef.current.onmessage = handleDataMessage;
        setStatus("canal listo");
      };
    }
  };

  // Buffer de reconstrucción para transferencias grandes
  const transferStateRef = useRef({});

  const handleDataMessage = (e) => {
    let data = e.data;
    try {
      const parsed = JSON.parse(data);
      if (parsed && parsed.__type === "chunk") {
        const { id, index, total, payload } = parsed;
        if (!transferStateRef.current[id]) {
          transferStateRef.current[id] = { parts: [], total };
        }
        transferStateRef.current[id].parts[index] = payload;
        const receivedCount =
          transferStateRef.current[id].parts.filter(Boolean).length;
        setStatus(`recibiendo dataset ${id}: ${receivedCount}/${total}`);
        if (receivedCount === total) {
          const full = transferStateRef.current[id].parts.join("");
          delete transferStateRef.current[id];
          try {
            const original = JSON.parse(full);
            setMessages((m) => [
              ...m,
              `Peer dataset (${id}) recibido (${
                original.length || Object.keys(original).length
              } items)`,
            ]);
            // Opcional: almacenar en IndexedDB
            storeReceivedData(original);
          } catch (err) {
            setMessages((m) => [...m, `Error parseando dataset ${id}`]);
          }
          setStatus("conectado");
        }
        return;
      } else if (parsed && parsed.__type === "info") {
        setMessages((m) => [...m, `Peer info: ${parsed.msg}`]);
        return;
      }
    } catch (_) {
      // no JSON -> mensaje normal
    }
    setMessages((m) => [...m, "Peer: " + data]);
  };

  // Garantiza que exista el object store "pdfData" incluso si la DB ya fue creada antes sin él
  let pdfDbPromise = null; // singleton
  const getPdfDB = async () => {
    if (pdfDbPromise) return pdfDbPromise;
    pdfDbPromise = (async () => {
      // primer open para conocer versión existente
      let db = await openDB("pdfDataDB");
      if (!db.objectStoreNames.contains("pdfData")) {
        const targetVersion = db.version + 1;
        const prevVersion = db.version;
        db.close();
        try {
          db = await openDB("pdfDataDB", targetVersion, {
            upgrade(upgradeDb) {
              if (!upgradeDb.objectStoreNames.contains("pdfData")) {
                upgradeDb.createObjectStore("pdfData", { keyPath: "id" });
              }
            },
          });
          console.info(
            `[IndexedDB] pdfData store creado (v${prevVersion} -> v${targetVersion})`
          );
        } catch (e) {
          console.warn("Reintento creación store tras fallo de upgrade", e);
          // segundo intento simple: abrir nuevamente y comprobar; si aún no existe se vuelve a intentar con +1
          let temp = await openDB("pdfDataDB");
          if (!temp.objectStoreNames.contains("pdfData")) {
            const newV = temp.version + 1;
            temp.close();
            db = await openDB("pdfDataDB", newV, {
              upgrade(upgradeDb2) {
                if (!upgradeDb2.objectStoreNames.contains("pdfData")) {
                  upgradeDb2.createObjectStore("pdfData", { keyPath: "id" });
                }
              },
            });
            console.info(
              `[IndexedDB] pdfData store creado en reintento (v${newV})`
            );
          } else {
            db = temp; // store apareció (otra pestaña lo creó)
          }
        }
      }
      return db;
    })();
    try {
      return await pdfDbPromise;
    } catch (err) {
      // reset para permitir otro intento futuro
      pdfDbPromise = null;
      throw err;
    }
  };

  const storeReceivedData = async (data) => {
    try {
      console.time("store");
      const dbLocal = await getPdfDB();
      console.log(
        "Version DB",
        dbLocal.name,
        dbLocal.version,
        dbLocal.objectStoreNames
      );
      const tx = dbLocal.transaction("pdfData", "readwrite"); // <- si peta aquí es el guardado
      console.timeEnd("store");
      if (Array.isArray(data) && data.length) {
        const tx = dbLocal.transaction("pdfData", "readwrite");
        for (const item of data) await tx.store.put(item);
        await tx.done;
      }
    } catch (e) {
      if (e && e.name === "NotFoundError") {
        console.warn(
          "Object store 'pdfData' aún inexistente tras upgrade; limpiando caché de promesa y reintentando"
        );
        pdfDbPromise = null;
        try {
          const retryDb = await getPdfDB();
          if (Array.isArray(data) && data.length) {
            const tx2 = retryDb.transaction("pdfData", "readwrite");
            for (const item of data) await tx2.store.put(item);
            await tx2.done;
            return;
          }
        } catch (e2) {
          console.warn("Reintento también falló", e2);
        }
      } else {
        console.warn("No se pudo almacenar dataset recibido", e);
      }
    }
  };

  // Conectar a la sala global negociando rol automáticamente
  const connect = async () => {
    setStatus("conectando...");
    ensurePeer();

    const offerRef = ref(db, `${SIGNAL_PATH}/offer`);
    let offerSnapshotValue;
    await new Promise((resolve) => {
      const off = onValue(offerRef, (snap) => {
        offerSnapshotValue = snap.val();
        off(); // leer solo una vez
        resolve();
      });
    });

    if (!offerSnapshotValue) {
      // Soy caller
      pcRef.current.__role = "caller";
      channelRef.current = pcRef.current.createDataChannel("data");
      channelRef.current.onmessage = handleDataMessage;
      setStatus("creando oferta");
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      await set(offerRef, offer);

      // Escucho answer
      addFirebaseListener(`${SIGNAL_PATH}/answer`, async (snap) => {
        const answer = snap.val();
        if (answer && !pcRef.current.currentRemoteDescription) {
          await pcRef.current.setRemoteDescription(answer);
          setStatus("conectado (caller)");
        }
      });
    } else {
      // Soy callee
      pcRef.current.__role = "callee";
      await pcRef.current.setRemoteDescription(offerSnapshotValue);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      await set(ref(db, `${SIGNAL_PATH}/answer`), answer);
      setStatus("conectado (callee)");
    }

    // Escuchar candidatos de la contraparte
    addFirebaseListener(`${SIGNAL_PATH}/callerCandidates`, (snap) => {
      if (pcRef.current.__role === "callee") {
        snap.forEach(async (child) => {
          const c = child.val();
          if (c && !c.__added) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
            } catch {}
          }
        });
      }
    });
    addFirebaseListener(`${SIGNAL_PATH}/calleeCandidates`, (snap) => {
      if (pcRef.current.__role === "caller") {
        snap.forEach(async (child) => {
          const c = child.val();
          if (c && !c.__added) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
            } catch {}
          }
        });
      }
    });
  };

  const sendChat = () => {
    const msg = "Hola 👋";
    channelRef.current?.send(msg);
    setMessages((m) => [...m, "Yo: " + msg]);
  };

  // Leer todos los registros de IndexedDB
  const readAllPdfData = async () => {
    const dbLocal = await getPdfDB();
    const tx = dbLocal.transaction("pdfData", "readonly");
    return await tx.store.getAll();
  };

  const chunkAndSend = async (obj) => {
    if (!channelRef.current) return;
    const json = JSON.stringify(obj);
    const CHUNK_SIZE = 14_000; // margen <16KB para datachannel default
    const total = Math.ceil(json.length / CHUNK_SIZE);
    const id = Date.now().toString(36);
    setStatus(`enviando dataset ${id} (${total} chunks)`);
    for (let i = 0; i < total; i++) {
      const part = json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const packet = JSON.stringify({
        __type: "chunk",
        id,
        index: i,
        total,
        payload: part,
      });
      channelRef.current.send(packet);
      await new Promise((r) => setTimeout(r, 5)); // leve pacing
    }
    channelRef.current.send(
      JSON.stringify({ __type: "info", msg: `dataset ${id} enviado` })
    );
    setStatus("conectado");
  };

  const sendFullDB = async () => {
    try {
      const data = await readAllPdfData();
      if (!data.length) {
        setMessages((m) => [...m, "DB vacía"]);
        return;
      }
      await chunkAndSend(data);
      setMessages((m) => [
        ...m,
        `Dataset completo enviado (${data.length} registros)`,
      ]);
    } catch (e) {
      setMessages((m) => [...m, "Error leyendo DB"]);
    }
  };

  const sendPartialDB = async (limit = 10) => {
    try {
      const data = await readAllPdfData();
      if (!data.length) {
        setMessages((m) => [...m, "DB vacía"]);
        return;
      }
      const slice = data.slice(0, limit);
      await chunkAndSend(slice);
      setMessages((m) => [
        ...m,
        `Fracción enviada (${slice.length}/${data.length})`,
      ]);
    } catch (e) {
      setMessages((m) => [...m, "Error leyendo DB"]);
    }
  };

  useEffect(() => {
    return () => {
      // cleanup
      firebaseUnsubsRef.current.forEach((fn) => fn());
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-4">
        <div>
          <h2 className="heading mb-1">Conexión global WebRTC</h2>
          <p className="text-xs font-mono px-2 py-1 rounded bg-gray-100 border border-gray-200 inline-block">
            {status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={connect}
            disabled={status.startsWith("conectado")}
            className="btn btn-primary"
          >
            Conectar
          </button>
          <button
            onClick={sendChat}
            disabled={!channelRef.current}
            className="btn btn-outline"
          >
            Chat hola
          </button>
          <button
            onClick={sendFullDB}
            disabled={!channelRef.current}
            className="btn btn-outline"
          >
            DB completa
          </button>
          <button
            onClick={() => sendPartialDB(5)}
            disabled={!channelRef.current}
            className="btn btn-outline"
          >
            5 registros
          </button>
        </div>
      </div>
      <ul className="messages flex-1">
        {messages.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export default Connection;
