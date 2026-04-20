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

  let world = { width: 1600, height: 900 };
  let snapshot = null;
  let lastStatus = 'waiting';
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

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
    if (msg?.world) world = msg.world;
    if (msg?.snapshot) snapshot = msg.snapshot;
  });

  socket.on('game:tick', (snap) => {
    snapshot = snap;
  });

  socket.on('room:state', (room) => {
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
    qrStatusLeft.textContent = leftOn ? 'Conectado' : 'Esperando jugador';
    qrStatusRight.textContent = rightOn ? 'Conectado' : 'Esperando jugador';

    const showWaiting = room.status === 'waiting' || room.status === 'paused';
    if (showWaiting) {
      overlay.classList.remove('hidden');
      waitingScreen.style.display = 'grid';
      winScreen.style.display = 'none';
      hintText.textContent = room.status === 'paused'
        ? 'Reconectando jugador...'
        : 'Primero a 7 gana';
    } else if (room.status === 'win') {
      overlay.classList.remove('hidden');
      waitingScreen.style.display = 'none';
    } else {
      overlay.classList.add('hidden');
    }
  }

  function showWinScreen(winner) {
    winScreen.style.display = 'grid';
    winTitle.innerHTML = winner === 'left'
      ? '<span class="glow-cyan">IZQUIERDA</span>'
      : '<span class="glow-magenta">DERECHA</span>';
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

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    drawPlayfieldFrame();
    drawCenterLine();
    drawScore(snapshot?.score);

    if (snapshot) {
      updateTrail(snapshot.ball);
      drawTrail();
      drawPaddle('left', snapshot.paddles.left.y);
      drawPaddle('right', snapshot.paddles.right.y);
      drawBall(snapshot.ball);
    }

    updateParticles(dt);
    drawParticles();

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

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(String(score.left), world.width / 2 - 220, 150);

    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ff2bd6';
    ctx.fillText(String(score.right), world.width / 2 + 220, 150);
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
