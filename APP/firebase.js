import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onValue,
  push,
  remove,
  onDisconnect,
  update,
  get,
  child,
} from "firebase/database";

const firebaseConfig = {
  apiKey: "",
  authDomain: "watchtask-35eb1.firebaseapp.com",
  databaseURL: "https://watchtask-35eb1-default-rtdb.firebaseio.com",
  projectId: "watchtask-35eb1",
  storageBucket: "watchtask-35eb1.appspot.com",
  messagingSenderId: "421711878688",
  appId: "1:421711878688:web:xxxxxxxxxxxxxxxx",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
// Re-export commonly used realtime DB helpers (explicit for tree-shaking clarity)
export { ref, set, onValue, push, remove, onDisconnect, update, get, child };
