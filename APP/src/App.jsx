import { useEffect, useState } from "react";
import { addTask, getTasks, tareas } from "./p2p/store";

function App() {
  const [list, setList] = useState(getTasks());

  useEffect(() => {
    const update = () => setList(getTasks());
    tareas.observe(update);
    return () => tareas.unobserve(update);
  }, []);

  return (
    <div style={{ padding: "1rem" }}>
      <h1>📡 App P2P de Tareas.</h1>
      <ul>
        {Object.entries(list).map(([id, t]) => (
          <li key={id}>
            {t.nombre} — {t.estado}
          </li>
        ))}
      </ul>
      <button
        onClick={() =>
          addTask(Date.now().toString(), {
            nombre: "Nueva tarea",
            estado: "pendiente",
          })
        }
      >
        ➕ Agregar tarea
      </button>
    </div>
  );
}

export default App;
