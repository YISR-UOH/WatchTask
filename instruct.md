implementar en React (PWA) con Firebase Realtime Database un sistema de descubrimiento de peers sin rooms para señalización WebRTC.

funcionamiento de la app:

- Cada peer tiene un peerId único (UUID) y se registra en /peers/{peerId}.
- crear una db en indexedDB para almacenar peers conocidos, donde el key es el code del perfil, el perfil es un objeto con la siguiente estructura:
  Key: code (int)
  Value:
  {
  code: string (int),
  name: string,
  uuid: string (UUID),
  role: "admin" | "supervisor" | "maintenance",
  speciality: "electric" | "mechanic" | "admin"
  }
- solo el admin puede agregar nuevos perfiles a la db indexedDB.
- todos los peers reciben la información de los perfiles desde indexedDB, para que puedan realizar login con su code y password.
- al conectarse, el peer automaticamente se registra en firebase y debe iniciar sesión con su code y password, para validar que el perfil existe en indexedDB, es validado por otro peer que ya está conectado.
- existen 2 db (indexedDB) una es profiles (perfiles autorizados) y otra es orderData (órdenes de trabajo).
- cada peer al desconectarse, debe borrarse su nodo automáticamente (usar onDisconnect).
- Escuchar cambios en /peers/ para descubrir otros peers en tiempo real.
- Cuando detecta un peer nuevo, debe iniciar la señalización WebRTC enviando su offer a /peers/{targetPeerId}/offers/{myPeerId}.
- Si recibe una offer, debe generar un answer y guardarlo en /peers/{sourcePeerId}/answers/{myPeerId}.
- Los ICE candidates también deben intercambiarse en /peers/{peerId}/candidates/{otherPeerId}.
- Estructura en Firebase Realtime Database:
  /peers/
  {peerId}/
  offers: { fromPeerId: sdp }
  answers: { fromPeerId: sdp }
  candidates:
  { fromPeerId: [ ... ] }

Implementa un React hook o componente principal que maneje:

- Registro de perfil en Firebase.
- Descubrimiento de otros peers.
- Flujo de señalización (offer, answer, ICE).
- Creación del RTCPeerConnection y RTCDataChannel para chat básico.
- Envío y recepción de mensajes en tiempo real entre todos los peers (malla completa).
- Muestra la lista de peers conectados y sus perfiles.
