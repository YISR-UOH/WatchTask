import { useEffect, useRef, useState } from "react";
import QR from "qrcode";
import qrScannerWorkerUrl from "qr-scanner/qr-scanner-worker.min.js?url";
import {
  addTask,
  subscribe,
  subscribeConnection,
  subscribeDiagnostics,
  getTasks,
  createOffer,
  acceptAnswer,
  createAnswerForOffer,
  isConnected,
  getRole,
  toggleTask,
} from "./p2p/store";

function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: 16,
          maxWidth: 420,
          width: "90%",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <strong>QR</strong>
          <button onClick={onClose}>Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function App() {
  const [tasks, setTasks] = useState(getTasks());
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [offerText, setOfferText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [myRole, setMyRole] = useState(getRole());
  const [diag, setDiag] = useState(null);
  const [scanMode, setScanMode] = useState(null); // 'offer' | 'answer' | null
  const [connected, setConnected] = useState(isConnected());
  const videoRef = useRef(null);
  const scannerRef = useRef(null);

  function extractOffer(str) {
    try {
      const s = String(str || "");
      if (s.includes("#offer=")) {
        const hash = s.slice(s.indexOf("#") + 1);
        const params = new URLSearchParams(hash);
        const o = params.get("offer");
        if (o) return decodeURIComponent(o);
      }
      return s;
    } catch {
      return str;
    }
  }

  function extractAnswer(str) {
    try {
      const s = String(str || "");
      if (s.includes("#answer=")) {
        const hash = s.slice(s.indexOf("#") + 1);
        const params = new URLSearchParams(hash);
        const a = params.get("answer");
        if (a) return decodeURIComponent(a);
      }
      return s;
    } catch {
      return str;
    }
  }

  function copy(text) {
    if (!text) return;
    try {
      navigator.clipboard?.writeText(text);
    } catch (e) {
      console.warn("Clipboard copy failed", e);
    }
  }

  // subscriptions
  useEffect(() => {
    const unsub = subscribe((next) => setTasks(next));
    return () => unsub();
  }, []);

  useEffect(() => {
    const off = subscribeConnection((v) => setConnected(v));
    return () => off();
  }, []);

  useEffect(() => {
    const off = subscribeDiagnostics((d) => setDiag(d));
    return () => off();
  }, []);

  // If URL has #offer= or #answer=
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const o = params.get("offer");
    if (o) {
      try {
        setOfferText(decodeURIComponent(o));
      } catch {}
    }
    const a = params.get("answer");
    if (a) {
      try {
        setAnswerText(decodeURIComponent(a));
      } catch {}
    }
  }, []);

  async function onAdd() {
    setError("");
    const trimmed = input.trim();
    if (!trimmed) return;
    try {
      await addTask(trimmed);
      setInput("");
    } catch (e) {
      setError("No se pudo agregar la tarea");
      console.error(e);
    }
  }

  async function onCreateOffer(mode = "sdp") {
    setError("");
    try {
      const offerStr = await createOffer();
      setOfferText(offerStr);
      const qrPayload =
        mode === "link"
          ? `${location.origin}${location.pathname}#offer=${encodeURIComponent(
              offerStr
            )}`
          : offerStr;
      const dataUrl = await QR.toDataURL(qrPayload);
      setQrUrl(dataUrl);
      setShowQR(true);
      setMyRole("host");
    } catch (e) {
      setError("No se pudo generar la oferta/QR");
      console.error(e);
    }
  }

  async function onAcceptAnswer() {
    setError("");
    try {
      await acceptAnswer(extractAnswer(answerText));
    } catch (e) {
      setError("Respuesta inválida");
      console.error(e);
    }
  }

  async function onCreateAnswer(mode = "sdp") {
    setError("");
    try {
      const offerPayload = extractOffer(offerText);
      const ansStr = await createAnswerForOffer(offerPayload);
      setAnswerText(ansStr);
      const payload =
        mode === "link"
          ? `${location.origin}${location.pathname}#answer=${encodeURIComponent(
              ansStr
            )}`
          : ansStr;
      const dataUrl = await QR.toDataURL(payload);
      setQrUrl(dataUrl);
      setShowQR(true);
      setMyRole("guest");
    } catch (e) {
      setError("Oferta inválida o no compatible");
      console.error(e);
    }
  }

  // QR Scanner lifecycle
  useEffect(() => {
    let active = true;
    (async () => {
      if (!scanMode) return;
      try {
        const { default: QrScanner } = await import("qr-scanner");
        try {
          QrScanner.WORKER_PATH = qrScannerWorkerUrl;
        } catch {}
        if (!videoRef.current) return;
        const scanner = new QrScanner(
          videoRef.current,
          (result) => {
            if (!active) return;
            const scanned = result?.data || result;
            if (scanMode === "offer") setOfferText(extractOffer(scanned));
            if (scanMode === "answer") setAnswerText(extractAnswer(scanned));
            setScanMode(null);
            scanner.stop();
          },
          { returnDetailedScanResult: true }
        );
        scannerRef.current = scanner;
        await scanner.start();
      } catch (e) {
        console.error("QR scan error", e);
        setError("No se pudo iniciar la cámara para leer QR");
        setScanMode(null);
      }
    })();
    return () => {
      active = false;
      if (scannerRef.current) {
        try {
          scannerRef.current.stop();
        } catch {}
        scannerRef.current = null;
      }
    };
  }, [scanMode]);

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <h1 style={{ marginTop: 0 }}>WatchTask</h1>
      <p style={{ marginTop: 0 }}>
        Estado: <strong>{connected ? "Conectado" : "Desconectado"}</strong>
        {myRole ? ` (${myRole})` : ""}
      </p>

      {error && (
        <div
          style={{
            background: "#fee",
            color: "#900",
            padding: 8,
            border: "1px solid #f99",
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Nueva tarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={onAdd}>Agregar</button>
      </div>

      <ul style={{ paddingLeft: 18 }}>
        {Object.values(tasks)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((t) => (
            <li
              key={t.id}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                checked={!!t.done}
                onChange={() => toggleTask(t.id)}
              />
              <span
                style={{ textDecoration: t.done ? "line-through" : "none" }}
              >
                {t.text}
              </span>
            </li>
          ))}
      </ul>

      <hr style={{ margin: "16px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <div>
          <h3 style={{ margin: "4px 0" }}>Modo Host</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => onCreateOffer("sdp")}>
              QR con oferta (SDP)
            </button>
            <button onClick={() => onCreateOffer("link")}>
              QR con oferta (link)
            </button>
          </div>
          <div
            style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}
          >
            <button onClick={() => copy(offerText)} disabled={!offerText}>
              Copiar oferta (SDP)
            </button>
            <button
              onClick={() =>
                copy(
                  `${location.origin}${
                    location.pathname
                  }#offer=${encodeURIComponent(offerText)}`
                )
              }
              disabled={!offerText}
            >
              Copiar link con oferta
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Respuesta del invitado (pegar texto del QR):</label>
            <textarea
              rows={4}
              style={{ width: "100%" }}
              placeholder="Pega aquí la respuesta SDP (si no puedes usar QR)"
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => setScanMode("answer")}>
                Escanear respuesta
              </button>
              <button onClick={onAcceptAnswer}>Aceptar respuesta</button>
            </div>
          </div>
        </div>

        <div>
          <h3 style={{ margin: "4px 0" }}>Modo Invitado</h3>
          <label>Oferta del host:</label>
          <textarea
            rows={4}
            style={{ width: "100%" }}
            placeholder="Pega aquí la oferta SDP (o usa el link con #offer=...)"
            value={offerText}
            onChange={(e) => setOfferText(e.target.value)}
          />
          <div
            style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}
          >
            <button onClick={() => setScanMode("offer")}>
              Escanear oferta
            </button>
            <button onClick={() => onCreateAnswer("sdp")}>
              QR con respuesta (SDP)
            </button>
            <button onClick={() => onCreateAnswer("link")}>
              QR con respuesta (link)
            </button>
            <button onClick={() => copy(answerText)} disabled={!answerText}>
              Copiar respuesta (SDP)
            </button>
            <button
              onClick={() =>
                copy(
                  `${location.origin}${
                    location.pathname
                  }#answer=${encodeURIComponent(answerText)}`
                )
              }
              disabled={!answerText}
            >
              Copiar link con respuesta
            </button>
          </div>
        </div>
      </div>

      <Modal open={showQR} onClose={() => setShowQR(false)}>
        {qrUrl ? (
          <img src={qrUrl} alt="QR" style={{ width: "100%", height: "auto" }} />
        ) : (
          <p>
            No se pudo generar el QR. Copia y comparte el texto del enlace en su
            lugar.
          </p>
        )}
      </Modal>

      <Modal open={!!scanMode} onClose={() => setScanMode(null)}>
        <div style={{ display: "grid", gap: 8 }}>
          <p>
            Escaneando{" "}
            {scanMode === "offer"
              ? "oferta del host"
              : "respuesta del invitado"}
            ...
          </p>
          <video
            ref={videoRef}
            style={{ width: "100%", background: "#000" }}
            muted
            playsInline
          />
        </div>
      </Modal>

      {diag && (
        <details style={{ marginTop: 12 }}>
          <summary>Diagnóstico de conexión</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(diag, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export default App;
