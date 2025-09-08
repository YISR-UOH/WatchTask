import React, { useEffect, useState } from "react";
import { processAndStorePdf } from "./utils/pdfUtils";
import { openDB } from "idb";
import Connection from "@/components/Connection";
import "@/style/style.css";
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
      // Ensure object store exists by providing upgrade callback
      const db = await openDB("pdfDataDB", 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("pdfData")) {
            db.createObjectStore("pdfData", { keyPath: "id" });
          }
        },
      });
      let count = 0;
      try {
        count = await db.count("pdfData");
      } catch (e) {
        count = 0;
      }
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
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-700 text-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">WatchTask</h1>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <span className="hidden sm:inline">Cargar PDF</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => handlePdf(e.target.files[0])}
                className="block text-sm text-white file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white file:text-blue-700 hover:file:bg-blue-100"
              />
            </label>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <section className="card md:col-span-1 lg:col-span-1 flex flex-col gap-2">
          <h2 className="heading">Resumen</h2>
          <p className="muted">Estado general de los datos procesados.</p>
          <div className="mt-2 grid grid-cols-2 gap-3 text-center">
            <div className="p-3 rounded-md bg-blue-50 border border-blue-100">
              <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
                Órdenes
              </p>
              <p className="text-lg font-semibold text-blue-700">{numOrders}</p>
            </div>
            <div className="p-3 rounded-md bg-blue-50 border border-blue-100">
              <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
                En DB
              </p>
              <p className="text-lg font-semibold text-blue-700">{lenDB}</p>
            </div>
          </div>
        </section>
        <section className="card md:col-span-1 lg:col-span-2">
          <Connection />
        </section>
      </main>
      <footer className="mt-auto bg-white border-t border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 text-xs text-gray-500 flex items-center justify-between">
          <span>© {new Date().getFullYear()} WatchTask v0.0.2</span>
          <span>Tailwind UI básico</span>
        </div>
      </footer>
    </div>
  );
}
