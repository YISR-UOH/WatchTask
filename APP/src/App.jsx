import { useEffect, useMemo, useRef, useState } from "react";
import {
  addTask,
  subscribe,
  getTasks,
  createOffer,
  acceptAnswer,
  createAnswerForOffer,
  encodeForHash,
  decodeFromHash,
  isConnected,
  getRole,
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

  // subscribe to store
  useEffect(() => {
    const unsub = subscribe((next) => setTasks(next));
    return () => unsub();
  }, []);

  // If URL has #offer=..., auto-fill offerText for guest
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const o = params.get("offer");
    if (o) {
      try {
        setOfferText(decodeURIComponent(o));
      } catch {}
    }
  }, []);

  async function onAdd() {
    if (!input.trim()) return;
    addTask(input.trim());
    setInput("");
  }

  async function onCreateOffer() {
    setError("");
    try {
      const offerStr = await createOffer();
      const encoded = encodeURIComponent(offerStr);
      const url = `${location.origin}${location.pathname}#offer=${encoded}`;
      // Lazy import qrcode to data URL for modal; or fallback to text
      try {
        const QR = await import("qrcode");
        const dataUrl = await QR.toDataURL(url);
        setQrUrl(dataUrl);
      } catch {
        setQrUrl("");
      }
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
      await acceptAnswer(answerText);
      setAnswerText("");
    } catch (e) {
      setError("Respuesta inválida o conexión fallida");
      console.error(e);
    }
  }

  async function onCreateAnswer() {
    setError("");
    try {
      const ansStr = await createAnswerForOffer(offerText);
      // create QR for the answer string to show to host
      try {
        const QR = await import("qrcode");
        const dataUrl = await QR.toDataURL(ansStr);
        setQrUrl(dataUrl);
      } catch {
        setQrUrl("");
      }
      setShowQR(true);
      setMyRole("guest");
    } catch (e) {
      setError("Oferta inválida o no compatible");
      console.error(e);
    }
  }

  const connected = useMemo(() => isConnected(), [tasks]);

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
            <li key={t.id}>
              {t.text}
              {t.done ? " ✅" : ""}
            </li>
          ))}
      </ul>

      <hr style={{ margin: "16px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <div>
          <h3 style={{ margin: "4px 0" }}>Modo Host</h3>
          <button onClick={onCreateOffer}>Generar QR con oferta SDP</button>
          <div style={{ marginTop: 8 }}>
            <label>Respuesta del invitado (pegar texto del QR):</label>
            <textarea
              rows={4}
              style={{ width: "100%" }}
              placeholder="Pega aquí la respuesta SDP (si no puedes usar QR)"
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
            />
            <button onClick={onAcceptAnswer}>Aceptar respuesta</button>
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
          <button onClick={onCreateAnswer}>Generar QR con respuesta SDP</button>
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
    </div>
  );
}

export default App;
