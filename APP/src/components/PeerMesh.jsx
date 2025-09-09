import React, { useState } from "react";
import usePeerMesh from "@/hooks/usePeerMesh";

export default function PeerMesh() {
  const {
    peerId,
    peers,
    messages,
    knownProfiles,
    profile,
    addProfile,
    login,
    broadcast,
    isAdmin,
    loginValidated,
  } = usePeerMesh();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("maintenance");
  const [speciality, setSpeciality] = useState("mechanic");
  const [loginCode, setLoginCode] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [password, setPassword] = useState("");

  const handleAdd = async () => {
    try {
      await addProfile({
        code: code.trim(),
        name,
        uuid: crypto.randomUUID(),
        role,
        speciality,
        password,
      });
      setCode("");
      setName("");
      setPassword("");
    } catch (e) {
      console.warn(e);
    }
  };
  const handleLogin = async () => {
    try {
      await login(loginCode.trim(), loginPassword);
    } catch (e) {
      console.warn(e);
    }
  };
  const handleSend = () => {
    if (chatMsg) {
      broadcast(chatMsg);
      setChatMsg("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs font-mono p-2 bg-gray-100 rounded border">
        PeerId: {peerId}
      </div>
      {!profile && (
        <div className="card bg-white border p-3 flex flex-col gap-2">
          <h3 className="heading">Login</h3>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="code"
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value)}
              />
              <input
                className="input"
                placeholder="password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
              <button className="btn btn-primary" onClick={handleLogin}>
                Entrar
              </button>
            </div>
            <div className="text-[10px] text-gray-500">
              {loginValidated ? "Validado" : "Pendiente validación"}
            </div>
          </div>
        </div>
      )}
      {isAdmin && (
        <div className="card bg-white border p-3 flex flex-col gap-2">
          <h3 className="heading">Agregar Perfil (admin)</h3>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input col-span-1"
              placeholder="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              className="input col-span-1"
              placeholder="nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="admin">admin</option>
              <option value="supervisor">supervisor</option>
              <option value="maintenance">maintenance</option>
            </select>
            <select
              className="input"
              value={speciality}
              onChange={(e) => setSpeciality(e.target.value)}
            >
              <option value="electric">electric</option>
              <option value="mechanic">mechanic</option>
              <option value="admin">admin</option>
            </select>
            <input
              className="input col-span-2"
              placeholder="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            className="btn btn-outline"
            onClick={handleAdd}
            disabled={!code || !name}
          >
            Guardar
          </button>
        </div>
      )}
      <div className="card p-3 border flex flex-col gap-2">
        <h3 className="heading">Perfiles ({knownProfiles.length})</h3>
        <ul className="max-h-40 overflow-auto text-xs space-y-1">
          {knownProfiles.map((p) => (
            <li
              key={p.code}
              className="px-2 py-1 bg-gray-50 rounded border flex justify-between"
            >
              <span>
                {p.code} - {p.name}
              </span>
              <span className="opacity-60">{p.role}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-3 border flex flex-col gap-2">
        <h3 className="heading">Peers ({peers.length})</h3>
        <ul className="text-xs space-y-1 max-h-32 overflow-auto">
          {peers.map((p) => (
            <li
              key={p.id}
              className="px-2 py-1 bg-blue-50 rounded border border-blue-100"
            >
              <div className="flex justify-between">
                <span>
                  {p.presenceProfileCode || p.profile?.code || p.id.slice(0, 8)}
                </span>
                <span>{p.state}</span>
              </div>
              {(p.profile || p.presenceProfileName) && (
                <div className="text-[10px] mt-1 italic">
                  {(p.profile?.name || p.presenceProfileName) ?? ""} (
                  {p.profile?.role || "?"})
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-3 border flex flex-col gap-2">
        <h3 className="heading">Chat</h3>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="mensaje"
            value={chatMsg}
            onChange={(e) => setChatMsg(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={!chatMsg}
          >
            Enviar
          </button>
        </div>
        <ul className="text-xs max-h-48 overflow-auto space-y-1">
          {messages.map((m, i) => (
            <li key={i} className="px-2 py-1 bg-gray-100 rounded">
              {m}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
