import React, { useState, useRef } from "react";
import { db, ref, set, onValue, push } from "./firebase";

function Chat() {
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState([]);
  const pcRef = useRef(null);
  const channelRef = useRef(null);

  const createRoom = async () => {
    pcRef.current = new RTCPeerConnection();

    // Canal de datos
    channelRef.current = pcRef.current.createDataChannel("chat");
    channelRef.current.onmessage = (e) =>
      setMessages((m) => [...m, "Peer: " + e.data]);

    // ICE candidates -> Firebase
    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        const candidatesRef = ref(db, `rooms/${roomId}/callerCandidates`);
        push(candidatesRef, event.candidate.toJSON());
      }
    };

    // Crear la oferta
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    // Guardar oferta en Firebase
    await set(ref(db, `rooms/${roomId}`), { offer });

    // Escuchar answer
    onValue(ref(db, `rooms/${roomId}/answer`), async (snapshot) => {
      const answer = snapshot.val();
      if (answer && !pcRef.current.currentRemoteDescription) {
        await pcRef.current.setRemoteDescription(answer);
      }
    });

    // Escuchar candidatos del otro peer
    onValue(ref(db, `rooms/${roomId}/calleeCandidates`), (snapshot) => {
      snapshot.forEach(async (child) => {
        const candidate = new RTCIceCandidate(child.val());
        await pcRef.current.addIceCandidate(candidate);
      });
    });
  };

  const joinRoom = async () => {
    pcRef.current = new RTCPeerConnection();

    // Responder mensajes
    pcRef.current.ondatachannel = (event) => {
      event.channel.onmessage = (e) =>
        setMessages((m) => [...m, "Peer: " + e.data]);
      channelRef.current = event.channel;
    };

    // ICE candidates -> Firebase
    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        const candidatesRef = ref(db, `rooms/${roomId}/calleeCandidates`);
        push(candidatesRef, event.candidate.toJSON());
      }
    };

    // Leer la oferta
    onValue(ref(db, `rooms/${roomId}/offer`), async (snapshot) => {
      const offer = snapshot.val();
      if (offer) {
        await pcRef.current.setRemoteDescription(offer);

        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);

        await set(ref(db, `rooms/${roomId}/answer`), answer);
      }
    });

    // Escuchar candidatos del caller
    onValue(ref(db, `rooms/${roomId}/callerCandidates`), (snapshot) => {
      snapshot.forEach(async (child) => {
        const candidate = new RTCIceCandidate(child.val());
        await pcRef.current.addIceCandidate(candidate);
      });
    });
  };

  const sendMessage = () => {
    const msg = "Hola desde este peer 👋";
    channelRef.current?.send(msg);
    setMessages((m) => [...m, "Yo: " + msg]);
  };

  return (
    <div>
      <h1>WebRTC P2P Chat con Firebase</h1>
      <input
        placeholder="Room ID"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
      />
      <button onClick={createRoom}>Crear sala</button>
      <button onClick={joinRoom}>Unirse a sala</button>
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
