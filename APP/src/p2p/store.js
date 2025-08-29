// Serverless P2P store using WebRTC DataChannels (manual QR-based signaling)

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// Global in-memory state
const state = {
  tasks: {}, // id -> task
};

// Subscribers to task updates
const subs = new Set();

// Host keeps multiple peer connections; guest keeps one
let role = /** @type {"host"|"guest"|null} */ (null);
/** @type {Array<{ pc: RTCPeerConnection, dc: RTCDataChannel }>} */
let hostPeers = [];
/** @type {{ pc: RTCPeerConnection, dc: RTCDataChannel } | null} */
let guestPeer = null;

function notify() {
  for (const cb of subs) {
    try {
      cb(getTasks());
    } catch {}
  }
}

export function subscribe(callback) {
  subs.add(callback);
  callback(getTasks());
  return () => subs.delete(callback);
}

export function getTasks() {
  // Return a shallow copy to avoid external mutation
  return { ...state.tasks };
}

// Messages protocol over DataChannel
// { type: 'hello' }
// { type: 'state', payload: { tasks } }
// { type: 'add', payload: { text } }

function applyFullState(next) {
  state.tasks = { ...next };
  notify();
}

function applyAddFromHost(text) {
  const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
  state.tasks[id] = { id, text, done: false, createdAt: Date.now() };
  notify();
  hostBroadcast({ type: "state", payload: { tasks: state.tasks } });
}

function hostBroadcast(msg) {
  if (role !== "host") return;
  const str = JSON.stringify(msg);
  for (const { dc } of hostPeers) {
    if (dc.readyState === "open") {
      try {
        dc.send(str);
      } catch {}
    }
  }
}

function onChannelMessage_asHost(ev) {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === "hello") {
      // send current state
      this.send(
        JSON.stringify({ type: "state", payload: { tasks: state.tasks } })
      );
    } else if (msg.type === "add" && msg.payload?.text) {
      applyAddFromHost(String(msg.payload.text));
    }
  } catch {}
}

function onChannelMessage_asGuest(ev) {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state" && msg.payload?.tasks) {
      applyFullState(msg.payload.tasks);
    }
  } catch {}
}

function setupHostPeer() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const dc = pc.createDataChannel("tasks", { ordered: true });
  dc.onopen = () => {
    // Send hello to receive initial state
    try {
      dc.send(JSON.stringify({ type: "hello" }));
    } catch {}
  };
  dc.onmessage = onChannelMessage_asHost.bind(dc);
  hostPeers.push({ pc, dc });
  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed" ||
      pc.connectionState === "disconnected"
    ) {
      // remove from peers
      hostPeers = hostPeers.filter((p) => p.pc !== pc);
    }
  };
  return { pc, dc };
}

function setupGuestPeer() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.ondatachannel = (ev) => {
    const dc = ev.channel;
    dc.onopen = () => {
      try {
        dc.send(JSON.stringify({ type: "hello" }));
      } catch {}
    };
    dc.onmessage = onChannelMessage_asGuest;
    guestPeer = { pc, dc };
  };
  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed" ||
      pc.connectionState === "disconnected"
    ) {
      guestPeer = null;
    }
  };
  return pc;
}

async function waitIceComplete(pc) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    // Fallback timeout 5s
    setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 5000);
  });
}

// Host flow: create offer and return JSON string
export async function createOffer() {
  role = "host";
  const { pc } = setupHostPeer();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);
  return JSON.stringify(pc.localDescription);
}

// Host completes by accepting guest's answer JSON string
export async function acceptAnswer(answerStr) {
  if (role !== "host") throw new Error("No estás en modo host");
  const last = hostPeers[hostPeers.length - 1];
  if (!last) throw new Error("No hay oferta activa");
  const desc = JSON.parse(answerStr);
  await last.pc.setRemoteDescription(new RTCSessionDescription(desc));
}

// Guest flow: take offer JSON string, return answer JSON string
export async function createAnswerForOffer(offerStr) {
  role = "guest";
  const pc = setupGuestPeer();
  const remote = JSON.parse(offerStr);
  await pc.setRemoteDescription(new RTCSessionDescription(remote));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceComplete(pc);
  return JSON.stringify(pc.localDescription);
}

// Public API: add task
export function addTask(text) {
  const payloadText = String(text || "").trim();
  if (!payloadText) return;

  if (role === "host") {
    applyAddFromHost(payloadText);
  } else if (role === "guest" && guestPeer?.dc?.readyState === "open") {
    try {
      guestPeer.dc.send(
        JSON.stringify({ type: "add", payload: { text: payloadText } })
      );
    } catch {
      // fallback to local add when not connected
      const id = Date.now().toString();
      state.tasks[id] = {
        id,
        text: payloadText,
        done: false,
        createdAt: Date.now(),
      };
      notify();
    }
  } else {
    // offline/local mode
    const id = Date.now().toString();
    state.tasks[id] = {
      id,
      text: payloadText,
      done: false,
      createdAt: Date.now(),
    };
    notify();
  }
}

// Utility to encode/decode data for URL hash to reduce unsafe chars
export function encodeForHash(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
export function decodeFromHash(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

// Connection helpers
export function isConnected() {
  if (role === "host") return hostPeers.some((p) => p.dc.readyState === "open");
  if (role === "guest")
    return !!(guestPeer && guestPeer.dc.readyState === "open");
  return false;
}

export function getRole() {
  return role;
}
