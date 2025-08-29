import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";

// Documento compartido (CRDT)
const ydoc = new Y.Doc();

// Canal P2P compartido (puedes cambiar el nombre)
const provider = new WebrtcProvider("WatchTask", ydoc);

// Colección de tareas compartida
const tareas = ydoc.getMap("tareas");

export function addTask(id, data) {
  tareas.set(id, data);
}

export function getTasks() {
  return tareas.toJSON();
}

export { tareas };
