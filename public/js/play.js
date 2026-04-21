(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  let side = params.get('side');
  if (side !== 'left' && side !== 'right') side = 'left';

  const app = document.getElementById('app');
  const sideTag = document.getElementById('sideTag');
  const pad = document.getElementById('pad');
  const padPaddle = document.getElementById('padPaddle');
  const padHint = document.getElementById('padHint');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const scoreL = document.getElementById('scoreL');
  const scoreR = document.getElementById('scoreR');
  const errorOverlay = document.getElementById('errorOverlay');
  const errorTitle = document.getElementById('errorTitle');
  const errorBody = document.getElementById('errorBody');

  app.classList.add('side-' + side);
  sideTag.textContent = side === 'left' ? 'LEFT' : 'RIGHT';

  const socket = io({ transports: ['websocket', 'polling'] });

  let assigned = false;
  let rejected = false;
  let lastY = 0.5;
  let pendingY = 0.5;
  let rafQueued = false;

  function setStatus(kind, text) {
    statusDot.classList.remove('connected', 'waiting', 'error');
    statusDot.classList.add(kind);
    statusText.textContent = text;
  }

  function sendY() {
    rafQueued = false;
    if (pendingY !== lastY) {
      lastY = pendingY;
      socket.emit('player:input', { y: lastY });
    }
  }

  function queueSend() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(sendY);
  }

  function yFromClientY(clientY) {
    const r = pad.getBoundingClientRect();
    const raw = (clientY - r.top) / r.height;
    return Math.max(0, Math.min(1, raw));
  }

  function updatePaddleVisual(y) {
    const r = pad.getBoundingClientRect();
    const paddleHeightFrac = 90 / r.height;
    const minY = paddleHeightFrac / 2;
    const maxY = 1 - paddleHeightFrac / 2;
    const clamped = Math.max(minY, Math.min(maxY, y));
    padPaddle.style.top = (clamped * 100) + '%';
  }

  let activePointer = null;

  function onPointerDown(e) {
    if (!assigned) return;
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    pad.classList.add('active');
    padHint.style.display = 'none';
    const y = yFromClientY(e.clientY);
    pendingY = y;
    updatePaddleVisual(y);
    queueSend();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (activePointer !== e.pointerId) return;
    const y = yFromClientY(e.clientY);
    pendingY = y;
    updatePaddleVisual(y);
    queueSend();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    try { pad.releasePointerCapture(e.pointerId); } catch (err) {}
    pad.classList.remove('active');
  }

  pad.addEventListener('pointerdown', onPointerDown);
  pad.addEventListener('pointermove', onPointerMove);
  pad.addEventListener('pointerup', onPointerUp);
  pad.addEventListener('pointercancel', onPointerUp);
  pad.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  pad.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  updatePaddleVisual(0.5);
  window.addEventListener('resize', () => updatePaddleVisual(lastY));

  socket.on('connect', () => {
    setStatus('waiting', 'Connected · claiming side');
    socket.emit('player:claim', { side });
  });

  socket.on('disconnect', () => {
    assigned = false;
    setStatus('error', 'Disconnected, retrying...');
  });

  socket.on('player:assigned', (msg) => {
    assigned = true;
    rejected = false;
    errorOverlay.classList.add('hidden');
    if (msg?.bothConnected) {
      setStatus('connected', 'In match');
    } else {
      setStatus('waiting', 'Waiting for opponent...');
    }
  });

  socket.on('player:rejected', (msg) => {
    assigned = false;
    rejected = true;
    errorOverlay.classList.remove('hidden');
    if (msg?.reason === 'occupied') {
      errorTitle.textContent = 'Side taken';
      errorBody.textContent = 'This side already has a player. Scan the other QR code.';
    } else {
      errorTitle.textContent = 'Error';
      errorBody.textContent = 'Could not assign this side.';
    }
    setStatus('error', 'Rejected');
  });

  socket.on('room:state', (room) => {
    if (room.score) {
      scoreL.textContent = room.score.left;
      scoreR.textContent = room.score.right;
    }
    if (assigned && !rejected) {
      const both = room.slots?.left && room.slots?.right;
      if (room.status === 'win') {
        setStatus('waiting', 'Match over');
      } else if (room.status === 'paused') {
        setStatus('waiting', 'Paused · waiting for opponent');
      } else if (room.status === 'countdown') {
        setStatus('connected', 'Get ready...');
      } else if (room.status === 'playing' || room.status === 'goal') {
        setStatus('connected', 'In match');
      } else if (both) {
        setStatus('connected', 'In match');
      } else {
        setStatus('waiting', 'Waiting for opponent...');
      }
    }
  });

  socket.on('game:event', (events) => {
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      if (ev.type === 'bump' && ev.side === side) {
        if (navigator.vibrate) navigator.vibrate(12);
      } else if (ev.type === 'goal') {
        if (navigator.vibrate) navigator.vibrate(ev.scorer === side ? [20, 40, 20] : 30);
      } else if (ev.type === 'win') {
        if (navigator.vibrate) navigator.vibrate(ev.winner === side ? [40, 60, 40, 60, 120] : 80);
      }
    }
  });
})();
