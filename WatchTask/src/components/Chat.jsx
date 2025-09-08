import React, { useEffect, useRef, useState } from "react";

const SIGNAL_SERVER = "wss://tu-proyecto.vercel.app/api/ws";

function Chat() {
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const channelRef = useRef(null);

  useEffect(() => {
    wsRef.current = new WebSocket(SIGNAL_SERVER);

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "offer") {
        await pcRef.current.setRemoteDescription(data.offer);
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        wsRef.current.send(JSON.stringify({ type: "answer", answer }));
      }

      if (data.type === "answer") {
        await pcRef.current.setRemoteDescription(data.answer);
      }

      if (data.type === "candidate" && data.candidate) {
        try {
          await pcRef.current.addIceCandidate(data.candidate);
        } catch (e) {
          console.error("Error al añadir candidato:", e);
        }
      }
    };

    // 2. Crear conexión WebRTC
    pcRef.current = new RTCPeerConnection();

    // DataChannel
    channelRef.current = pcRef.current.createDataChannel("chat");
    channelRef.current.onmessage = (e) => {
      setMessages((prev) => [...prev, "Peer: " + e.data]);
    };

    pcRef.current.ondatachannel = (event) => {
      event.channel.onmessage = (e) => {
        setMessages((prev) => [...prev, "Peer: " + e.data]);
      };
    };

    // ICE Candidates
    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current.send(
          JSON.stringify({ type: "candidate", candidate: event.candidate })
        );
      }
    };
  }, []);

  const createOffer = async () => {
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: "offer", offer }));
  };

  const sendMessage = () => {
    const msg = "Hola desde este peer 👋";
    channelRef.current.send(msg);
    setMessages((prev) => [...prev, "Yo: " + msg]);
  };

  return (
    <div>
      <h1>WebRTC P2P Chat (con señalización mínima)</h1>
      <button onClick={createOffer}>Iniciar conexión</button>
      <button onClick={sendMessage}>Enviar mensaje</button>
      <ul>
        {messages.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export default Chat;
