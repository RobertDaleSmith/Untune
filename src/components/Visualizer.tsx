import { useEffect, useRef, useCallback } from "react";
import { getFrequencyData } from "../lib/commands";
import type { FrequencyData } from "../lib/commands";

export type VisualizerMode = "bars" | "waveform" | "particles" | "geometry" | "digital";

export const ALL_MODES: VisualizerMode[] = ["bars", "waveform", "particles", "geometry", "digital"];

interface VisualizerProps {
  modes: VisualizerMode[];
  color?: [number, number, number] | null;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  hue: number;
}

export function Visualizer({ modes, color }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const smoothedBands = useRef<number[]>(new Array(64).fill(0));
  const smoothedWaveform = useRef<number[]>(new Array(128).fill(0));
  const smoothedEnergy = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const geometryRotation = useRef(0);
  const digitalPeaks = useRef<number[]>(new Array(64).fill(0));
  const digitalPeakDecay = useRef<number[]>(new Array(64).fill(0));
  const lastTimeRef = useRef(0);

  const animate = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dt = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 0.016;
      lastTimeRef.current = time;

      // Fire-and-forget poll — decouples render rate from IPC
      getFrequencyData()
        .then((data: FrequencyData) => {
          const bands = smoothedBands.current;
          const waveform = smoothedWaveform.current;
          for (let i = 0; i < 64; i++) {
            bands[i] = bands[i] * 0.7 + (data.bands[i] ?? 0) * 0.3;
          }
          for (let i = 0; i < 128; i++) {
            waveform[i] = waveform[i] * 0.7 + (data.waveform[i] ?? 0) * 0.3;
          }
          smoothedEnergy.current =
            smoothedEnergy.current * 0.7 + data.energy * 0.3;
        })
        .catch(() => {});

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const bands = smoothedBands.current;
      const waveform = smoothedWaveform.current;
      const energy = smoothedEnergy.current;

      const c = color ?? null;
      for (const m of modes) {
        switch (m) {
          case "geometry":
            renderGeometry(ctx, w, h, bands, energy, dt, geometryRotation, c);
            break;
          case "bars":
            renderBars(ctx, w, h, bands, c);
            break;
          case "waveform":
            renderWaveform(ctx, w, h, waveform, energy, c);
            break;
          case "particles":
            renderParticles(ctx, w, h, bands, energy, dt, particlesRef.current, c);
            break;
          case "digital":
            renderDigital(ctx, w, h, bands, dt, digitalPeaks.current, digitalPeakDecay.current, c);
            break;
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    },
    [modes, color],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      const pw = Math.round(rect.width);
      const ph = Math.round(rect.height);
      if (canvas.width !== pw * dpr || canvas.height !== ph * dpr) {
        canvas.width = pw * dpr;
        canvas.height = ph * dpr;
        canvas.style.width = `${pw}px`;
        canvas.style.height = `${ph}px`;
      }
    };

    syncSize();
    const ro = new ResizeObserver(() => syncSize());
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [animate]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
    />
  );
}

// --- Renderers ---

function renderBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: number[],
  color: [number, number, number] | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const lw = w / dpr;
  const lh = h / dpr;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const numBars = 64;
  const gap = 2;
  const barWidth = (lw - gap * (numBars + 1)) / numBars;
  const maxBarHeight = lh;
  const baseY = lh;

  // Base color from album art, or fallback white
  const [br, bg, bb] = color ?? [255, 255, 255];

  for (let i = 0; i < numBars; i++) {
    const x = gap + i * (barWidth + gap);
    const barH = bands[i] * maxBarHeight;

    // Subtle brightness variation across bars
    const t = i / numBars;
    const brightness = 0.95 + t * 0.1;
    const r = Math.min(255, Math.round(br * brightness));
    const g = Math.min(255, Math.round(bg * brightness));
    const b = Math.min(255, Math.round(bb * brightness));

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
    ctx.fillRect(x, baseY - barH, barWidth, barH);
  }

  ctx.restore();
}

function renderWaveform(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  waveform: number[],
  energy: number,
  color: [number, number, number] | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const lw = w / dpr;
  const lh = h / dpr;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const [cr, cg, cb] = color ?? [255, 255, 255];
  // Brighter version for the inner stroke
  const lr = Math.min(255, cr + 100);
  const lg = Math.min(255, cg + 100);
  const lb = Math.min(255, cb + 100);

  const midY = lh / 2;
  const amplitude = lh * 0.35;
  const lineWidth = 2 + energy * 4;

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.8)`;
  ctx.shadowColor = `rgba(${cr}, ${cg}, ${cb}, 0.6)`;
  ctx.shadowBlur = 15 + energy * 20;

  ctx.beginPath();
  const len = waveform.length;
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * lw;
    const y = midY + waveform[i] * amplitude;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prevX = ((i - 1) / (len - 1)) * lw;
      const prevY = midY + waveform[i - 1] * amplitude;
      const cpx = (prevX + x) / 2;
      ctx.bezierCurveTo(cpx, prevY, cpx, y, x, y);
    }
  }
  ctx.stroke();

  // Second, thinner stroke with lighter color for crispness
  ctx.shadowBlur = 0;
  ctx.lineWidth = lineWidth * 0.4;
  ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, 0.9)`;
  ctx.stroke();

  ctx.restore();
}

function renderParticles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: number[],
  _energy: number,
  dt: number,
  particles: Particle[],
  color: [number, number, number] | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const lw = w / dpr;
  const lh = h / dpr;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const [cr, cg, cb] = color ?? [255, 255, 255];

  const bass = bands.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
  const treble = bands.slice(48, 64).reduce((a, b) => a + b, 0) / 16;
  const mids = bands.slice(16, 48).reduce((a, b) => a + b, 0) / 32;

  // Spawn particles across the entire background
  const spawnCount = Math.floor(bass * 15);
  for (let i = 0; i < spawnCount && particles.length < 500; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + treble * 200 + Math.random() * 60;
    const variation = (Math.random() - 0.5) * 60;
    particles.push({
      x: Math.random() * lw,
      y: Math.random() * lh,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + mids * 6 + Math.random() * 3,
      life: 0,
      maxLife: 2 + Math.random() * 2,
      hue: variation,
    });
  }

  ctx.globalCompositeOperation = "lighter";

  // Update and draw particles
  let i = 0;
  while (i < particles.length) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
      continue;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98;
    p.vy *= 0.98;

    const alpha = 1 - p.life / p.maxLife;
    const size = p.size * (0.5 + alpha * 0.5);

    const v = p.hue / 60;
    const r = Math.min(255, Math.max(0, Math.round(cr + v * 80)));
    const g = Math.min(255, Math.max(0, Math.round(cg + v * 40)));
    const b = Math.min(255, Math.max(0, Math.round(cb - v * 40)));

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.7})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();

    i++;
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

function renderGeometry(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: number[],
  energy: number,
  dt: number,
  rotationRef: React.MutableRefObject<number>,
  color: [number, number, number] | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const lw = w / dpr;
  const lh = h / dpr;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const [cr, cg, cb] = color ?? [255, 255, 255];

  const cx = lw / 2;
  const cy = lh / 2;
  // Base radius pulses with energy
  const baseRadius = Math.min(lw, lh) * (0.35 + energy * 0.2);

  rotationRef.current += dt * (0.5 + energy * 4);

  // Bass/mid/treble energy for per-shape reactivity
  const bass = bands.slice(0, 16).reduce((a, b) => a + b, 0) / 16;
  const mids = bands.slice(16, 40).reduce((a, b) => a + b, 0) / 24;
  const treble = bands.slice(40, 64).reduce((a, b) => a + b, 0) / 24;
  const subBass = bands.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
  const lowMids = bands.slice(8, 24).reduce((a, b) => a + b, 0) / 16;
  const highMids = bands.slice(24, 48).reduce((a, b) => a + b, 0) / 24;
  const bandEnergies = [bass, subBass, mids, lowMids, highMids, treble, (bass + mids) / 2, (mids + treble) / 2];

  const shapes = [
    { sides: 48, radiusMult: 1.0, tintOff: 0 },
    { sides: 40, radiusMult: 0.88, tintOff: 0.1 },
    { sides: 36, radiusMult: 0.76, tintOff: 0.2 },
    { sides: 32, radiusMult: 0.64, tintOff: -0.1 },
    { sides: 28, radiusMult: 0.52, tintOff: 0.3 },
    { sides: 24, radiusMult: 0.40, tintOff: -0.2 },
    { sides: 20, radiusMult: 0.28, tintOff: 0.35 },
    { sides: 16, radiusMult: 0.16, tintOff: -0.15 },
  ];

  for (let s = 0; s < shapes.length; s++) {
    const shape = shapes[s];
    const shapeEnergy = bandEnergies[s];
    // Each shape's radius breathes with its frequency range
    const radius = baseRadius * shape.radiusMult * (1 + shapeEnergy * 0.5);
    const rotation =
      rotationRef.current * (s % 2 === 0 ? 1 : -1) * (0.4 + s * 0.25);

    const off = shape.tintOff;
    const r = Math.min(255, Math.max(0, Math.round(cr + off * 120)));
    const g = Math.min(255, Math.max(0, Math.round(cg + off * 80)));
    const b = Math.min(255, Math.max(0, Math.round(cb - off * 60)));

    ctx.beginPath();
    for (let v = 0; v <= shape.sides; v++) {
      const angle = (v / shape.sides) * Math.PI * 2 + rotation;
      // Map vertex to a band — spread across all 64 bands
      const bandIdx = Math.floor((v / shape.sides) * 64) % 64;
      // Average 3 neighboring bands for smoother displacement
      const b0 = bands[bandIdx] ?? 0;
      const b1 = bands[(bandIdx + 1) % 64] ?? 0;
      const b2 = bands[(bandIdx + 63) % 64] ?? 0;
      const bandVal = (b0 + b1 + b2) / 3;
      const displacement = 1 + bandVal * 2.0;
      const rad = radius * displacement;
      const x = cx + Math.cos(angle) * rad;
      const y = cy + Math.sin(angle) * rad;
      if (v === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.03 + shapeEnergy * 0.12})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 + shapeEnergy * 0.6})`;
    ctx.lineWidth = 1 + shapeEnergy * 5;
    ctx.stroke();
  }

  ctx.restore();
}

function renderDigital(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: number[],
  dt: number,
  peaks: number[],
  peakDecay: number[],
  color: [number, number, number] | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const lw = w / dpr;
  const lh = h / dpr;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const [cr, cg, cb] = color ?? [255, 255, 255];

  const cols = 32;
  const rows = 16;
  const regionH = lh / 3;
  const gap = 1.5;
  const cellW = (lw - gap * (cols + 1)) / cols;
  const cellH = (regionH - gap * (rows + 1)) / rows;

  for (let col = 0; col < cols; col++) {
    const b1 = bands[col * 2] ?? 0;
    const b2 = bands[col * 2 + 1] ?? 0;
    const level = (b1 + b2) / 2;
    const litRows = Math.round(level * rows);

    if (litRows >= peaks[col]) {
      peaks[col] = litRows;
      peakDecay[col] = 0.6;
    } else {
      peakDecay[col] -= dt;
      if (peakDecay[col] <= 0) {
        peaks[col] = Math.max(0, peaks[col] - dt * 20);
      }
    }

    const x = gap + col * (cellW + gap);

    for (let row = 0; row < rows; row++) {
      const invertedRow = rows - 1 - row;
      const y = gap + row * (cellH + gap);

      const isLit = invertedRow < litRows;
      const isPeak = Math.abs(invertedRow - Math.round(peaks[col])) < 1 && peaks[col] > 0;

      if (isLit) {
        const intensity = 0.5 + (invertedRow / rows) * 0.5;
        const r = Math.min(255, Math.round(cr * intensity));
        const g = Math.min(255, Math.round(cg * intensity));
        const b = Math.min(255, Math.round(cb * intensity));
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
        ctx.shadowColor = `rgba(${cr}, ${cg}, ${cb}, 0.4)`;
        ctx.shadowBlur = 4;
      } else if (isPeak) {
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.9)`;
        ctx.shadowColor = `rgba(${cr}, ${cg}, ${cb}, 0.6)`;
        ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.04)`;
        ctx.shadowBlur = 0;
      }

      ctx.fillRect(x, y, cellW, cellH);
    }
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}
