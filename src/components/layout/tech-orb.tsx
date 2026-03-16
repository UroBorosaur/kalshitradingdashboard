"use client";

import { useEffect, useRef } from "react";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface NodePoint extends Vec3 {
  pulsePhase: number;
  pointSize: number;
}

interface Spark {
  angle: number;
  radiusMul: number;
  length: number;
  speed: number;
  phase: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  scale: number;
}

function createRng(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rotatePoint(point: Vec3, rotY: number, rotX: number): Vec3 {
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  const x1 = point.x * cosY - point.z * sinY;
  const z1 = point.x * sinY + point.z * cosY;

  const y2 = point.y * cosX - z1 * sinX;
  const z2 = point.y * sinX + z1 * cosX;

  return { x: x1, y: y2, z: z2 };
}

function projectPoint(
  point: Vec3,
  centerX: number,
  centerY: number,
  radius: number,
  cameraDistance: number,
): ProjectedPoint {
  const scale = cameraDistance / (cameraDistance - point.z);
  return {
    x: centerX + point.x * radius * scale,
    y: centerY + point.y * radius * scale,
    z: point.z,
    scale,
  };
}

function drawLine(ctx: CanvasRenderingContext2D, a: ProjectedPoint, b: ProjectedPoint, alpha: number, width: number) {
  ctx.strokeStyle = `rgba(34, 211, 238, ${alpha.toFixed(4)})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawMesh(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  cameraDistance: number,
  rotY: number,
  rotX: number,
) {
  const latSteps = 9;
  const lonSteps = 24;

  for (let li = -latSteps; li <= latSteps; li += 1) {
    const lat = (li / latSteps) * (Math.PI / 2);
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    let prev: ProjectedPoint | null = null;
    for (let sj = 0; sj <= lonSteps; sj += 1) {
      const lon = (sj / lonSteps) * Math.PI * 2;
      const p = rotatePoint({ x: cosLat * Math.cos(lon), y: sinLat, z: cosLat * Math.sin(lon) }, rotY, rotX);
      const pp = projectPoint(p, centerX, centerY, radius, cameraDistance);
      if (prev) {
        const depth = (prev.z + pp.z + 2) / 4;
        drawLine(ctx, prev, pp, 0.035 + depth * 0.08, 0.45 + depth * 0.55);
      }
      prev = pp;
    }
  }

  for (let lj = 0; lj < lonSteps; lj += 1) {
    const lon = (lj / lonSteps) * Math.PI * 2;
    let prev: ProjectedPoint | null = null;
    for (let si = -latSteps; si <= latSteps; si += 1) {
      const lat = (si / latSteps) * (Math.PI / 2);
      const p = rotatePoint(
        { x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon) },
        rotY,
        rotX,
      );
      const pp = projectPoint(p, centerX, centerY, radius, cameraDistance);
      if (prev) {
        const depth = (prev.z + pp.z + 2) / 4;
        drawLine(ctx, prev, pp, 0.03 + depth * 0.07, 0.4 + depth * 0.45);
      }
      prev = pp;
    }
  }
}

function buildPointsAndLinks() {
  const rng = createRng(0x8badf00d);
  const points: NodePoint[] = [];
  const totalPoints = 170;

  for (let i = 0; i < totalPoints; i += 1) {
    const u = rng();
    const v = rng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.cos(phi);
    const z = Math.sin(phi) * Math.sin(theta);

    points.push({
      x,
      y,
      z,
      pulsePhase: rng() * Math.PI * 2,
      pointSize: 0.7 + rng() * 1.1,
    });
  }

  const links: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 1) {
    const candidates: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const dz = points[i].z - points[j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.58) candidates.push({ j, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const item of candidates.slice(0, 3)) {
      if (i < item.j) links.push([i, item.j]);
    }
  }

  const sparks: Spark[] = [];
  const sparkCount = 46;
  for (let i = 0; i < sparkCount; i += 1) {
    sparks.push({
      angle: rng() * Math.PI * 2,
      radiusMul: 1.02 + rng() * 0.22,
      length: 5 + rng() * 12,
      speed: (rng() - 0.5) * 0.65,
      phase: rng() * Math.PI * 2,
    });
  }

  return { points, links, sparks };
}

function drawOrbFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsed: number,
  points: NodePoint[],
  links: Array<[number, number]>,
  sparks: Spark[],
) {
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const radius = Math.min(width, height) * 0.34;
  const cameraDistance = 3;

  ctx.clearRect(0, 0, width, height);

  const bgGlow = ctx.createRadialGradient(centerX, centerY, radius * 0.1, centerX, centerY, radius * 1.45);
  bgGlow.addColorStop(0, "rgba(34, 211, 238, 0.19)");
  bgGlow.addColorStop(0.5, "rgba(14, 165, 233, 0.09)");
  bgGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bgGlow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.5, 0, Math.PI * 2);
  ctx.fill();

  const rotY = elapsed * 0.55;
  const rotX = Math.sin(elapsed * 0.43) * 0.34 + Math.cos(elapsed * 0.17) * 0.12;

  drawMesh(ctx, centerX, centerY, radius, cameraDistance, rotY, rotX);

  const projected: ProjectedPoint[] = points.map((point) => {
    const rotated = rotatePoint(point, rotY, rotX);
    return projectPoint(rotated, centerX, centerY, radius, cameraDistance);
  });

  for (const [aIndex, bIndex] of links) {
    const a = projected[aIndex];
    const b = projected[bIndex];
    const depth = ((a.z + b.z) * 0.5 + 1) * 0.5;
    const alpha = 0.03 + depth * 0.24;
    const widthPx = 0.35 + depth * 0.8;
    drawLine(ctx, a, b, alpha, widthPx);
  }

  const drawOrder = projected
    .map((value, index) => ({ index, z: value.z }))
    .sort((a, b) => a.z - b.z);

  for (const item of drawOrder) {
    const p = projected[item.index];
    const source = points[item.index];
    const depth = (p.z + 1) * 0.5;
    const pulse = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(elapsed * 1.6 + source.pulsePhase));
    const size = source.pointSize * (0.35 + depth * 1.15) * pulse;

    ctx.fillStyle = `rgba(125, 242, 255, ${(0.18 + depth * 0.6).toFixed(4)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const spark of sparks) {
    const ang = spark.angle + elapsed * spark.speed;
    const outer = radius * spark.radiusMul;
    const x0 = centerX + Math.cos(ang) * outer;
    const y0 = centerY + Math.sin(ang) * outer;
    const x1 = centerX + Math.cos(ang) * (outer + spark.length);
    const y1 = centerY + Math.sin(ang) * (outer + spark.length);
    const flicker = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(elapsed * 2.6 + spark.phase));
    ctx.strokeStyle = `rgba(56, 189, 248, ${flicker.toFixed(4)})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  const coreRadius = radius * 0.36;
  const coreGlow = ctx.createRadialGradient(centerX, centerY, coreRadius * 0.15, centerX, centerY, coreRadius * 1.1);
  coreGlow.addColorStop(0, "rgba(18, 255, 255, 0.92)");
  coreGlow.addColorStop(0.35, "rgba(34, 211, 238, 0.78)");
  coreGlow.addColorStop(1, "rgba(34, 211, 238, 0)");
  ctx.fillStyle = coreGlow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, coreRadius * 1.1, 0, Math.PI * 2);
  ctx.fill();

  const cloudCount = 95;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < cloudCount; i += 1) {
    const n = i + 1;
    const angle = n * golden + elapsed * 0.55;
    const distance = (Math.sqrt(n) / Math.sqrt(cloudCount)) * coreRadius * 0.92;
    const wobble = 1 + 0.12 * Math.sin(elapsed * 1.2 + i * 0.31);
    const x = centerX + Math.cos(angle) * distance * wobble;
    const y = centerY + Math.sin(angle) * distance * wobble;
    const r = 0.8 + ((i * 13) % 11) * 0.08;
    ctx.fillStyle = `rgba(110, 246, 255, ${(0.22 + (1 - distance / coreRadius) * 0.65).toFixed(4)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function TechOrb() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { points, links, sparks } = buildPointsAndLinks();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let rafId = 0;
    const start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = () => {
      const elapsed = (performance.now() - start) / 1000;
      drawOrbFrame(ctx, canvas.clientWidth, canvas.clientHeight, elapsed, points, links, sparks);
      rafId = window.requestAnimationFrame(frame);
    };

    resize();

    if (reduceMotion) {
      drawOrbFrame(ctx, canvas.clientWidth, canvas.clientHeight, 0.75, points, links, sparks);
    } else {
      rafId = window.requestAnimationFrame(frame);
    }

    const observer = new ResizeObserver(() => {
      resize();
      if (reduceMotion) {
        drawOrbFrame(ctx, canvas.clientWidth, canvas.clientHeight, 0.75, points, links, sparks);
      }
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="tech-orb-wrap pointer-events-none fixed bottom-3 right-3 z-20 sm:bottom-5 sm:right-5" aria-hidden="true">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
