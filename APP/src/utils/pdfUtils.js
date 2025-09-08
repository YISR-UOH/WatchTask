import * as pdfjsLib from "pdfjs-dist";
import { openDB } from "idb";

// Worker local in public folder
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

// 1. Extraer texto de PDF
async function extractTextFromPdf(file) {
  const pdf = await pdfjsLib.getDocument({
    url: URL.createObjectURL(file),
  }).promise;

  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const text = await extractTextFromPdfPage(page);
    pages.push(text);
  }
  return pages;
}

async function extractTextFromPdfPage(page) {
  const content = await page.getTextContent();

  const items = content.items.map((item) => {
    const [a, b, c, d, e, f] = item.transform;
    return { text: item.str, x: e, y: f, width: item.width, height: d };
  });

  const wordsSorted = items.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 5) return b.y - a.y;
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = [];
  let currentY = null;
  const yTolerance = 5;

  for (let word of wordsSorted) {
    if (currentY === null || Math.abs(word.y - currentY) <= yTolerance) {
      currentLine.push(word);
      if (currentY === null) currentY = word.y;
      else {
        currentY =
          currentLine.reduce((acc, w) => acc + w.y, 0) / currentLine.length;
      }
    } else {
      if (currentLine.length) lines.push(currentLine);
      currentLine = [word];
      currentY = word.y;
    }
  }
  if (currentLine.length) lines.push(currentLine);

  let finalText = "";
  for (let line of lines) {
    line.sort((a, b) => a.x - b.x);
    let lineText = "";
    let prevX = null;
    for (let word of line) {
      if (prevX !== null && word.x - prevX > word.height * 0.2) {
        lineText += " ";
      }
      lineText += word.text;
      prevX = word.x + word.width;
    }
    if (lineText.trim()) finalText += lineText + "\n";
  }

  return finalText.trim();
}

// ...existing code...
// 2. Procesar páginas de texto extraídas del PDF
function processTextPages(textPages) {
  if (!textPages || !Array.isArray(textPages) || textPages.length === 0) {
    console.warn("No se pudo extraer texto del PDF");
    return {};
  }
  return textPages;
}

// 4. Extraer campos variables de una orden
function extractCamposVariables(texto) {
  const camposOpcionales = [
    "Fecha Fin",
    "Frec. Horas",
    "F. Real de Ejecucion",
    "Frec. Comb.",
    "Incidencia",
  ];
  const patrones = {
    "Numero orden": /Número orden\s+?(\d+)/,
    "Tipo de Orden": /[A-Z0-9]\nClase/,
    Clase: /Clase (.+?) Asignado a/,
    "Asignado a": /Asignado a (.+?)\n/,
    Descripcion: /Descripción (.+?) Tipo/,
    Tipo: /Tipo (.+?) Estado/,
    Estado: /Estado (.+?) Frec/,
    "Frec. Dias": /Frec\. D[ií]as ([0-9]+)/,
    "N Unidad": /Nº Unidad (.+?) Parte/,
    Parte: /Parte (.+?) F inicial/,
    "F inicial": /F inicial ([0-9/]+)/,
    "Frec. Comb.": /Frec\. Comb\. (.+?)/,
    Especialidad: /Especialidad (.+?) Elemento/,
    Elemento: /Elemento (.+?) FF\.\.RReeaall/,
    "F. Real de Ejecucion": /FF\.\.RReeaall EEjjeeccuucciioonn (.+?) Frec\. Km/,
    "Frec. Km": /Frec\. Km ([^ ]*)/,
    Modo: /Modo ([^ ]*?)(?:\s+(?:Fecha Fin|Frec\. Horas))/,
    "Fecha Fin": /Fecha Fin ([0-9/]+)/,
    "Frec. Horas": /Frec\. Horas ([^ ]*)/,
    Originador: /Originador\s+?([A-Z]+ [A-ZÁÉÍÓÚÑa-z\s]+)\nIncidencia/,
    Incidencia: /Incidencia (.+?) Fecha Venc\./,
    "Fecha Venc.": /Fecha Venc\. ([0-9/]+)/,
    "Ultima Realiz.": /Ultima Realiz\.\s+?([0-9/]+)/,
    Linea: /Linea (.+?) Kit de Tareas/,
    "Kit de Tareas": /Kit de Tareas ([0-9]+)/,
    "Proximo Venc.": /Proximo Venc\. ([0-9/]+)/,
    "Fecha Prox Emision": /Fecha Prox Emisión ([0-9/]+)/,
    "N de Serie": /Nº de Serie (.+?) Planta/,
    Planta: /Planta (.+?) Tipo servici/,
    "Tipo servici": /Tipo servici ([A-Z0-9]+ [A-ZÁÉÍÓÚÑa-z\.]+)/,
    Prioridad: /Prioridad: ([A-Z\-a-z]+)/,
    "Seg. y Medio Ambiente": /Seg\. y Medio Ambiente ([A-Z0-9]+)/,
    Calidad: /Calidad ([A-Z0-9]+)/,
    Operacion: /Operación ([A-Z0-9]+)/,
    Mantenimiento: /Mantenimiento ([A-Z0-9]+)/,
    Categorizacion: /Categorización\s+?([A-Z0-9]+)/,
    "Tipo de Servicio": /Tipo de Servicio (.+?)\n/,
  };
  const orden = {};
  camposOpcionales.forEach((campo) => (orden[campo] = null));
  for (const [campo, patron] of Object.entries(patrones)) {
    const match = texto.match(patron);
    if (match) {
      orden[campo] = match[1].trim();
    }
  }
  let prioridadVal = orden["Tipo de Servicio"];
  if (prioridadVal && prioridadVal.includes("SYS")) {
    prioridadVal = 1;
  } else if (prioridadVal && prioridadVal.includes("CCL")) {
    prioridadVal = 2;
  } else {
    prioridadVal = 3;
  }
  orden["Frec. Dias"] =
    orden["Frec. Dias"] && !isNaN(orden["Frec. Dias"])
      ? parseInt(orden["Frec. Dias"])
      : null;
  orden["prioridad"] = prioridadVal;
  orden["asignado_a_code"] = null;
  orden["asignado_por_name"] = null;
  orden["asignado_por_code"] = null;
  orden["Especialidad_id"] = null;
  orden["hs_reales"] = 0.0;
  orden["fecha_inicio"] = null;
  orden["fecha_fin"] = null;
  orden["observaciones"] = null;
  orden["status"] = 0;
  orden["obs_anulada"] = null;
  orden["code_orden_anulada"] = null;
  orden["checkListDict"] = {};
  return orden;
}

// 5. Extraer tabla de tareas
function extractTablaTareas(text) {
  const lines = text.split("\n");
  const tabla = [];
  let indice = 0;
  const regex =
    /^([A-ZÁÉÍÓÚÑa-z0-9]+)\s+([\d\S]+)\s+(\d+)\s+(.*)\s+(\d\.\d+|\.\d+)\s+(.+)/;
  const regex2 = /^([A-ZÁÉÍÓÚÑa-z0-9]+)\s+([\d\.]+)\s+(\d+)\s+(.+)/;
  let totalHsEstim = 0.0;
  for (let i = 17; i < lines.length; i++) {
    const line = lines[i];
    let match = line.match(regex);
    if (match) {
      let hsEstimFloat = parseFloat(match[5]);
      if (isNaN(hsEstimFloat)) hsEstimFloat = 0.0;
      const fila = {
        Taller: match[1],
        "Numero sec oper": parseFloat(match[2]),
        "Tarea Standard": match[3],
        Descripcion: match[4],
        "Hs Estim": hsEstimFloat,
        "Valor esperado": match[6],
        completed_by: null,
        date_completed: null,
        obs_assigned_by: null,
        obs_assigned_to: null,
        init_task: null,
        end_task: null,
        status: 0,
        duration_seconds: null,
        pause: null,
      };
      tabla.push(fila);
      indice++;
    } else {
      match = line.match(regex2);
      if (match) {
        const fila = {
          Taller: match[1],
          "Numero sec oper": parseFloat(match[2]),
          "Tarea Standard": match[3],
          Descripcion: match[4],
          "Hs Estim": 0.0,
          "Valor esperado": match[4],
          completed_by: null,
          date_completed: null,
          obs_assigned_by: null,
          obs_assigned_to: null,
          init_task: null,
          end_task: null,
          status: 0,
          duration_seconds: null,
          pause: null,
        };
        tabla.push(fila);
        indice++;
      } else {
        try {
          totalHsEstim = tabla.reduce(
            (acc, fila) => acc + (fila["Hs Estim"] || 0),
            0
          );
          totalHsEstim = Math.round(totalHsEstim * 1000) / 1000;
        } catch {
          totalHsEstim = 0.0;
        }
        return { data: tabla, Tasks_N: indice, h_estimadas: totalHsEstim };
      }
    }
  }
  try {
    totalHsEstim = tabla.reduce(
      (acc, fila) => acc + (fila["Hs Estim"] || 0),
      0
    );
    totalHsEstim = Math.round(totalHsEstim * 1000) / 1000;
  } catch {
    totalHsEstim = 0.0;
  }
  return { data: tabla, Tasks_N: indice, h_estimadas: totalHsEstim };
}

// 6. Extraer protocolos
function extractProtocolos(index, text) {
  let protocolos = "";
  const finPautaMarkers = ["OT Generadas", "Realizado por:", "Firma:"];
  const lines = text.split("\n");
  protocolos = lines
    .slice(index + 17)
    .join("\n")
    .trim();
  for (const marker of finPautaMarkers) {
    const idx = protocolos.indexOf(marker);
    if (idx !== -1) {
      protocolos = protocolos.slice(0, idx).trim();
      break;
    }
  }
  return protocolos;
}

// 7. Asignar protocolos a secciones
function asignarProtocolosASecciones(index, texto) {
  texto = extractProtocolos(index, texto);
  const initT = /^(.?.?T\d+)/im;
  const initSeguridad = /^(.?.?SEGURIDAD)|^(.?.?SGURIDAD)/im;
  const anexos = [];
  let aux = "";
  let aux_sg = "";
  let flag = 0;
  let flag_sg = 0;
  for (const i of texto.split("\n")) {
    if (initT.test(i)) {
      if (flag === 1) {
        if (aux_sg !== "") {
          aux = aux_sg + "\n" + aux;
          anexos.push(aux);
        } else {
          anexos.push(aux);
        }
      }
      aux = i;
      flag = 1;
      flag_sg = 0;
    } else if (initSeguridad.test(i) && flag === 1 && flag_sg === 0) {
      aux += "\n" + i;
    } else if (initSeguridad.test(i)) {
      if (flag_sg === 1 && flag === 1) {
        aux = aux_sg + "\n" + aux;
        anexos.push(aux);
      } else {
        aux_sg = i;
        flag = 2;
        flag_sg = 1;
      }
    } else {
      if (flag === 1) {
        aux += "\n" + i;
      } else if (flag === 2) {
        aux_sg += "\n" + i;
      }
    }
  }
  if (flag === 1) {
    if (aux_sg !== "") {
      aux = aux_sg + "\n" + aux;
      anexos.push(aux);
    } else {
      anexos.push(aux);
    }
  } else if (flag === 2) {
    if (aux_sg !== "") {
      anexos.push(aux_sg);
    }
  }
  return anexos;
}

// 8. Obtener datos estructurados de las páginas de texto
function getData(textPages) {
  const data = processTextPages(textPages);
  const patron = /Número orden\s+?(\d+)/;
  const regex = /(\nOT Generadas)|(\nRealizado por:)|(\nFirma:)/g;
  const subst = "";
  const ordenes = {};
  for (const i of data) {
    let searchOrdenes;
    if ((searchOrdenes = patron.exec(i)) !== null) {
      const ordenNum = searchOrdenes[1];
      if (ordenes[ordenNum]) {
        let result = i.replace(regex, subst);
        result = result.split("\n").slice(3).join("\n");
        ordenes[ordenNum]["data"] += "\n" + result;
      } else {
        ordenes[ordenNum] = {};
        let result = i.replace(regex, subst);
        ordenes[ordenNum]["data"] = result;
      }
    }
  }
  for (const i in ordenes) {
    ordenes[i]["info"] = extractCamposVariables(ordenes[i]["data"]);
    ordenes[i]["tasks"] = extractTablaTareas(ordenes[i]["data"]);
    ordenes[i]["protocolos"] = asignarProtocolosASecciones(
      ordenes[i]["tasks"]["Tasks_N"],
      ordenes[i]["data"]
    );
  }
  return ordenes;
}

// 3. Guardar en IndexedDB
async function saveToIndexedDB(jsonData) {
  // Accepts either an array or an object (dictionary of orders)
  // Convert object to array of entries with id as key
  let dataArray = [];
  if (Array.isArray(jsonData)) {
    dataArray = jsonData;
  } else if (typeof jsonData === "object" && jsonData !== null) {
    dataArray = Object.entries(jsonData).map(([id, value]) => ({
      id,
      ...value,
    }));
  }
  const db = await openDB("pdfDataDB", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("pdfData")) {
        db.createObjectStore("pdfData", { keyPath: "id" });
      }
    },
  });
  const tx = db.transaction("pdfData", "readwrite");
  for (const entry of dataArray) {
    await tx.store.put(entry);
  }
  await tx.done;
}

// Helper: Procesar un archivo PDF y guardar el resultado en IndexedDB
// Uso: await processAndStorePdf(file)
async function processAndStorePdf(file, setNumOrders) {
  const textPages = await extractTextFromPdf(file);
  const ordenes = getData(textPages);
  await saveToIndexedDB(ordenes);
  setNumOrders(Object.keys(ordenes).length);
}

export {
  extractTextFromPdf,
  processTextPages,
  saveToIndexedDB,
  extractCamposVariables,
  extractTablaTareas,
  extractProtocolos,
  asignarProtocolosASecciones,
  getData,
  processAndStorePdf,
};
