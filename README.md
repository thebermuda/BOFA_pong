# BOFA Pong

Pong web realtime para mostrar en una pantalla grande, con dos celulares como control (uno por lado). Pensado como prototipo local — todo corre en tu red LAN.

- Servidor **Node.js + Express + Socket.IO** (autoritativo, tick 60 Hz).
- **Display** en `/` (pantalla grande / TV / monitor).
- **Controles** en `/play?side=left|right` (celulares), asignados por QR.
- Estilo **neón / synthwave**, fuentes Orbitron, glow, trail de pelota, partículas, SFX 8-bit.

## Requisitos

- Node.js 18+
- La pantalla (PC/TV) y los celulares en la **misma red WiFi**.

## Instalación

```bash
npm install
```

## Cómo correr

```bash
npm start
```

La consola mostrará algo como:

```
BOFA Pong  -  server ready
Display  : http://192.168.1.42:3000/
Left QR  : http://192.168.1.42:3000/play?side=left
Right QR : http://192.168.1.42:3000/play?side=right
```

1. Abrí el `Display` en la pantalla grande (navegador moderno, idealmente en pantalla completa con `F11`).
2. Con cada celular escaneá el QR correspondiente que aparece en el display:
   - El **QR izquierdo (cyan)** asigna al jugador a la paleta izquierda.
   - El **QR derecho (magenta)** asigna a la paleta derecha.
3. Cuando los dos celulares están conectados, arranca un countdown `3 · 2 · 1 · GO` y empieza el partido.
4. Primero a **7 goles** gana. Después del gane se vuelve a la pantalla de espera.

## Cómo se controla desde el celular

- Pantalla completa con un área vertical grande.
- **Deslizá el dedo hacia arriba y abajo** dentro del área: la posición vertical de tu dedo mapea a la posición de tu paleta.
- Vibración al rebote / gol (si el celular lo soporta).

## Reglas de emparejamiento

- Cada lado es un slot único. Si dos celulares intentan tomar el mismo lado, el segundo recibe "Lado ocupado" y debe escanear el otro QR.
- Si un celular se desconecta (cierra el navegador o pierde WiFi), el juego entra en `paused` y el QR de ese lado reaparece en el display hasta que alguien vuelva a conectarse.

## Configuración

- Puerto: variable de entorno `PORT` (por defecto `3000`).
  ```bash
  PORT=4000 npm start
  ```
- La IP de la LAN se detecta automáticamente al arrancar. Si tenés varias interfaces y toma la incorrecta, podés forzar poniendo la URL manualmente en `PUBLIC_BASE` editando `server.js`.

## Estructura del código

```
BOFA_pong/
├── server.js             # Express + Socket.IO + loop 60Hz + endpoint /qr
├── src/
│   └── game.js           # Estado + física + colisiones + goles
└── public/
    ├── display.html      # Pantalla grande
    ├── play.html         # Control móvil
    ├── css/
    │   ├── common.css
    │   ├── display.css
    │   └── play.css
    └── js/
        ├── display.js    # Render canvas neon, partículas, SFX
        └── play.js       # Touch handler + socket
```

## Eventos Socket.IO

Cliente → Server:
- `display:join`
- `player:claim { side }`
- `player:input { y }` (0–1 normalizado)
- `game:restart`

Server → Cliente:
- `display:hello { world, snapshot }`
- `game:tick { ... }` (solo display, 60 Hz)
- `room:state { status, slots, score, winner }`
- `player:assigned { side, bothConnected }` / `player:rejected { reason }`
- `game:event [{ type: 'bump'|'goal'|'countdown'|'win', ... }]`

## Troubleshooting

- **Los celulares no cargan la URL del QR**: asegurate de estar en la misma WiFi que el servidor y que el firewall del host deje pasar el puerto (por defecto 3000).
- **El QR muestra `127.0.0.1` o `localhost`**: significa que el server no detectó una interfaz de red externa. Conectate a una red WiFi y reiniciá el servidor.
- **Audio no suena**: los navegadores bloquean `AudioContext` hasta que hay un gesto del usuario. Hacé click en la pantalla del display una vez para desbloquearlo.
