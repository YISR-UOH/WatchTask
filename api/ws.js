import { WebSocketServer } from "ws";

let wss;

export default function handler(req, res) {
  if (!res.socket.server.wss) {
    console.log("Inicializando WebSocket...");
    wss = new WebSocketServer({ noServer: true });

    res.socket.server.on("upgrade", (request, socket, head) => {
      if (request.url === "/api/ws") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    });

    wss.on("connection", (ws) => {
      console.log("Nuevo cliente conectado");

      ws.on("message", (msg) => {
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === 1) {
            client.send(msg.toString());
          }
        });
      });
    });

    res.socket.server.wss = wss;
  }

  res.end();
}
