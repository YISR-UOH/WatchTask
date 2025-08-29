# WatchTask

App P2P de tareas (serverless)

- Vite + React
- WebRTC DataChannel con señalización manual via QR (sin servidores)
- Despliegue en GitHub Pages bajo /WatchTask/

Cómo ejecutar localmente:

1. Instalar dependencias y correr en modo dev
   - Ir a la carpeta APP
   - Instalar: npm install
   - Ejecutar: npm run dev
2. Construir producción: npm run build

Despliegue en GitHub Pages:

- Workflow en .github/workflows/deploy.yml ya configurado
- Empuja a main y se publicará automáticamente
