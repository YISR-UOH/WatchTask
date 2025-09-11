import "@/style/style.css";
import { useContext, useMemo, useState } from "react";
import { AuthContext } from "@/context/AuthContext";
import { DBContext } from "@/context/DBContext";
import { P2PContext } from "@/context/P2PContext";
import { myPeerId } from "@/webrtc/connection";
import { hashHex } from "@/utils/hash";

export default function App() {
  const { user, role, login, logout } = useContext(AuthContext);
  const {
    dbReady,
    publicDB,
    syncPublicDB,
    getPublicUsers,
    verifyCredentials,
    exportPublicDB,
  } = useContext(DBContext);
  const { peerConnections, connectToPeer, disconnectPeer, sendMessage } =
    useContext(P2PContext);

  // UI state
  const [form, setForm] = useState({ username: "", password: "" });
  const [status, setStatus] = useState("");
  const peerEntries = useMemo(() => {
    if (peerConnections instanceof Map) {
      return Array.from(peerConnections.entries());
    }
    return Object.entries(peerConnections || {});
  }, [peerConnections]);
  const peersCount = peerEntries.length;

  async function handleLogin(e) {
    e.preventDefault();
    setStatus("Verificando…");
    const ok = await login(form.username.trim(), form.password);
    setStatus(ok ? "Autenticado" : "Credenciales inválidas");
  }

  async function handleExportAndSend(peerId) {
    const payload = await exportPublicDB();
    await sendMessage(peerId, { type: "syncPublicDB", payload });
    setStatus(`Enviado ${payload?.length ?? 0} usuarios a ${peerId}`);
  }

  function Stat({ label, value }) {
    return (
      <div className="card">
        <div className="muted">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    );
  }
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-blue-700">WatchTask</h1>
          </div>
          <div className="text-sm text-gray-600">
            {user ? (
              <div className="flex items-center gap-3">
                <span>
                  Sesión: <strong>{user}</strong> · Rol:{" "}
                  <strong>{role || "—"}</strong>
                </span>
                <button className="btn btn-outline" onClick={logout}>
                  Cerrar sesión
                </button>
              </div>
            ) : (
              <span className="muted">No autenticado</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto w-full px-4 py-6 flex-1 space-y-6">
        {!user && (
          <section className="card">
            <h2 className="heading">Ingreso</h2>
            <form
              className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
              onSubmit={handleLogin}
            >
              <label className="block">
                <span className="muted">Usuario</span>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                  value={form.username}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, username: e.target.value }))
                  }
                  autoComplete="username"
                  required
                />
              </label>
              <label className="block">
                <span className="muted">Contraseña</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                  value={form.password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password: e.target.value }))
                  }
                  autoComplete="current-password"
                  required
                />
              </label>
              <div>
                <button
                  className="btn btn-primary w-full"
                  type="submit"
                  disabled={!dbReady}
                >
                  {dbReady ? "Ingresar" : "Preparando DB…"}
                </button>
              </div>
            </form>
            {status && <p className="mt-3 text-sm text-gray-600">{status}</p>}
          </section>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat label="DB local" value={dbReady ? "Lista" : "Cargando…"} />
          <Stat label="Usuarios públicos" value={publicDB?.length ?? 0} />
          <Stat label="Peers conectados" value={peersCount} />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="heading">Base pública</h2>
            <div className="flex gap-2 mb-3">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  // crear usuario demo: demo / demo
                  const salt = Math.random().toString(36).slice(2, 10);
                  const hash = await hashHex("demo" + salt);
                  await syncPublicDB([
                    { username: "demo", role: "admin", salt, hash },
                  ]);
                  setStatus("Usuario demo creado: demo/demo");
                }}
                disabled={!dbReady}
              >
                Crear usuario demo
              </button>
              <button
                className="btn btn-outline"
                onClick={async () => {
                  const all = await getPublicUsers();
                  setStatus(`Hay ${all.length} usuarios en DB`);
                }}
                disabled={!dbReady}
              >
                Contar usuarios
              </button>
            </div>
            <ul className="messages">
              {(publicDB || []).slice(0, 10).map((u) => (
                <li key={u.username} className="flex justify-between">
                  <span>@{u.username}</span>
                  <span className="muted">{u.role}</span>
                </li>
              ))}
              {!publicDB?.length && <li className="muted">Sin registros</li>}
            </ul>
          </div>

          <div className="card">
            <h2 className="heading">P2P</h2>
            <p className="muted mb-2">Mi peerId: {myPeerId}</p>
            <div className="flex flex-wrap gap-2 mb-3">
              <input
                placeholder="peer-id remoto"
                className="rounded-md border border-gray-300 px-3 py-2"
                value={form.peerId || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, peerId: e.target.value }))
                }
              />
              <button
                className="btn btn-primary"
                onClick={() => form.peerId && connectToPeer(form.peerId)}
              >
                Conectar
              </button>
              <button
                className="btn btn-outline"
                onClick={() => form.peerId && disconnectPeer(form.peerId)}
              >
                Desconectar
              </button>
              <button
                className="btn btn-outline"
                onClick={() => form.peerId && handleExportAndSend(form.peerId)}
              >
                Enviar DB pública
              </button>
            </div>
            <ul className="messages">
              {peerEntries.map(([id, pc]) => (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3"
                >
                  <div>
                    <strong>{id}</strong>
                    <span className="ml-2 muted">{pc.connectionState}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-outline"
                      onClick={() => disconnectPeer(id)}
                    >
                      Cerrar
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        sendMessage(id, { type: "ping", at: Date.now() })
                      }
                    >
                      Ping
                    </button>
                  </div>
                </li>
              ))}
              {!peersCount && <li className="muted">Sin peers conectados</li>}
            </ul>
          </div>
        </section>

        {status && (
          <div className="card">
            <h3 className="heading">Estado</h3>
            <p className="text-sm text-gray-700">{status}</p>
          </div>
        )}
      </main>

      <footer className="mt-auto bg-white border-t border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 text-xs text-gray-500 flex items-center justify-between">
          <span>© {new Date().getFullYear()} WatchTask v0.0.2</span>
        </div>
      </footer>
    </div>
  );
}
