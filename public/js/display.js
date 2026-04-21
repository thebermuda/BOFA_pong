(() => {
  'use strict';

  const socket = io({ transports: ['websocket', 'polling'] });
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: true });

  const overlay = document.getElementById('overlay');
  const waitingScreen = document.getElementById('waitingScreen');
  const winScreen = document.getElementById('winScreen');
  const winTitle = document.getElementById('winTitle');
  const countdownEl = document.getElementById('countdown');
  const hintText = document.getElementById('hintText');

  const qrImgLeft = document.getElementById('qrImgLeft');
  const qrImgRight = document.getElementById('qrImgRight');
  const qrWrapLeft = document.getElementById('qrWrapLeft');
  const qrWrapRight = document.getElementById('qrWrapRight');
  const qrCardLeft = document.getElementById('qrCardLeft');
  const qrCardRight = document.getElementById('qrCardRight');
  const qrStatusLeft = document.getElementById('qrStatusLeft');
  const qrStatusRight = document.getElementById('qrStatusRight');

  const gameViewport = document.getElementById('gameViewport');
  const calibTrigger = document.getElementById('calibTrigger');
  const calibPanel = document.getElementById('calibPanel');
  const projWidth = document.getElementById('projWidth');
  const projHeight = document.getElementById('projHeight');
  const projPanX = document.getElementById('projPanX');
  const projPanY = document.getElementById('projPanY');
  const projWidthVal = document.getElementById('projWidthVal');
  const projHeightVal = document.getElementById('projHeightVal');
  const projPanXVal = document.getElementById('projPanXVal');
  const projPanYVal = document.getElementById('projPanYVal');
  const calibReset = document.getElementById('calibReset');
  const calibClose = document.getElementById('calibClose');
  const calibDebugCourt = document.getElementById('calibDebugCourt');
  const courtWidthInput = document.getElementById('courtWidth');
  const courtWidthVal = document.getElementById('courtWidthVal');

  const PROJ_STORAGE_KEY = 'bofaPong.projection';
  const COURT_STORAGE_KEY = 'bofaPong.courtWidth';
  const COURT_MIN = 1200;
  const COURT_MAX = 3600;
  let courtSliderDragging = false;

  let debugCourtPreview = false;

  let world = { width: 1600, height: 900 };
  let snapshot = null;
  let lastStatus = 'waiting';
  let lastRoomState = { status: 'waiting', slots: { left: false, right: false } };
  let lastCountdownValue = -1;

  const trail = [];
  const TRAIL_MAX = 16;
  const particles = [];

  const bgLogo = new Image();
  let bgLogoReady = false;
  bgLogo.onload = () => { bgLogoReady = true; };
  bgLogo.src = '/assets/logo-bermuda.png';

  const dprCap = 2;
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const r = gameViewport.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function loadProjection() {
    try {
      const raw = localStorage.getItem(PROJ_STORAGE_KEY);
      if (!raw) return { wPct: 100, hPct: 100, panX: 0, panY: 0 };
      const j = JSON.parse(raw);
      return {
        wPct: clamp(Math.round((j.w != null ? j.w : 1) * 100), 40, 100),
        hPct: clamp(Math.round((j.h != null ? j.h : 1) * 100), 40, 100),
        panX: clamp(Math.round(j.ox != null ? j.ox : 0), -30, 30),
        panY: clamp(Math.round(j.oy != null ? j.oy : 0), -30, 30),
      };
    } catch {
      return { wPct: 100, hPct: 100, panX: 0, panY: 0 };
    }
  }

  function formatPan(n) {
    return (n > 0 ? '+' : '') + String(n);
  }

  function saveProjection(wPct, hPct, panX, panY) {
    localStorage.setItem(PROJ_STORAGE_KEY, JSON.stringify({
      w: wPct / 100,
      h: hPct / 100,
      ox: panX,
      oy: panY,
    }));
  }

  function commitProjectionFromSliders() {
    const wPct = clamp(Number(projWidth.value), 40, 100);
    const hPct = clamp(Number(projHeight.value), 40, 100);
    const panX = clamp(Number(projPanX.value), -30, 30);
    const panY = clamp(Number(projPanY.value), -30, 30);
    projWidth.value = wPct;
    projHeight.value = hPct;
    projPanX.value = panX;
    projPanY.value = panY;
    gameViewport.style.width = `calc(100vw * ${wPct / 100})`;
    gameViewport.style.height = `calc(100vh * ${hPct / 100})`;
    gameViewport.style.transform = `translate(${panX}vw, ${panY}vh)`;
    projWidthVal.textContent = String(wPct);
    projHeightVal.textContent = String(hPct);
    projPanXVal.textContent = formatPan(panX);
    projPanYVal.textContent = formatPan(panY);
    saveProjection(wPct, hPct, panX, panY);
    resizeCanvas();
  }

  function isCalibOpen() {
    return !calibPanel.classList.contains('hidden');
  }

  function setCalibOpen(open) {
    calibPanel.classList.toggle('hidden', !open);
    calibPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function toggleCalib() {
    setCalibOpen(!isCalibOpen());
  }

  const initProj = loadProjection();
  projWidth.value = initProj.wPct;
  projHeight.value = initProj.hPct;
  projPanX.value = initProj.panX;
  projPanY.value = initProj.panY;
  commitProjectionFromSliders();

  window.addEventListener('resize', resizeCanvas);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => resizeCanvas()).observe(gameViewport);
  }

  calibTrigger.addEventListener('click', (e) => {
    e.preventDefault();
    toggleCalib();
  });
  calibClose.addEventListener('click', () => setCalibOpen(false));
  calibReset.addEventListener('click', () => {
    projWidth.value = '100';
    projHeight.value = '100';
    projPanX.value = '0';
    projPanY.value = '0';
    commitProjectionFromSliders();
  });
  projWidth.addEventListener('input', () => commitProjectionFromSliders());
  projHeight.addEventListener('input', () => commitProjectionFromSliders());
  projPanX.addEventListener('input', () => commitProjectionFromSliders());
  projPanY.addEventListener('input', () => commitProjectionFromSliders());

  function loadCourtWidth() {
    try {
      const raw = localStorage.getItem(COURT_STORAGE_KEY);
      if (raw == null) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return clamp(Math.round(n / 50) * 50, COURT_MIN, COURT_MAX);
    } catch {
      return null;
    }
  }

  function setCourtSliderUI(w) {
    const nw = clamp(Math.round(w / 50) * 50, COURT_MIN, COURT_MAX);
    courtWidthInput.value = String(nw);
    courtWidthVal.textContent = String(nw);
  }

  function commitCourtWidth() {
    const nw = clamp(Math.round(Number(courtWidthInput.value) / 50) * 50, COURT_MIN, COURT_MAX);
    courtWidthInput.value = String(nw);
    courtWidthVal.textContent = String(nw);
    localStorage.setItem(COURT_STORAGE_KEY, String(nw));
    socket.emit('display:setCourtWidth', { width: nw });
  }

  courtWidthInput.addEventListener('pointerdown', () => { courtSliderDragging = true; });
  courtWidthInput.addEventListener('pointerup', () => { courtSliderDragging = false; });
  courtWidthInput.addEventListener('pointercancel', () => { courtSliderDragging = false; });
  courtWidthInput.addEventListener('input', () => commitCourtWidth());

  function fakeCourtSnapshot() {
    const w = world.width;
    const h = world.height;
    return {
      score: { left: 0, right: 0 },
      ball: { x: w / 2, y: h / 2, vx: 0, vy: 0 },
      paddles: { left: { y: h / 2 }, right: { y: h / 2 } },
    };
  }

  function syncDebugCourtButton() {
    calibDebugCourt.setAttribute('aria-pressed', debugCourtPreview ? 'true' : 'false');
    calibDebugCourt.textContent = debugCourtPreview
      ? 'Debug: preview on (tap to turn off)'
      : 'Debug: preview court';
  }

  calibDebugCourt.addEventListener('click', () => {
    debugCourtPreview = !debugCourtPreview;
    syncDebugCourtButton();
    refreshOverlayAfterDebugToggle();
  });
  syncDebugCourtButton();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      toggleCalib();
    } else if (e.key === 'Escape' && isCalibOpen()) {
      e.preventDefault();
      setCalibOpen(false);
    }
  });

  async function loadQR(side, img) {
    try {
      const res = await fetch('/qr?side=' + side);
      const data = await res.json();
      img.src = data.dataUrl;
    } catch (e) {
      console.error('QR load failed', e);
    }
  }
  loadQR('left', qrImgLeft);
  loadQR('right', qrImgRight);

  socket.on('connect', () => {
    socket.emit('display:join');
  });

  socket.on('display:hello', (msg) => {
    if (msg?.snapshot) snapshot = msg.snapshot;
    if (msg?.world) {
      world = msg.world;
      const saved = loadCourtWidth();
      if (saved != null && saved !== msg.world.width) {
        setCourtSliderUI(saved);
        socket.emit('display:setCourtWidth', { width: saved });
      } else {
        setCourtSliderUI(msg.world.width);
      }
    }
  });

  socket.on('game:tick', (snap) => {
    snapshot = snap;
    if (snap.world) {
      world = { width: snap.world.width, height: snap.world.height };
      if (!courtSliderDragging) {
        courtWidthInput.value = String(world.width);
        courtWidthVal.textContent = String(world.width);
      }
    }
  });

  socket.on('room:state', (room) => {
    lastRoomState = room;
    updateWaitingUI(room);
    if (room.status === 'win' && room.winner) {
      showWinScreen(room.winner);
    } else {
      winScreen.style.display = 'none';
    }
    lastStatus = room.status;
  });

  socket.on('game:event', (events) => {
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      if (ev.type === 'bump') {
        sfxBump();
        if (ev.side) spawnParticles(ev.x, ev.y, ev.side === 'left' ? '#00f0ff' : '#ff2bd6', 18);
      } else if (ev.type === 'goal') {
        sfxGoal();
        spawnParticles(world.width / 2, world.height / 2, '#ffffff', 60);
      } else if (ev.type === 'countdown') {
        if (ev.value === 'GO') {
          showCountdownText('GO');
          sfxGo();
        } else if (typeof ev.value === 'number') {
          showCountdownText(String(ev.value));
          sfxBeep(440 + ev.value * 80);
        }
      } else if (ev.type === 'win') {
        sfxWin();
      }
    }
  });

  function updateWaitingUI(room) {
    const leftOn = !!room.slots?.left;
    const rightOn = !!room.slots?.right;
    qrCardLeft.classList.toggle('connected', leftOn);
    qrWrapLeft.classList.toggle('connected', leftOn);
    qrCardRight.classList.toggle('connected', rightOn);
    qrWrapRight.classList.toggle('connected', rightOn);
    qrStatusLeft.textContent = leftOn ? 'Connected' : 'Waiting for player';
    qrStatusRight.textContent = rightOn ? 'Connected' : 'Waiting for player';

    if (debugCourtPreview && (room.status === 'waiting' || room.status === 'paused')) {
      overlay.classList.add('hidden');
      waitingScreen.style.display = 'none';
      winScreen.style.display = 'none';
      return;
    }

    const showWaiting = room.status === 'waiting' || room.status === 'paused';
    if (showWaiting) {
      overlay.classList.remove('hidden');
      waitingScreen.style.display = 'grid';
      winScreen.style.display = 'none';
      hintText.textContent = room.status === 'paused'
        ? 'Reconnecting player...'
        : 'First to 7 wins';
    } else if (room.status === 'win') {
      overlay.classList.remove('hidden');
      waitingScreen.style.display = 'none';
    } else {
      overlay.classList.add('hidden');
    }
  }

  function refreshOverlayAfterDebugToggle() {
    updateWaitingUI(lastRoomState);
    if (lastRoomState.status === 'win' && lastRoomState.winner) {
      showWinScreen(lastRoomState.winner);
    }
  }

  function showWinScreen(winner) {
    winScreen.style.display = 'grid';
    winTitle.innerHTML = winner === 'left'
      ? '<span class="glow-cyan">LEFT</span>'
      : '<span class="glow-magenta">RIGHT</span>';
  }

  let countdownTimer = null;
  function showCountdownText(text) {
    countdownEl.textContent = text;
    countdownEl.classList.remove('pulse');
    void countdownEl.offsetWidth;
    countdownEl.classList.add('pulse');
    clearTimeout(countdownTimer);
    countdownTimer = setTimeout(() => {
      countdownEl.classList.remove('pulse');
    }, 850);
  }

  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 500;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6 + Math.random() * 0.4,
        age: 0,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    }
    return audioCtx;
  }
  function beep({ freq = 440, dur = 0.08, type = 'square', gain = 0.06, slideTo = null } = {}) {
    const ac = ensureAudio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur + 0.02);
  }
  function sfxBump() { beep({ freq: 520, dur: 0.05, type: 'square', gain: 0.05 }); }
  function sfxGoal() { beep({ freq: 220, dur: 0.35, type: 'sawtooth', gain: 0.09, slideTo: 80 }); }
  function sfxBeep(f) { beep({ freq: f, dur: 0.12, type: 'square', gain: 0.07 }); }
  function sfxGo()   { beep({ freq: 880, dur: 0.25, type: 'square', gain: 0.09 }); }
  function sfxWin() {
    beep({ freq: 523, dur: 0.12 });
    setTimeout(() => beep({ freq: 659, dur: 0.12 }), 140);
    setTimeout(() => beep({ freq: 784, dur: 0.12 }), 280);
    setTimeout(() => beep({ freq: 1046, dur: 0.3 }), 420);
  }
  window.addEventListener('pointerdown', () => { ensureAudio()?.resume?.(); }, { once: true });
  window.addEventListener('keydown', () => { ensureAudio()?.resume?.(); }, { once: true });

  let lastT = performance.now();
  function render(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const scale = Math.min(viewW / world.width, viewH / world.height);
    const ox = (viewW - world.width * scale) / 2;
    const oy = (viewH - world.height * scale) / 2;

    ctx.clearRect(0, 0, viewW, viewH);

    drawBackground(viewW, viewH, now);

    const st = snapshot?.status;
    const inRealMatch = st === 'countdown' || st === 'playing' || st === 'goal';
    const useDebugFake = debugCourtPreview && !inRealMatch && st !== 'win';
    const showMatchLayer = inRealMatch || useDebugFake;
    const snapForDraw = useDebugFake ? fakeCourtSnapshot() : snapshot;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    if (showMatchLayer) {
      drawPlayfieldFrame();
      drawCenterLine();
      drawScore(snapForDraw?.score);

      if (snapForDraw) {
        if (!useDebugFake) {
          updateTrail(snapForDraw.ball);
          drawTrail();
        } else {
          trail.length = 0;
        }
        drawPaddle('left', snapForDraw.paddles.left.y);
        drawPaddle('right', snapForDraw.paddles.right.y);
        drawBall(snapForDraw.ball);
      }

      if (useDebugFake) {
        particles.length = 0;
      } else {
        updateParticles(dt);
        drawParticles();
      }
    } else {
      trail.length = 0;
      particles.length = 0;
    }

    ctx.restore();

    requestAnimationFrame(render);
  }
  requestAnimationFrame((t) => { lastT = t; render(t); });

  function drawBackground(w, h, now) {
    const horizon = h * 0.56;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(5,2,13,1)');
    grad.addColorStop(0.55, 'rgba(10,4,24,1)');
    grad.addColorStop(1, 'rgba(5,2,13,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#ff2bd6';
    ctx.lineWidth = 1;
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 8;
    const scroll = ((now / 40) % 60);
    for (let y = horizon; y < h + 60; y += 60) {
      const t = (y - horizon + scroll) / (h - horizon);
      const yy = horizon + Math.pow(t, 1.6) * (h - horizon);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
    const cx = w / 2;
    for (let i = -14; i <= 14; i++) {
      const vx = cx + i * (w * 0.06);
      ctx.beginPath();
      ctx.moveTo(cx, horizon);
      ctx.lineTo(vx, h);
      ctx.stroke();
    }
    ctx.restore();

    if (bgLogoReady) {
      const CYCLE_MS = 22000;
      const t = (now % CYCLE_MS) / CYCLE_MS;

      const ease = t * t;

      const minSize = Math.min(w, h) * 0.08;
      const maxSize = Math.min(w, h) * 0.78;
      const size = minSize + (maxSize - minSize) * ease;

      const cx = w / 2;
      const cy = horizon - size * 0.06 + ease * (h - horizon) * 0.35;

      let alpha = 1;
      if (t < 0.08) alpha = t / 0.08;
      else if (t > 0.88) alpha = Math.max(0, (1 - t) / 0.12);

      const glowAlpha = 0.55 * alpha;
      const coreAlpha = 0.92 * alpha;

      const blurAmount = 18 + ease * 30;

      ctx.save();
      ctx.globalAlpha = glowAlpha;
      ctx.filter = `blur(${blurAmount}px) saturate(1.3)`;
      ctx.drawImage(bgLogo, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = coreAlpha;
      ctx.shadowColor = 'rgba(255,43,214,0.6)';
      ctx.shadowBlur = 30 + ease * 40;
      ctx.drawImage(bgLogo, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
    }
  }

  function drawPlayfieldFrame() {
    ctx.save();
    ctx.strokeStyle = 'rgba(244,242,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, world.width, world.height);
    ctx.restore();
  }

  function drawCenterLine() {
    ctx.save();
    ctx.strokeStyle = 'rgba(244,242,255,0.45)';
    ctx.shadowColor = 'rgba(244,242,255,0.5)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 22]);
    ctx.beginPath();
    ctx.moveTo(world.width / 2, 30);
    ctx.lineTo(world.width / 2, world.height - 30);
    ctx.stroke();
    ctx.restore();
  }

  function drawScore(score) {
    if (!score) return;
    ctx.save();
    ctx.font = '900 180px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const scoreOff = Math.min(300, Math.max(160, world.width * 0.14));

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(String(score.left), world.width / 2 - scoreOff, 150);

    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ff2bd6';
    ctx.fillText(String(score.right), world.width / 2 + scoreOff, 150);
    ctx.restore();
  }

  function drawPaddle(side, y) {
    const w = 22;
    const h = 170;
    const margin = 60;
    const x = side === 'left' ? margin : (world.width - margin - w);
    const color = side === 'left' ? '#00f0ff' : '#ff2bd6';

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 40;
    ctx.fillStyle = color;
    roundRect(ctx, x, y - h / 2, w, h, 8);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + 4, y - h / 2 + 6, w - 8, h - 12, 4);
    ctx.fill();
    ctx.restore();
  }

  function updateTrail(ball) {
    trail.push({ x: ball.x, y: ball.y });
    while (trail.length > TRAIL_MAX) trail.shift();
  }

  function drawTrail() {
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const a = (i + 1) / trail.length;
      const r = 11 * a;
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 25 * a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBall(ball) {
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }
})();
