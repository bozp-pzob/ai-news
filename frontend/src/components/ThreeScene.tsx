import React, { useRef, useEffect } from 'react';

// ============================================================================
// Digital Gardener — Growing Garden (Canvas 2D)
// ============================================================================
// Smooth 60 fps plant growth with floating pollen, golden-hour sky,
// and warm sunlight. Zero geometry allocations in the render loop.
// ============================================================================

interface ThreeSceneProps {
  mouseX: number;
  mouseY: number;
}

// ---- Sky / atmosphere ----
const SKY_TOP: [number, number, number] = [220, 230, 240];     // soft blue-grey
const SKY_MID: [number, number, number] = [245, 240, 232];     // warm cream
const SKY_BOT: [number, number, number] = [250, 245, 235];     // warm off-white

// ---- Ground ----
const GROUND_DARK = '#4a3428';
const GROUND_MID = '#6b5040';
const GROUND_LIGHT = '#957858';
const GROUND_TOP = '#a89070';

// ---- Plant palette ----
const STEM_BROWN: [number, number, number] = [107, 66, 38];
const STEM_GREEN_DARK: [number, number, number] = [22, 101, 52];
const STEM_GREEN_MED: [number, number, number] = [45, 90, 39];
const LEAF_PALETTE = ['#4ade80', '#22c55e', '#34d399', '#16a34a', '#86efac', '#059669'];

// Flower color palettes
const FLOWER_PALETTES: { petal: string; center: string }[] = [
  { petal: '#f59e0b', center: '#fbbf24' },
  { petal: '#f472b6', center: '#fda4af' },
  { petal: '#c084fc', center: '#e9d5ff' },
  { petal: '#fb923c', center: '#fdba74' },
  { petal: '#f87171', center: '#fca5a5' },
  { petal: '#60a5fa', center: '#93c5fd' },
  { petal: '#fbbf24', center: '#fef08a' },
  { petal: '#e879f9', center: '#f0abfc' },
];

// ---- Pollen particle colors ----
const POLLEN_COLORS = [
  'rgba(253,230,138,',  // warm yellow
  'rgba(254,215,170,',  // soft peach
  'rgba(255,255,255,',  // white
  'rgba(187,247,208,',  // mint
  'rgba(254,202,202,',  // blush
];

// ---- Navbar offset ----
const NAVBAR_HEIGHT = 64;

// ---- Utils ----
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
const lerpRGB = (a: [number, number, number], b: [number, number, number], t: number): string =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

// ---- Constants ----
const PATH_PTS = 60;
const MAX_PLANTS = 14;
const SPAWN_MIN = 1.5;
const SPAWN_MAX = 3.0;
const INITIAL_COUNT = 6;
const MIN_SPACING = 0.06;
const MAX_POLLEN = 35;

// ---- Plant configs ----
interface Cfg {
  kind: string;
  hFrac: number;
  baseW: number;
  tipW: number;
  nLeaves: number;
  leafW: number;
  leafH: number;
  growDur: number;
  matureDur: number;
  fadeDur: number;
  swayAmp: number;
  swayFreq: number;
  hasFlower: boolean;
  flowerPetals: number;
  flowerPetalW: number;
  flowerPetalH: number;
  flowerCenterR: number;
  flowerPetalColor: string;
  flowerCenterColor: string;
  depth: number; // 0=far, 1=near
}

function mkCfg(): Cfg {
  const r = Math.random();
  const fp = FLOWER_PALETTES[Math.floor(Math.random() * FLOWER_PALETTES.length)];
  const depth = 0.3 + Math.random() * 0.7;

  if (r < 0.40) {
    return {
      kind: 'grass', depth,
      hFrac: 0.45 + Math.random() * 0.35,
      baseW: 3.5 + Math.random() * 1.5,
      tipW: 0.6 + Math.random() * 0.4,
      nLeaves: 3 + Math.floor(Math.random() * 3),
      leafW: 8 + Math.random() * 6,
      leafH: 28 + Math.random() * 16,
      growDur: 5 + Math.random() * 3,
      matureDur: 14 + Math.random() * 10,
      fadeDur: 3.5,
      swayAmp: 8 + Math.random() * 6,
      swayFreq: 0.6 + Math.random() * 0.4,
      hasFlower: false,
      flowerPetals: 0, flowerPetalW: 0, flowerPetalH: 0,
      flowerCenterR: 0, flowerPetalColor: fp.petal, flowerCenterColor: fp.center,
    };
  }
  if (r < 0.68) {
    return {
      kind: 'leafy', depth,
      hFrac: 0.28 + Math.random() * 0.24,
      baseW: 4.5 + Math.random() * 2,
      tipW: 1.2 + Math.random() * 0.5,
      nLeaves: 4 + Math.floor(Math.random() * 4),
      leafW: 16 + Math.random() * 12,
      leafH: 22 + Math.random() * 14,
      growDur: 6 + Math.random() * 3,
      matureDur: 16 + Math.random() * 10,
      fadeDur: 3.5,
      swayAmp: 4 + Math.random() * 3,
      swayFreq: 0.45 + Math.random() * 0.3,
      hasFlower: false,
      flowerPetals: 0, flowerPetalW: 0, flowerPetalH: 0,
      flowerCenterR: 0, flowerPetalColor: fp.petal, flowerCenterColor: fp.center,
    };
  }

  const petalCount = [5, 6, 7, 8][Math.floor(Math.random() * 4)];
  const sizeScale = 0.85 + Math.random() * 0.55;

  return {
    kind: 'flower', depth,
    hFrac: 0.35 + Math.random() * 0.30,
    baseW: 3.5 + Math.random() * 1.5,
    tipW: 0.8 + Math.random() * 0.4,
    nLeaves: 2 + Math.floor(Math.random() * 3),
    leafW: 11 + Math.random() * 8,
    leafH: 20 + Math.random() * 14,
    growDur: 7 + Math.random() * 3,
    matureDur: 18 + Math.random() * 8,
    fadeDur: 4,
    swayAmp: 5 + Math.random() * 4,
    swayFreq: 0.4 + Math.random() * 0.3,
    hasFlower: true,
    flowerPetals: petalCount,
    flowerPetalW: (7 + Math.random() * 4) * sizeScale,
    flowerPetalH: (12 + Math.random() * 6) * sizeScale,
    flowerCenterR: (4 + Math.random() * 2.5) * sizeScale,
    flowerPetalColor: fp.petal,
    flowerCenterColor: fp.center,
  };
}

// ===========================================================================
// Pollen particle
// ===========================================================================
class Pollen {
  x: number; y: number; vx: number; vy: number;
  r: number; life: number; maxLife: number;
  color: string; wobblePhase: number; wobbleAmp: number;

  constructor(W: number, H: number, groundY: number) {
    this.x = Math.random() * W;
    this.y = groundY - Math.random() * H * 0.5;
    this.vx = (Math.random() - 0.5) * 8;
    this.vy = -(6 + Math.random() * 14);
    this.r = 1.5 + Math.random() * 2.5;
    this.maxLife = 8 + Math.random() * 12;
    this.life = 0;
    this.color = POLLEN_COLORS[Math.floor(Math.random() * POLLEN_COLORS.length)];
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.wobbleAmp = 10 + Math.random() * 20;
  }

  update(dt: number): boolean {
    this.life += dt;
    if (this.life >= this.maxLife) return false;
    this.x += this.vx * dt + Math.sin(this.life * 0.8 + this.wobblePhase) * this.wobbleAmp * dt;
    this.y += this.vy * dt;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const progress = this.life / this.maxLife;
    const alpha = progress < 0.1 ? progress / 0.1 : 1 - Math.pow(progress, 2);
    if (alpha <= 0) return;
    const finalAlpha = alpha * 0.45;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = this.color + finalAlpha + ')';
    ctx.shadowColor = this.color + (finalAlpha * 0.6) + ')';
    ctx.shadowBlur = this.r * 3;
    ctx.fill();
    ctx.restore();
  }
}

// ===========================================================================
// Plant2D
// ===========================================================================
class Plant2D {
  cfg: Cfg;
  xs: Float32Array;
  ys: Float32Array;
  groundY: number;
  startXFrac: number;

  state: 'growing' | 'mature' | 'fading';
  timer: number;
  growth: number;
  opacity: number;

  st: number; sp1: number; sp2: number; sp3: number;

  leafT: number[];
  leafSide: number[];
  leafBaseAngle: number[];
  leafColor: string;
  flowerRotOffset: number;

  constructor(W: number, groundY: number) {
    this.cfg = mkCfg();
    this.groundY = groundY;

    const startX = W * 0.06 + Math.random() * W * 0.88;
    this.startXFrac = startX / W;
    const depthScale = 0.7 + this.cfg.depth * 0.3;
    const maxH = groundY * this.cfg.hFrac * depthScale;

    this.xs = new Float32Array(PATH_PTS + 1);
    this.ys = new Float32Array(PATH_PTS + 1);
    const amp = (4 + Math.random() * 16) * (Math.random() > 0.5 ? 1 : -1);
    const freq = 0.4 + Math.random() * 0.5;
    const phase = Math.random() * Math.PI * 2;

    for (let i = 0; i <= PATH_PTS; i++) {
      const t = i / PATH_PTS;
      this.ys[i] = groundY - t * maxH;
      this.xs[i] = startX + amp * Math.sin(t * Math.PI * freq + phase) * (1 - t * 0.25) + (Math.random() - 0.5) * 0.6;
    }

    this.state = 'growing'; this.timer = 0; this.growth = 0; this.opacity = 1;
    this.st = 0;
    this.sp1 = Math.random() * Math.PI * 2;
    this.sp2 = Math.random() * Math.PI * 2;
    this.sp3 = Math.random() * Math.PI * 2;

    this.leafT = []; this.leafSide = []; this.leafBaseAngle = [];
    for (let i = 0; i < this.cfg.nLeaves; i++) {
      this.leafT.push(0.15 + (i / (this.cfg.nLeaves - 1 || 1)) * 0.62);
      this.leafSide.push(i % 2 === 0 ? 1 : -1);
      this.leafBaseAngle.push((0.25 + Math.random() * 0.4) * (i % 2 === 0 ? 1 : -1));
    }
    this.leafColor = LEAF_PALETTE[Math.floor(Math.random() * LEAF_PALETTE.length)];
    this.flowerRotOffset = Math.random() * Math.PI * 2;
  }

  sway(t: number): number {
    const inf = t * t;
    const { swayAmp: a, swayFreq: f } = this.cfg;
    const s = this.st;
    return inf * (
      a * 0.55 * Math.sin(s * f + this.sp1 + t * 2.0) +
      a * 0.30 * Math.sin(s * f * 1.73 + this.sp2 + t * 1.4) +
      a * 0.15 * Math.sin(s * f * 0.37 + this.sp3 + t * 3.2)
    );
  }

  pos(t: number): [number, number] {
    const idx = t * PATH_PTS;
    const i0 = Math.min(Math.floor(idx), PATH_PTS - 1);
    const f = idx - i0;
    return [
      this.xs[i0] + (this.xs[i0 + 1] - this.xs[i0]) * f + this.sway(t),
      this.ys[i0] + (this.ys[i0 + 1] - this.ys[i0]) * f,
    ];
  }

  tangent(t: number): [number, number] {
    const dt = 0.01;
    const [x0, y0] = this.pos(Math.max(0, t - dt));
    const [x1, y1] = this.pos(Math.min(1, t + dt));
    const dx = x1 - x0; const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }

  update(dt: number): boolean {
    this.st += dt;
    switch (this.state) {
      case 'growing':
        this.growth = Math.min(1, this.growth + dt / this.cfg.growDur);
        if (this.growth >= 1) { this.state = 'mature'; this.timer = 0; }
        break;
      case 'mature':
        this.timer += dt;
        if (this.timer >= this.cfg.matureDur) { this.state = 'fading'; this.timer = 0; }
        break;
      case 'fading':
        this.timer += dt;
        this.opacity = Math.max(0, 1 - this.timer / this.cfg.fadeDur);
        if (this.opacity <= 0) return false;
        break;
    }
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const eg = easeOutCubic(this.growth);
    const visPts = Math.max(2, Math.round(eg * PATH_PTS));
    if (visPts < 2) return;

    const depthAlpha = 0.55 + this.cfg.depth * 0.45;
    ctx.save();
    ctx.globalAlpha = this.opacity * depthAlpha;

    this.drawStem(ctx, visPts, eg);
    this.drawLeaves(ctx, eg);
    if (this.cfg.hasFlower) this.drawFlower(ctx, eg);

    ctx.restore();
  }

  private drawStem(ctx: CanvasRenderingContext2D, visPts: number, eg: number): void {
    const step = eg / visPts;
    const depthScale = 0.7 + this.cfg.depth * 0.3;
    const cx: number[] = []; const cy: number[] = [];
    const lx: number[] = []; const ly: number[] = [];
    const rx: number[] = []; const ry: number[] = [];

    for (let i = 0; i <= visPts; i++) {
      const t = Math.min(1, i * step);
      const [px, py] = this.pos(t);
      cx.push(px); cy.push(py);
      const tFrac = i / visPts;
      const w = (this.cfg.baseW + (this.cfg.tipW - this.cfg.baseW) * easeOutQuad(tFrac)) * depthScale;
      const hw = w / 2;
      const [tx, ty] = this.tangent(t);
      lx.push(px - ty * hw); ly.push(py + tx * hw);
      rx.push(px + ty * hw); ry.push(py - tx * hw);
    }

    ctx.beginPath();
    ctx.moveTo(lx[0], ly[0]);
    for (let i = 1; i <= visPts; i++) {
      if (i < visPts) {
        ctx.quadraticCurveTo(lx[i], ly[i], (lx[i] + lx[Math.min(i + 1, visPts)]) / 2, (ly[i] + ly[Math.min(i + 1, visPts)]) / 2);
      }
      ctx.lineTo(lx[i], ly[i]);
    }
    for (let i = visPts; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
    ctx.closePath();

    const grad = ctx.createLinearGradient(cx[0], cy[0], cx[visPts], cy[visPts]);
    const stemTarget = this.cfg.kind === 'leafy' ? STEM_GREEN_DARK : STEM_GREEN_MED;
    grad.addColorStop(0, lerpRGB(STEM_BROWN, stemTarget, 0.0));
    grad.addColorStop(0.35, lerpRGB(STEM_BROWN, stemTarget, 0.4));
    grad.addColorStop(1, lerpRGB(STEM_BROWN, stemTarget, 1.0));
    ctx.fillStyle = grad;
    ctx.fill();
  }

  private drawLeaves(ctx: CanvasRenderingContext2D, _eg: number): void {
    const depthScale = 0.7 + this.cfg.depth * 0.3;
    for (let i = 0; i < this.leafT.length; i++) {
      const lt = this.leafT[i];
      if (this.growth < lt) continue;

      const age = (this.growth - lt) / Math.max(0.01, 1 - lt);
      const unfurl = Math.min(1, age * 3);
      const scale = (0.2 + easeOutCubic(unfurl) * 0.8) * depthScale;

      const [ax, ay] = this.pos(lt);
      const swayAngle = this.sway(lt) * 0.015;

      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(this.leafBaseAngle[i] + swayAngle);
      ctx.scale(scale, scale);

      const w = this.cfg.leafW;
      const h = this.cfg.leafH;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(w * 0.55, -h * 0.15, w * 0.5, -h * 0.55, 0, -h);
      ctx.bezierCurveTo(-w * 0.5, -h * 0.55, -w * 0.55, -h * 0.15, 0, 0);
      ctx.closePath();

      const lg = ctx.createLinearGradient(0, 0, 0, -h);
      lg.addColorStop(0, this.leafColor);
      lg.addColorStop(1, this.leafColor + 'cc');
      ctx.fillStyle = lg;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.lineTo(0, -h * 0.88);
      ctx.strokeStyle = 'rgba(0,80,0,0.18)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawFlower(ctx: CanvasRenderingContext2D, eg: number): void {
    if (this.growth < 0.82) return;
    const bloom = Math.min(1, (this.growth - 0.82) / 0.18);
    const bs = easeOutCubic(bloom);
    const [fx, fy] = this.pos(Math.min(eg, 1));
    const depthScale = 0.7 + this.cfg.depth * 0.3;
    const { flowerPetals, flowerPetalW, flowerPetalH, flowerCenterR, flowerPetalColor, flowerCenterColor } = this.cfg;

    ctx.save();
    ctx.translate(fx, fy - 2);
    ctx.scale(bs * depthScale, bs * depthScale);
    ctx.rotate(Math.sin(this.st * 0.25 + this.flowerRotOffset) * 0.08);

    for (let i = 0; i < flowerPetals; i++) {
      const a = (i / flowerPetals) * Math.PI * 2 + this.flowerRotOffset * 0.3;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(flowerPetalW, -flowerPetalH * 0.3, flowerPetalW * 0.7, -flowerPetalH, 0, -flowerPetalH);
      ctx.bezierCurveTo(-flowerPetalW * 0.7, -flowerPetalH, -flowerPetalW, -flowerPetalH * 0.3, 0, 0);
      ctx.closePath();
      ctx.fillStyle = flowerPetalColor;
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, flowerCenterR, 0, Math.PI * 2);
    ctx.fillStyle = flowerCenterColor;
    ctx.fill();
    ctx.restore();
  }
}

// ===========================================================================
// Component
// ===========================================================================
const ThreeScene: React.FC<ThreeSceneProps> = ({ mouseX, mouseY }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) return;

    // ---- Sizing ----
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = window.innerWidth;
    let H = window.innerHeight - NAVBAR_HEIGHT;
    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight - NAVBAR_HEIGHT;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const GROUND_FRAC = 0.10;

    window.removeEventListener('resize', resize);
    const onResize = () => { resize(); };
    window.addEventListener('resize', onResize);

    // ---- Plants ----
    const plants: Plant2D[] = [];
    let spawnTimer = 0;
    let nextSpawn = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);

    const canSpawn = (xFrac: number): boolean => {
      for (const p of plants) {
        if (Math.abs(p.startXFrac - xFrac) < MIN_SPACING) return false;
      }
      return true;
    };

    const spawn = (stagger?: number) => {
      if (plants.length >= MAX_PLANTS) return;
      const groundY = H * (1 - GROUND_FRAC);
      const p = new Plant2D(W, groundY);
      let tries = 0;
      while (!canSpawn(p.startXFrac) && tries < 8) {
        const newX = W * 0.06 + Math.random() * W * 0.88;
        p.startXFrac = newX / W;
        const amp = (4 + Math.random() * 16) * (Math.random() > 0.5 ? 1 : -1);
        const freq = 0.4 + Math.random() * 0.5;
        const phase = Math.random() * Math.PI * 2;
        for (let i = 0; i <= PATH_PTS; i++) {
          const t = i / PATH_PTS;
          p.xs[i] = newX + amp * Math.sin(t * Math.PI * freq + phase) * (1 - t * 0.25);
        }
        tries++;
      }
      if (stagger) {
        p.growth = stagger;
        p.st = stagger * p.cfg.growDur;
      }
      plants.push(p);
    };

    for (let i = 0; i < INITIAL_COUNT; i++) {
      spawn((i / INITIAL_COUNT) * 0.7 + 0.15);
    }

    // ---- Pollen ----
    const pollen: Pollen[] = [];
    let pollenTimer = 0;

    // ---- Draw sky ----
    const drawSky = () => {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, lerpRGB(SKY_TOP, SKY_MID, 0));
      grad.addColorStop(0.4, lerpRGB(SKY_TOP, SKY_MID, 1));
      grad.addColorStop(1, lerpRGB(SKY_MID, SKY_BOT, 1));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Warm sunlight glow from upper-right
      const sunX = W * 0.82;
      const sunY = H * 0.08;
      const sunR = Math.max(W, H) * 0.6;
      const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
      sunGrad.addColorStop(0, 'rgba(255,248,220,0.35)');
      sunGrad.addColorStop(0.25, 'rgba(255,240,200,0.18)');
      sunGrad.addColorStop(0.5, 'rgba(255,235,190,0.08)');
      sunGrad.addColorStop(1, 'rgba(255,235,190,0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, W, H);
    };

    // ---- Draw ground ----
    const drawGround = () => {
      const gy = H * (1 - GROUND_FRAC);
      const gh = H * GROUND_FRAC;

      const g = ctx.createLinearGradient(0, gy, 0, H);
      g.addColorStop(0, GROUND_TOP);
      g.addColorStop(0.15, GROUND_LIGHT);
      g.addColorStop(0.4, GROUND_MID);
      g.addColorStop(1, GROUND_DARK);
      ctx.fillStyle = g;
      ctx.fillRect(0, gy, W, gh);
    };

    // ---- Animation loop ----
    let lastT = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;

      // Spawn plants
      spawnTimer += dt;
      if (spawnTimer >= nextSpawn && plants.length < MAX_PLANTS) {
        spawn();
        spawnTimer = 0;
        nextSpawn = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      }

      // Spawn pollen
      pollenTimer += dt;
      if (pollenTimer >= 0.4 && pollen.length < MAX_POLLEN) {
        pollen.push(new Pollen(W, H, H * (1 - GROUND_FRAC)));
        pollenTimer = 0;
      }

      // Update
      for (let i = plants.length - 1; i >= 0; i--) {
        if (!plants[i].update(dt)) plants.splice(i, 1);
      }
      for (let i = pollen.length - 1; i >= 0; i--) {
        if (!pollen[i].update(dt)) pollen.splice(i, 1);
      }

      // ---- Render ----
      drawSky();

      // Pollen behind plants (smaller = farther)
      for (const p of pollen) { if (p.r < 2.5) p.draw(ctx); }

      // Plants sorted by depth (far first)
      plants.sort((a, b) => a.cfg.depth - b.cfg.depth);
      for (const p of plants) p.draw(ctx);

      // Pollen in front (larger = nearer)
      for (const p of pollen) { if (p.r >= 2.5) p.draw(ctx); }

      drawGround();

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      {/* CSS fallback for mobile */}
      <div className="absolute inset-0 lg:hidden" style={{
        background: `linear-gradient(to top, ${GROUND_DARK}33 0%, rgba(74,222,128,0.08) 30%, rgba(245,240,232,0.95) 70%)`,
      }}>
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-amber-900/20 to-transparent" />
      </div>
    </div>
  );
};

export default ThreeScene;
