'use strict';

const COURT_WIDTH_MIN = 1200;
const COURT_WIDTH_MAX = 3600;
const COURT_WIDTH_STEP = 50;
const COURT_WIDTH_DEFAULT = 1600;

function clampCourtWidth(w) {
  const r = Math.round(w / COURT_WIDTH_STEP) * COURT_WIDTH_STEP;
  return Math.max(COURT_WIDTH_MIN, Math.min(COURT_WIDTH_MAX, r));
}

let courtWidth = COURT_WIDTH_DEFAULT;
const envW = Number(process.env.COURT_WIDTH);
if (Number.isFinite(envW)) {
  courtWidth = clampCourtWidth(envW);
}

const WORLD = {
  get width() {
    return courtWidth;
  },
  height: 900,
  paddle: {
    width: 22,
    height: 170,
    margin: 60,
    maxSpeed: 2400,
  },
  ball: {
    size: 22,
    startSpeed: 780,
    maxSpeed: 1600,
    speedUp: 1.06,
  },
  winScore: 7,
  tickHz: 60,
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeStateAfterCourtResize(state) {
  const r = WORLD.ball.size / 2;
  const halfH = WORLD.paddle.height / 2;
  state.ball.x = clamp(state.ball.x, r, WORLD.width - r);
  state.ball.y = clamp(state.ball.y, r, WORLD.height - r);
  for (const side of ['left', 'right']) {
    const p = state.paddles[side];
    p.y = clamp(p.y, halfH, WORLD.height - halfH);
    p.targetY = clamp(p.targetY, halfH, WORLD.height - halfH);
  }
}

function setCourtWidth(state, w) {
  const nw = clampCourtWidth(w);
  if (nw === courtWidth) return nw;
  courtWidth = nw;
  normalizeStateAfterCourtResize(state);
  return nw;
}

function createInitialState() {
  return {
    status: 'waiting',
    slots: { left: false, right: false },
    score: { left: 0, right: 0 },
    paddles: {
      left: { y: WORLD.height / 2, targetY: WORLD.height / 2 },
      right: { y: WORLD.height / 2, targetY: WORLD.height / 2 },
    },
    ball: {
      x: WORLD.width / 2,
      y: WORLD.height / 2,
      vx: 0,
      vy: 0,
    },
    winner: null,
    countdown: 0,
    _countdownMs: 0,
    _lastCountdownSec: -1,
    _goalPauseMs: 0,
  };
}

function resetBall(state, towardSide) {
  const dir = towardSide === 'left' ? -1 : 1;
  const angle = (Math.random() * 0.6 - 0.3);
  const speed = WORLD.ball.startSpeed;
  state.ball.x = WORLD.width / 2;
  state.ball.y = WORLD.height / 2;
  state.ball.vx = Math.cos(angle) * speed * dir;
  state.ball.vy = Math.sin(angle) * speed;
}

function startCountdown(state, ms = 3000) {
  state.status = 'countdown';
  state._countdownMs = ms;
  state._lastCountdownSec = -1;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.x = WORLD.width / 2;
  state.ball.y = WORLD.height / 2;
}

function setSlot(state, side, present) {
  state.slots[side] = present;
  if (!present) {
    if (state.status === 'playing' || state.status === 'countdown') {
      state.status = 'paused';
    }
  } else if (state.status === 'paused' && state.slots.left && state.slots.right) {
    startCountdown(state, 2000);
  }
}

function startMatch(state) {
  state.score.left = 0;
  state.score.right = 0;
  state.winner = null;
  if (state.slots.left && state.slots.right) {
    startCountdown(state, 3000);
  } else {
    state.status = 'waiting';
  }
}

function setPaddleTarget(state, side, yNorm) {
  const clamped = Math.max(0, Math.min(1, yNorm));
  const minY = WORLD.paddle.height / 2;
  const maxY = WORLD.height - WORLD.paddle.height / 2;
  state.paddles[side].targetY = minY + clamped * (maxY - minY);
}

function stepPaddles(state, dt) {
  for (const side of ['left', 'right']) {
    const p = state.paddles[side];
    const delta = p.targetY - p.y;
    const maxStep = WORLD.paddle.maxSpeed * dt;
    if (Math.abs(delta) <= maxStep) {
      p.y = p.targetY;
    } else {
      p.y += Math.sign(delta) * maxStep;
    }
  }
}

function stepBall(state, dt, events) {
  const b = state.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  const r = WORLD.ball.size / 2;

  if (b.y - r < 0) {
    b.y = r;
    b.vy = Math.abs(b.vy);
    events.push({ type: 'bump', wall: 'top', x: b.x, y: b.y });
  } else if (b.y + r > WORLD.height) {
    b.y = WORLD.height - r;
    b.vy = -Math.abs(b.vy);
    events.push({ type: 'bump', wall: 'bottom', x: b.x, y: b.y });
  }

  const leftX = WORLD.paddle.margin + WORLD.paddle.width / 2;
  const rightX = WORLD.width - WORLD.paddle.margin - WORLD.paddle.width / 2;
  const halfW = WORLD.paddle.width / 2;
  const halfH = WORLD.paddle.height / 2;

  if (b.vx < 0 && b.x - r <= leftX + halfW && b.x + r >= leftX - halfW) {
    const p = state.paddles.left;
    if (b.y >= p.y - halfH && b.y <= p.y + halfH) {
      b.x = leftX + halfW + r;
      bouncePaddle(b, p, 1, events, 'left');
    }
  } else if (b.vx > 0 && b.x + r >= rightX - halfW && b.x - r <= rightX + halfW) {
    const p = state.paddles.right;
    if (b.y >= p.y - halfH && b.y <= p.y + halfH) {
      b.x = rightX - halfW - r;
      bouncePaddle(b, p, -1, events, 'right');
    }
  }

  if (b.x < -r * 2) {
    onGoal(state, 'right', events);
  } else if (b.x > WORLD.width + r * 2) {
    onGoal(state, 'left', events);
  }
}

function bouncePaddle(ball, paddle, dirSign, events, side) {
  const halfH = WORLD.paddle.height / 2;
  const offset = (ball.y - paddle.y) / halfH;
  const speed = Math.hypot(ball.vx, ball.vy) * WORLD.ball.speedUp;
  const cappedSpeed = Math.min(speed, WORLD.ball.maxSpeed);
  const maxAngle = (Math.PI / 180) * 55;
  const angle = offset * maxAngle;
  ball.vx = Math.cos(angle) * cappedSpeed * dirSign;
  ball.vy = Math.sin(angle) * cappedSpeed;
  events.push({ type: 'bump', side, x: ball.x, y: ball.y, offset });
}

function onGoal(state, scorer, events) {
  state.score[scorer] += 1;
  events.push({ type: 'goal', scorer, score: { ...state.score } });
  if (state.score[scorer] >= WORLD.winScore) {
    state.winner = scorer;
    state.status = 'win';
    state.ball.vx = 0;
    state.ball.vy = 0;
    state._winResetMs = 6000;
    events.push({ type: 'win', winner: scorer });
  } else {
    state.status = 'goal';
    state._goalPauseMs = 900;
    state.ball.vx = 0;
    state.ball.vy = 0;
    state._nextServeToward = scorer === 'left' ? 'right' : 'left';
  }
}

function tick(state, dt) {
  const events = [];

  if (state.status === 'playing') {
    stepPaddles(state, dt);
    stepBall(state, dt, events);
  } else if (state.status === 'countdown') {
    stepPaddles(state, dt);
    state._countdownMs -= dt * 1000;
    const sec = Math.ceil(state._countdownMs / 1000);
    state.countdown = Math.max(0, sec);
    if (sec !== state._lastCountdownSec && sec >= 0) {
      state._lastCountdownSec = sec;
      if (sec > 0) events.push({ type: 'countdown', value: sec });
      else events.push({ type: 'countdown', value: 'GO' });
    }
    if (state._countdownMs <= 0) {
      state.status = 'playing';
      const servingTo = state._nextServeToward || (Math.random() < 0.5 ? 'left' : 'right');
      resetBall(state, servingTo);
      state._nextServeToward = null;
    }
  } else if (state.status === 'goal') {
    stepPaddles(state, dt);
    state._goalPauseMs -= dt * 1000;
    if (state._goalPauseMs <= 0) {
      startCountdown(state, 2000);
    }
  } else if (state.status === 'win') {
    stepPaddles(state, dt);
    if (typeof state._winResetMs === 'number' && state._winResetMs > 0) {
      state._winResetMs -= dt * 1000;
      if (state._winResetMs <= 0) {
        state._winResetMs = 0;
        state.winner = null;
        state.score.left = 0;
        state.score.right = 0;
        if (state.slots.left && state.slots.right) {
          startCountdown(state, 3000);
        } else {
          state.status = 'waiting';
        }
      }
    }
  } else if (state.status === 'paused' || state.status === 'waiting') {
    stepPaddles(state, dt);
  }

  return events;
}

function getSnapshot(state) {
  return {
    status: state.status,
    slots: { ...state.slots },
    score: { ...state.score },
    paddles: {
      left: { y: state.paddles.left.y },
      right: { y: state.paddles.right.y },
    },
    ball: { x: state.ball.x, y: state.ball.y, vx: state.ball.vx, vy: state.ball.vy },
    countdown: state.countdown,
    winner: state.winner,
    world: { width: WORLD.width, height: WORLD.height },
  };
}

module.exports = {
  WORLD,
  COURT_WIDTH_MIN,
  COURT_WIDTH_MAX,
  COURT_WIDTH_STEP,
  COURT_WIDTH_DEFAULT,
  clampCourtWidth,
  setCourtWidth,
  createInitialState,
  setSlot,
  setPaddleTarget,
  startMatch,
  startCountdown,
  tick,
  getSnapshot,
};
