import React, { useEffect, useState } from "react";
import { processAndStorePdf } from "./utils/pdfUtils";
import { openDB } from "idb";
import Chat from "@/components/chat";
export default function App() {
  const [numOrders, setNumOrders] = useState(0);
  const [lenDB, setLenDB] = useState(0);

  useEffect(() => {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then((persistent) => {
        if (persistent) {
          console.log("Almacenamiento persistente garantizado");
        } else {
          console.log("No se pudo garantizar almacenamiento persistente");
        }
      });
    }
  }, []);
  useEffect(() => {
    async function updateCount() {
      const db = await openDB("pdfDataDB", 1);
      const count = await db.count("pdfData");

      setLenDB(count);
    }
    updateCount();
    const intervalId = setInterval(updateCount, 5000);
    return () => clearInterval(intervalId);
  }, []);

  async function handlePdf(file) {
    await processAndStorePdf(file, setNumOrders);
  }

  return (
    <div>
      <input
        type="file"
        accept="application/pdf"
        onChange={(e) => handlePdf(e.target.files[0])}
      />
      <p>Órdenes procesadas: {numOrders}</p>
      <p>Elementos en la base de datos: {lenDB}</p>
      <Chat />
    </div>
  );
}
