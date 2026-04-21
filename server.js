'use strict';

const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const {
  createInitialState,
  setSlot,
  setPaddleTarget,
  startMatch,
  tick,
  getSnapshot,
  WORLD,
  setCourtWidth,
} = require('./src/game');

const PORT = Number(process.env.PORT || 3000);

function detectLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const LAN_IP = detectLanIp();
const LOCAL_BASE = `http://${LAN_IP}:${PORT}`;

function normalizePublicUrl(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

const ENV_PUBLIC_URL = normalizePublicUrl(
  process.env.PUBLIC_URL ||
  process.env.RAILWAY_PUBLIC_DOMAIN ||
  process.env.RAILWAY_STATIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.VERCEL_URL ||
  ''
);

function baseFromRequest(req) {
  if (ENV_PUBLIC_URL) return ENV_PUBLIC_URL;
  const xfProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
  const xfHost = (req.headers['x-forwarded-host'] || req.headers['host'] || '').toString().split(',')[0].trim();
  if (xfHost) {
    const proto = xfProto || (xfHost.includes('localhost') || /^\d/.test(xfHost) ? 'http' : 'https');
    return `${proto}://${xfHost}`.replace(/\/+$/, '');
  }
  return LOCAL_BASE;
}

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

app.get('/qr', async (req, res) => {
  const side = req.query.side === 'right' ? 'right' : 'left';
  const base = baseFromRequest(req);
  const url = `${base}/play?side=${side}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 10,
      color: {
        dark: side === 'left' ? '#00f0ff' : '#ff2bd6',
        light: '#00000000',
      },
    });
    res.json({ url, dataUrl, side });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/info', (req, res) => {
  const base = baseFromRequest(req);
  res.json({
    lanIp: LAN_IP,
    port: PORT,
    baseUrl: base,
    envPublicUrl: ENV_PUBLIC_URL,
    links: {
      display: `${base}/`,
      left: `${base}/play?side=left`,
      right: `${base}/play?side=right`,
    },
  });
});

const state = createInitialState();
const players = { left: null, right: null };
const displays = new Set();

function broadcastRoom() {
  const payload = {
    status: state.status,
    slots: { ...state.slots },
    score: { ...state.score },
    winner: state.winner,
  };
  io.emit('room:state', payload);
}

function emitAssignedStatus(side) {
  const socketId = players[side];
  if (!socketId) return;
  const s = io.sockets.sockets.get(socketId);
  if (!s) return;
  s.emit('player:assigned', {
    side,
    score: state.score,
    bothConnected: !!(players.left && players.right),
  });
}

io.on('connection', (socket) => {
  let role = null;

  socket.on('display:join', () => {
    role = 'display';
    displays.add(socket.id);
    socket.emit('display:hello', {
      world: { width: WORLD.width, height: WORLD.height },
      snapshot: getSnapshot(state),
    });
    broadcastRoom();
  });

  socket.on('display:setCourtWidth', ({ width } = {}) => {
    if (role !== 'display') return;
    if (typeof width !== 'number' || !Number.isFinite(width)) return;
    setCourtWidth(state, width);
  });

  socket.on('player:claim', ({ side } = {}) => {
    if (side !== 'left' && side !== 'right') {
      socket.emit('player:rejected', { reason: 'invalid_side' });
      return;
    }
    if (players[side] && players[side] !== socket.id) {
      socket.emit('player:rejected', { reason: 'occupied', side });
      return;
    }
    if (role === 'player' && socket.data.side && socket.data.side !== side) {
      players[socket.data.side] = null;
      setSlot(state, socket.data.side, false);
    }
    role = 'player';
    socket.data.side = side;
    players[side] = socket.id;
    setSlot(state, side, true);
    emitAssignedStatus(side);
    broadcastRoom();

    if (state.status === 'waiting' && state.slots.left && state.slots.right) {
      startMatch(state);
      broadcastRoom();
    }
  });

  socket.on('player:input', ({ y } = {}) => {
    if (role !== 'player' || !socket.data.side) return;
    if (typeof y !== 'number' || !isFinite(y)) return;
    setPaddleTarget(state, socket.data.side, y);
  });

  socket.on('game:restart', () => {
    if (state.status === 'win' && state.slots.left && state.slots.right) {
      startMatch(state);
      broadcastRoom();
    }
  });

  socket.on('disconnect', () => {
    if (role === 'display') {
      displays.delete(socket.id);
    } else if (role === 'player' && socket.data.side) {
      const side = socket.data.side;
      if (players[side] === socket.id) {
        players[side] = null;
        setSlot(state, side, false);
        broadcastRoom();
      }
    }
  });
});

const DT = 1 / WORLD.tickHz;
let lastStatus = state.status;
setInterval(() => {
  const events = tick(state, DT);
  if (events.length) {
    io.emit('game:event', events);
  }
  if (state.status !== lastStatus) {
    lastStatus = state.status;
    broadcastRoom();
  }
  if (displays.size > 0) {
    io.to(Array.from(displays)).emit('game:tick', getSnapshot(state));
  }
}, 1000 / WORLD.tickHz);

server.listen(PORT, '0.0.0.0', () => {
  const shown = ENV_PUBLIC_URL || LOCAL_BASE;
  console.log('\n  BOFA Pong  -  server ready');
  console.log(`  Public   : ${shown}/`);
  console.log(`  Left QR  : ${shown}/play?side=left`);
  console.log(`  Right QR : ${shown}/play?side=right`);
  if (!ENV_PUBLIC_URL) {
    console.log('  (no PUBLIC_URL set; QR URLs will be derived from request headers)');
  }
  console.log(`  (listening on 0.0.0.0:${PORT})\n`);
});
