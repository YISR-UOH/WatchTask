import fitz
import re
import json
from datetime import datetime
import os

def extract_text_from_pdf(pdf_path):
    text_pages= []
    try:
        doc = fitz.open(pdf_path)
        for page_num in range(len(doc)):
            try:
                page = doc.load_page(page_num)
                text: str = extract_text_from_pdf_page(page)
                if text:
                    text_pages.append(text)
            except Exception as e:
                print(f"Error en página {page_num}: {e}")
                continue
        doc.close()
    except Exception as e:
        print(f"Error al abrir PDF {pdf_path}: {e}")
        return []
    
    return text_pages

def extract_text_from_pdf_page(page):
    words = page.get_text("words")
    if not words:
        return ""
    
    y_tolerance = 5
    words_sorted = sorted(words, key=lambda w: (w[1], w[0]))
    lines = []
    current_line = []
    current_y = None
    
    for word in words_sorted:
        x0, y0, x1, y1, text, block_no, line_no, word_no = word
        y_center = (y0 + y1) / 2
        
        if current_y is None or abs(y_center - current_y) <= y_tolerance:
            current_line.append(word)
            if current_y is None:
                current_y = y_center
            else:
                current_y = sum((w[1] + w[3]) / 2 for w in current_line) / len(current_line)
        else:
            if current_line:
                lines.append(current_line)
            current_line = [word]
            current_y = y_center
    
    if current_line:
        lines.append(current_line)
    
    final_text = ""
    for line_words in lines:
        line_words.sort(key=lambda w: w[0])
        line_text = ""
        prev_x1 = None
        
        for word in line_words:
            x0, y0, x1, y1, text, block_no, line_no, word_no = word
            if prev_x1 is not None and x0 - prev_x1 > 1:
                line_text += " "
            line_text += text
            prev_x1 = x1
        
        if line_text.strip():
            final_text += line_text + "\n"
    
    return final_text.rstrip("\n")

def process_pdf_to_json(pdf_path):
    text_pages = extract_text_from_pdf(pdf_path)
    if not text_pages:
        print("No se pudo extraer texto del PDF")
        return {}
    return text_pages

def extract_campos_variables(texto):
    campos_opcionales = ["Fecha Fin", "Frec. Horas", "F. Real de Ejecucion", "Frec. Comb.", "Incidencia"]
    patrones = {
        "Numero orden": r'Número orden (\d+)',
        "Tipo de Orden": r'[A-Z0-9]\nClase',
        "Clase": r'Clase (.+?) Asignado a',
        "Asignado a": r'Asignado a (.+?)\n',
        "Descripcion": r'Descripción (.+?) Tipo',
        "Tipo": r'Tipo (.+?) Estado',
        "Estado": r'Estado (.+?) Frec',
        "Frec. Dias": r'Frec\. D[ií]as ([0-9]+)',
        "N Unidad": r'Nº Unidad (.+?) Parte',
        "Parte": r'Parte (.+?) F inicial',
        "F inicial": r'F inicial ([0-9/]+)',
        "Frec. Comb.": r'Frec\. Comb\. (.+?)',
        "Especialidad": r'Especialidad (.+?) Elemento',
        "Elemento": r'Elemento (.+?) FF\.\.RReeaall',
        "F. Real de Ejecucion": r'FF\.\.RReeaall EEjjeeccuucciioonn (.+?) Frec\. Km',
        "Frec. Km": r'Frec\. Km ([^ ]*)',
        "Modo": r'Modo ([^ ]*?)(?:\s+(?:Fecha Fin|Frec\. Horas))',
        "Fecha Fin": r'Fecha Fin ([0-9/]+)',
        "Frec. Horas": r'Frec\. Horas ([^ ]*)',
        "Originador": r'Originador ([A-Z]+ [A-ZÁÉÍÓÚÑa-z\s]+)\nIncidencia',
        "Incidencia": r'Incidencia (.+?) Fecha Venc\.',
        "Fecha Venc.": r'Fecha Venc\. ([0-9/]+)',
        "Ultima Realiz.": r'Ultima Realiz\. ([0-9/]+)',
        "Linea": r'Linea (.+?) Kit de Tareas',
        "Kit de Tareas": r'Kit de Tareas ([0-9]+)',
        "Proximo Venc.": r'Proximo Venc\. ([0-9/]+)',
        "Fecha Prox Emision": r'Fecha Prox Emisión ([0-9/]+)',
        "N de Serie": r'Nº de Serie (.+?) Planta',
        "Planta": r'Planta (.+?) Tipo servici',
        "Tipo servici": r'Tipo servici ([A-Z0-9]+ [A-ZÁÉÍÓÚÑa-z\.]+)',
        "Prioridad": r'Prioridad: ([A-Z\-a-z]+)',
        "Seg. y Medio Ambiente": r'Seg\. y Medio Ambiente ([A-Z0-9]+)',
        "Calidad": r'Calidad ([A-Z0-9]+)',
        "Operacion": r'Operación ([A-Z0-9]+)',
        "Mantenimiento": r'Mantenimiento ([A-Z0-9]+)',
        "Categorizacion": r'Categorización ([A-Z0-9]+)',
        "Tipo de Servicio": r'Tipo de Servicio (.+?)\n',
    }
    
    orden = {}

    for campo in campos_opcionales:
        orden[campo] = None
    for campo, patron in patrones.items():
        match = re.search(patron, texto)
        if match:
            valor = match.group(1).strip()
            orden[campo] = valor
    
    prioridad_val: str = orden.get("Tipo de Servicio")
    if "SYS" in prioridad_val:
        prioridad_val = 1
    elif "CCL" in prioridad_val:
        prioridad_val = 2
    else:
        prioridad_val = 3
    
    orden["Frec. Dias"] = int(orden["Frec. Dias"]) if orden["Frec. Dias"] and orden["Frec. Dias"].isdigit() else None
    orden["prioridad"] = prioridad_val
    orden["asignado_a_code"] = None
    orden["asignado_por_name"] = None
    orden["asignado_por_code"] = None
    orden["Especialidad_id"] = None
    orden["hs_reales"] = 0.0
    orden["fecha_inicio"] = None
    orden["fecha_fin"] = None
    orden["observaciones"] = None
    orden["status"] = 0  
    orden["obs_anulada"] = None
    orden["code_orden_anulada"] = None
    orden["checkListDict"] = {}
    return orden

def extract_tabla_tareas(text):
    lines = text.split('\n')
    tabla = []
    indice = 0
    regex = r'^([A-ZÁÉÍÓÚÑa-z0-9]+)\s+([\d\S]+)\s+(\d+)\s+(.*)\s+(\d\.\d+|\.\d+)\s+(.+)'
    regex2 = r'^([A-ZÁÉÍÓÚÑa-z0-9]+)\s+([\d\.]+)\s+(\d+)\s+(.+)'
    total_hs_estim = 0.0
    
    for line in lines[17:]:
        match = re.match(regex, line)
        if match:
            hs_estim = match.group(5)
            try:
                hs_estim_float = float(hs_estim)
            except ValueError:
                hs_estim_float = 0.0
            
            fila = {
                "Taller": match.group(1),
                "Numero sec oper": float(match.group(2)),
                "Tarea Standard": match.group(3),
                "Descripcion": match.group(4),
                "Hs Estim": hs_estim_float,
                "Valor esperado": match.group(6)
            }
            fila["completed_by"] = None
            fila["date_completed"] = None
            fila["obs_assigned_by"] = None
            fila["obs_assigned_to"] = None
            fila["init_task"] = None
            fila["end_task"] = None
            fila["completed_by"] = None
            fila["status"] = 0
            fila["duration_seconds"] = None
            fila["pause"] = None
            tabla.append(fila)
            indice += 1
            
        elif re.match(regex2, line):
            match2 = re.match(regex2, line)
            if match2:
                fila = {
                    "Taller": match2.group(1),
                    "Numero sec oper": float(match2.group(2)),
                    "Tarea Standard": match2.group(3),
                    "Descripcion": match2.group(4),
                    "Hs Estim": 0.0,
                    "Valor esperado": match2.group(4),
                }
                fila["completed_by"] = None
                fila["date_completed"] = None
                fila["obs_assigned_by"] = None
                fila["obs_assigned_to"] = None
                fila["init_task"] = None
                fila["end_task"] = None
                fila["completed_by"] = None
                fila["status"] = 0
                fila["duration_seconds"] = None
                fila["pause"] = None
                tabla.append(fila)
                indice += 1
        else:
            try:
                total_hs_estim = sum(fila["Hs Estim"] for fila in tabla)
                total_hs_estim = round(total_hs_estim, 3)
            except (ValueError, TypeError):
                total_hs_estim = 0.0
            result = {"data": tabla, "Tasks_N": indice, "h_estimadas": total_hs_estim}
            return result
    try:
        total_hs_estim = sum(fila["Hs Estim"] for fila in tabla)
        total_hs_estim = round(total_hs_estim, 3)
    except (ValueError, TypeError):
        total_hs_estim = 0.0
    result = {"data": tabla, "Tasks_N": indice, "h_estimadas": total_hs_estim}
    return result

def extract_protocolos(index, text) -> str:
    protocolos = ""
    fin_pauta_markers = ["OT Generadas", "Realizado por:", "Firma:"]
    lines = text.split('\n')
    protocolos = '\n'.join(lines[index + 17:]).strip()
    for marker in fin_pauta_markers:
        idx = protocolos.find(marker)
        if idx != -1:
            protocolos = protocolos[:idx].strip()
            break
    return protocolos

def asignar_protocolos_a_secciones(index,texto):
    texto = extract_protocolos(index, texto)
    initT = re.compile(r'^(.?.?T\d+)', re.MULTILINE | re.IGNORECASE)
    initSeguridad = re.compile(r'^(.?.?SEGURIDAD)|^(.?.?SGURIDAD)', re.MULTILINE | re.IGNORECASE)
    anexos = []
    aux = ""
    aux_sg = ""
    flag = 0
    flag_sg = 0
    for i in texto.split('\n'):
        if initT.match(i):
            if flag == 1:
                if aux_sg != "":
                    aux = aux_sg + "\n" + aux[0:]
                    anexos.append(aux)
                else:
                    anexos.append(aux)
            aux = i
            flag = 1
            flag_sg = 0
        elif initSeguridad.match(i) and flag == 1 and flag_sg == 0:
            aux += "\n" + i
        elif initSeguridad.match(i):
            if flag_sg == 1 and flag == 1:
                aux = aux_sg + "\n" + aux[0:]
                anexos.append(aux)
            else:
                aux_sg = i
                flag = 2
                flag_sg = 1
        else:
            if flag == 1:
                aux += "\n" + i
            elif flag == 2:
                aux_sg += "\n" + i
    if flag == 1:
        if aux_sg != "":
            aux = aux_sg + "\n" + aux[0:]
            anexos.append(aux)
        else:
            anexos.append(aux)
    elif flag == 2:
        if aux_sg != "":
            anexos.append(aux_sg)
    return anexos

    
def getData(pdf_path):
    data = process_pdf_to_json(pdf_path)
    patron = r'Número orden (\d+)'
    regex = r"(\nOT Generadas)|(\nRealizado por:)|(\nFirma:)"
    subst = ""
    ordenes = {}
    for i in data:
        search_ordenes = re.findall(patron, i, re.MULTILINE | re.DOTALL)
        if search_ordenes:
            if ordenes.get(search_ordenes[0]):
                result = re.sub(regex, subst, i)
                result = '\n'.join(result.split('\n')[3:])
                ordenes[search_ordenes[0]]["data"] += "\n"+result
            else:
                ordenes[search_ordenes[0]] = {}
                result = re.sub(regex, subst, i)
                ordenes[search_ordenes[0]]["data"] = result
    for i in ordenes.keys():
        ordenes[i]["info"] = extract_campos_variables(ordenes[i]["data"])
        ordenes[i]["tasks"] = extract_tabla_tareas(ordenes[i]["data"])
        ordenes[i]["protocolos"] = asignar_protocolos_a_secciones(ordenes[i]["tasks"]["Tasks_N"],ordenes[i]["data"])
    return ordenes

def save_to_json(input,output_path):
    data = getData(input)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

save_to_json("test.pdf","output.json")