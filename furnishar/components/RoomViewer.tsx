'use client';

import { Edges, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Opening, Placement, Product, RoomLayout, Violation, Wall } from '@/lib/types';

interface RoomViewerProps {
  roomLayout: RoomLayout;
  placements: Placement[];
  products: Product[];
  selectedId?: string | null;
  onSelect?: (placementId: string | null) => void;
  violations?: Violation[];
}

const WALL_THICKNESS = 0.1;
const ACCENT = '#4F46E5';
const DANGER = '#EF4444';

/** Floor-plan (x, y) → three.js world (x, z), centered on the room. */
function toWorld(room: RoomLayout, x: number, y: number): [number, number] {
  return [x - room.dimensions.width / 2, y - room.dimensions.length / 2];
}

// ── Floor ─────────────────────────────────────────────────────────────────────

function useWoodTexture(width: number, length: number) {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#D4A574';
    ctx.fillRect(0, 0, 512, 512);
    const plank = 64;
    for (let row = 0; row < 512 / plank; row++) {
      const offset = (row % 2) * 160;
      for (let x = -offset; x < 512; x += 320) {
        const shade = 0.9 + Math.random() * 0.15;
        ctx.fillStyle = `rgb(${212 * shade}, ${165 * shade}, ${116 * shade})`;
        ctx.fillRect(x, row * plank, 320, plank);
        ctx.strokeStyle = 'rgba(90, 55, 25, 0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, row * plank, 320, plank);
      }
      // grain
      for (let g = 0; g < 6; g++) {
        ctx.strokeStyle = 'rgba(120, 75, 35, 0.12)';
        ctx.beginPath();
        const gy = row * plank + Math.random() * plank;
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(170, gy + 4, 340, gy - 4, 512, gy);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(width / 2, length / 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, [width, length]);
}

function Floor({ room, onMiss }: { room: RoomLayout; onMiss: () => void }) {
  const { width, length } = room.dimensions;
  const texture = useWoodTexture(width, length);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={(e) => { e.stopPropagation(); onMiss(); }}>
      <planeGeometry args={[width, length]} />
      <meshStandardMaterial map={texture} roughness={0.75} />
    </mesh>
  );
}

// ── Walls ─────────────────────────────────────────────────────────────────────

interface Segment {
  from: number;
  to: number;
  bottom: number;
  top: number;
  kind: 'wall' | 'glass';
}

/** Split a wall into solid/glass segments, leaving door gaps open. */
function wallSegments(wall: Wall, openings: Opening[], height: number): Segment[] {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const along = (o: Opening) => Math.hypot(o.position.x - wall.start.x, o.position.y - wall.start.y);
  const holes = openings
    .filter((o) => o.wall_id === wall.id)
    .map((o) => ({ o, from: Math.max(0, along(o) - o.width / 2), to: Math.min(length, along(o) + o.width / 2) }))
    .sort((a, b) => a.from - b.from);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const { o, from, to } of holes) {
    if (from > cursor) segments.push({ from: cursor, to: from, bottom: 0, top: height, kind: 'wall' });
    const openTop = Math.min(height, (o.sill_height ?? 0) + o.height);
    if (o.type === 'window') {
      const sill = o.sill_height ?? 0.9;
      segments.push({ from, to, bottom: 0, top: sill, kind: 'wall' });
      segments.push({ from, to, bottom: sill, top: openTop, kind: 'glass' });
    }
    // Doors / archways: leave the gap, but keep the header above it.
    if (openTop < height) segments.push({ from, to, bottom: openTop, top: height, kind: 'wall' });
    cursor = Math.max(cursor, to);
  }
  if (cursor < length) segments.push({ from: cursor, to: length, bottom: 0, top: height, kind: 'wall' });
  return segments;
}

function WallMesh({ room, wall }: { room: RoomLayout; wall: Wall }) {
  const { height } = room.dimensions;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  // Outward normal (away from the room center) so the inner face sits on the room boundary.
  const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  let normal = { x: dir.y, y: -dir.x };
  const toCenter = { x: room.dimensions.width / 2 - mid.x, y: room.dimensions.length / 2 - mid.y };
  if (normal.x * toCenter.x + normal.y * toCenter.y > 0) normal = { x: -normal.x, y: -normal.y };
  const angle = -Math.atan2(dy, dx);

  const materials = useRef<THREE.MeshStandardMaterial[]>([]);
  const segments = useMemo(() => wallSegments(wall, room.openings, height), [wall, room.openings, height]);
  const worldNormal = useMemo(() => new THREE.Vector3(normal.x, 0, normal.y), [normal.x, normal.y]);

  // "Dollhouse" effect: fade walls that stand between the camera and the room.
  useFrame(({ camera }) => {
    const [wx, wz] = toWorld(room, mid.x, mid.y);
    const toCam = new THREE.Vector3(camera.position.x - wx, 0, camera.position.z - wz);
    const facing = toCam.normalize().dot(worldNormal);
    const target = facing > 0.25 ? 0.12 : 1;
    for (const m of materials.current) {
      if (!m) continue;
      const goal = (m.userData.glass ? 0.3 : 1) * target;
      m.opacity += (goal - m.opacity) * 0.15;
      m.transparent = m.opacity < 0.99;
      m.depthWrite = m.opacity > 0.5;
    }
  });

  return (
    <group>
      {segments.map((s, i) => {
        const center = (s.from + s.to) / 2;
        const px = wall.start.x + dir.x * center + (normal.x * WALL_THICKNESS) / 2;
        const py = wall.start.y + dir.y * center + (normal.y * WALL_THICKNESS) / 2;
        const [wx, wz] = toWorld(room, px, py);
        const segLen = s.to - s.from + (s.kind === 'wall' ? WALL_THICKNESS : 0);
        const segH = s.top - s.bottom;
        if (segLen <= 0.001 || segH <= 0.001) return null;
        return (
          <mesh
            key={i}
            position={[wx, s.bottom + segH / 2, wz]}
            rotation-y={angle}
            castShadow={s.kind === 'wall'}
            receiveShadow
          >
            <boxGeometry args={[segLen, segH, s.kind === 'glass' ? 0.02 : WALL_THICKNESS]} />
            <meshStandardMaterial
              ref={(m) => {
                if (m) {
                  m.userData.glass = s.kind === 'glass';
                  materials.current[i] = m;
                }
              }}
              color={s.kind === 'glass' ? '#87CEEB' : '#E5E5E5'}
              transparent={s.kind === 'glass'}
              opacity={s.kind === 'glass' ? 0.3 : 1}
              roughness={s.kind === 'glass' ? 0.05 : 0.9}
              metalness={s.kind === 'glass' ? 0.2 : 0}
              emissive={s.kind === 'glass' ? '#87CEEB' : '#000000'}
              emissiveIntensity={s.kind === 'glass' ? 0.25 : 0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/** Quarter-circle swing arc on the floor so the door clearance reads at a glance. */
function DoorSwing({ room, door }: { room: RoomLayout; door: Opening }) {
  const wall = room.walls.find((w) => w.id === door.wall_id);
  if (!wall) return null;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  const hinge = { x: door.position.x - (dir.x * door.width) / 2, y: door.position.y - (dir.y * door.width) / 2 };
  const [hx, hz] = toWorld(room, hinge.x, hinge.y);
  let inward = { x: -dir.y, y: dir.x };
  const toCenter = { x: room.dimensions.width / 2 - hinge.x, y: room.dimensions.length / 2 - hinge.y };
  if (inward.x * toCenter.x + inward.y * toCenter.y < 0) inward = { x: -inward.x, y: -inward.y };
  const a1 = Math.atan2(-dir.y, dir.x);
  const a2 = Math.atan2(-inward.y, inward.x);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const start = delta > 0 ? a1 : a2;

  return (
    <group position={[hx, 0.004, hz]}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[door.width - 0.02, door.width, 48, 1, start, Math.abs(delta)]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[door.width, 48, start, Math.abs(delta)]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
      {/* the open door leaf */}
      <mesh
        position={[(inward.x * door.width) / 2, door.height / 2, (inward.y * door.width) / 2]}
        rotation-y={-Math.atan2(inward.y, inward.x)}
        castShadow
      >
        <boxGeometry args={[door.width, door.height, 0.04]} />
        <meshStandardMaterial color="#B08968" roughness={0.6} />
      </mesh>
    </group>
  );
}

// ── Furniture ─────────────────────────────────────────────────────────────────

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1));
  return `#${c.getHexString()}`;
}

interface PartProps {
  size: [number, number, number];
  position: [number, number, number];
  color: string;
  highlight: string | null;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

function Part({ size, position, color, highlight, roughness = 0.7, emissive, emissiveIntensity }: PartProps) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        emissive={highlight ?? emissive ?? '#000000'}
        emissiveIntensity={highlight ? 0.35 : emissiveIntensity ?? 0}
      />
    </mesh>
  );
}

/** Low-poly, category-aware furniture model. Local space: width on X, depth on Z, back at -Z. */
function FurnitureModel({ product, highlight }: { product: Product; highlight: string | null }) {
  const { width: w, depth: d, height: h } = product.dimensions;
  const c = product.color;
  const dark = shade(c, -0.12);
  const light = shade(c, 0.08);
  const leg = 0.04;
  const legs = (top: number, color: string, inset = 0.04) =>
    [
      [-w / 2 + inset, -d / 2 + inset],
      [w / 2 - inset, -d / 2 + inset],
      [-w / 2 + inset, d / 2 - inset],
      [w / 2 - inset, d / 2 - inset],
    ].map(([x, z], i) => (
      <Part key={i} size={[leg, top, leg]} position={[x, top / 2, z]} color={color} highlight={highlight} />
    ));

  switch (product.category) {
    case 'sofa': {
      const seatH = h * 0.5;
      const arm = Math.min(0.18, w * 0.08);
      const backD = Math.min(0.25, d * 0.25);
      const seatCount = w > 2 ? 3 : 2;
      const cushionW = (w - arm * 2) / seatCount;
      return (
        <group>
          <Part size={[w, seatH * 0.6, d]} position={[0, seatH * 0.3 + 0.05, 0]} color={dark} highlight={highlight} />
          {Array.from({ length: seatCount }).map((_, i) => (
            <Part
              key={i}
              size={[cushionW - 0.02, seatH * 0.4, d - backD - 0.02]}
              position={[-w / 2 + arm + cushionW * (i + 0.5), seatH * 0.8 + 0.05, backD / 2]}
              color={light}
              highlight={highlight}
              roughness={0.95}
            />
          ))}
          <Part size={[w, h - 0.05, backD]} position={[0, (h - 0.05) / 2 + 0.05, -d / 2 + backD / 2]} color={c} highlight={highlight} roughness={0.95} />
          <Part size={[arm, h * 0.7, d]} position={[-w / 2 + arm / 2, h * 0.35 + 0.05, 0]} color={c} highlight={highlight} />
          <Part size={[arm, h * 0.7, d]} position={[w / 2 - arm / 2, h * 0.35 + 0.05, 0]} color={c} highlight={highlight} />
          {legs(0.05, '#2B2B2B', 0.06)}
        </group>
      );
    }
    case 'desk':
    case 'coffee_table': {
      const top = 0.035;
      return (
        <group>
          <Part size={[w, top, d]} position={[0, h - top / 2, 0]} color={c} highlight={highlight} roughness={0.5} />
          {legs(h - top, product.category === 'desk' ? '#9CA3AF' : dark)}
          {product.category === 'coffee_table' && (
            <Part size={[w - 0.1, 0.02, d - 0.1]} position={[0, 0.12, 0]} color={dark} highlight={highlight} />
          )}
        </group>
      );
    }
    case 'bookshelf': {
      const t = 0.025;
      const shelves = Math.max(2, Math.round(h / 0.36));
      const bookColors = ['#B45309', '#1D4ED8', '#15803D', '#B91C1C', '#6D28D9', '#0F766E', '#CA8A04'];
      return (
        <group>
          <Part size={[w, h, t]} position={[0, h / 2, -d / 2 + t / 2]} color={dark} highlight={highlight} />
          <Part size={[t, h, d]} position={[-w / 2 + t / 2, h / 2, 0]} color={c} highlight={highlight} />
          <Part size={[t, h, d]} position={[w / 2 - t / 2, h / 2, 0]} color={c} highlight={highlight} />
          {Array.from({ length: shelves + 1 }).map((_, i) => (
            <Part key={`s${i}`} size={[w, t, d]} position={[0, (i * (h - t)) / shelves + t / 2, 0]} color={c} highlight={highlight} />
          ))}
          {Array.from({ length: shelves }).map((_, i) =>
            Array.from({ length: 5 }).map((__, j) => {
              const bh = ((h / shelves) * (0.55 + ((i * 7 + j * 3) % 5) * 0.07));
              const bw = (w - 2 * t) / 7;
              if ((i + j) % 4 === 3) return null;
              return (
                <Part
                  key={`b${i}-${j}`}
                  size={[bw * 0.9, bh, d * 0.7]}
                  position={[-w / 2 + t + bw * (j + 0.6), (i * (h - t)) / shelves + t + bh / 2, 0]}
                  color={bookColors[(i * 5 + j) % bookColors.length]}
                  highlight={highlight}
                  roughness={0.8}
                />
              );
            }),
          )}
        </group>
      );
    }
    case 'rug':
      return (
        <group>
          <Part size={[w, Math.max(h, 0.012), d]} position={[0, Math.max(h, 0.012) / 2, 0]} color={c} highlight={highlight} roughness={1} />
          <Part size={[w * 0.8, 0.002, d * 0.8]} position={[0, Math.max(h, 0.012) + 0.001, 0]} color={dark} highlight={highlight} roughness={1} />
        </group>
      );
    case 'lamp': {
      const shadeH = Math.min(0.3, h * 0.25);
      const r = Math.max(w, d) / 2;
      return (
        <group>
          <mesh position={[0, 0.015, 0]} castShadow>
            <cylinderGeometry args={[r * 0.8, r * 0.9, 0.03, 24]} />
            <meshStandardMaterial color={c} emissive={highlight ?? '#000'} emissiveIntensity={highlight ? 0.35 : 0} />
          </mesh>
          <mesh position={[0, (h - shadeH) / 2, 0]} castShadow>
            <cylinderGeometry args={[0.012, 0.012, h - shadeH, 8]} />
            <meshStandardMaterial color={c} metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[0, h - shadeH / 2, 0]} castShadow>
            <cylinderGeometry args={[r * 0.45, r, shadeH, 24, 1, true]} />
            <meshStandardMaterial color={c} emissive="#FDBA74" emissiveIntensity={0.6} side={THREE.DoubleSide} />
          </mesh>
          <pointLight position={[0, h - shadeH, 0]} intensity={0.9} distance={3.5} decay={2} color="#FFD8A8" />
        </group>
      );
    }
    case 'chair': {
      const seatH = Math.min(0.46, h * 0.45);
      const office = product.styleTags.includes('office');
      return (
        <group>
          <Part size={[w * 0.9, 0.08, d * 0.8]} position={[0, seatH, d * 0.05]} color={c} highlight={highlight} roughness={0.9} />
          <Part
            size={[w * 0.85, h - seatH, 0.08]}
            position={[0, seatH + (h - seatH) / 2, -d / 2 + 0.06]}
            color={c}
            highlight={highlight}
            roughness={0.9}
          />
          {office ? (
            <>
              <mesh position={[0, seatH / 2, 0]} castShadow>
                <cylinderGeometry args={[0.03, 0.03, seatH, 12]} />
                <meshStandardMaterial color="#4B5563" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.04, 0]} castShadow>
                <cylinderGeometry args={[w * 0.4, w * 0.4, 0.04, 5]} />
                <meshStandardMaterial color="#374151" />
              </mesh>
            </>
          ) : (
            <>
              <Part size={[0.04, seatH, d * 0.9]} position={[-w / 2 + 0.03, seatH / 2, 0]} color={shade(c, -0.2)} highlight={highlight} />
              <Part size={[0.04, seatH, d * 0.9]} position={[w / 2 - 0.03, seatH / 2, 0]} color={shade(c, -0.2)} highlight={highlight} />
            </>
          )}
        </group>
      );
    }
    default:
      return <Part size={[w, h, d]} position={[0, h / 2, 0]} color={c} highlight={highlight} />;
  }
}

function FurniturePiece({
  room,
  placement,
  product,
  selected,
  flagged,
  index,
  onSelect,
}: {
  room: RoomLayout;
  placement: Placement;
  product: Product;
  selected: boolean;
  flagged: boolean;
  index: number;
  onSelect?: (id: string | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [wx, wz] = toWorld(room, placement.position.x, placement.position.y);
  const rotation = THREE.MathUtils.degToRad(placement.rotation);
  const { width: w, depth: d, height: h } = product.dimensions;
  const delay = useRef(index * 0.12);

  // Drop-in on mount, then glide whenever the designer moves a piece.
  useEffect(() => {
    if (group.current && group.current.userData.mounted !== true) {
      group.current.position.set(wx, 2.5, wz);
      group.current.rotation.y = rotation;
      group.current.userData.mounted = true;
    }
  }, [wx, wz, rotation]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    if (delay.current > 0) {
      delay.current -= dt;
      return;
    }
    const k = 1 - Math.pow(0.001, dt);
    g.position.x += (wx - g.position.x) * k;
    g.position.z += (wz - g.position.z) * k;
    g.position.y += (placement.position.z - g.position.y) * k;
    let dr = rotation - g.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    g.rotation.y += dr * k;
  });

  const highlight = selected ? ACCENT : flagged ? DANGER : hovered ? '#6366F1' : null;

  return (
    <group
      ref={group}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect?.(selected ? null : placement.placement_id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      <FurnitureModel product={product} highlight={highlight} />
      {(selected || flagged) && (
        <mesh position={[0, Math.max(h, 0.02) / 2, 0]}>
          <boxGeometry args={[w + 0.04, Math.max(h, 0.02) + 0.04, d + 0.04]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color={selected ? ACCENT : DANGER} lineWidth={2} />
        </mesh>
      )}
      <Html position={[0, Math.max(h, 0.1) + 0.25, 0]} center zIndexRange={[selected ? 30 : 10, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-lg backdrop-blur transition-all ${
            selected
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-300'
              : flagged
                ? 'bg-red-600/90 text-white'
                : 'bg-slate-900/80 text-white ring-1 ring-white/10'
          }`}
        >
          {product.name} <span className="text-emerald-300">${product.price}</span>
        </div>
      </Html>
      {selected && (
        <Html position={[w / 2 + 0.2, Math.max(h, 0.3), 0]} zIndexRange={[40, 0]}>
          <div className="w-60 rounded-xl border border-indigo-500/50 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-bold text-white">{product.name}</span>
              <span className="font-semibold text-emerald-400">${product.price}</span>
            </div>
            <div className="mb-2 flex gap-1.5 text-[10px] uppercase tracking-wide">
              <span className="rounded bg-slate-700 px-1.5 py-0.5">{product.category.replace('_', ' ')}</span>
              <span className="rounded bg-indigo-600/30 px-1.5 py-0.5 text-indigo-200">{placement.priority}</span>
            </div>
            <div className="mb-2 text-slate-400">
              {Math.round(w * 100)} × {Math.round(d * 100)} × {Math.round(h * 100)} cm · rotated {placement.rotation}°
            </div>
            {placement.reasoning && <p className="mb-2 leading-snug text-slate-300">{placement.reasoning}</p>}
            <a href={product.ikeaUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-400 hover:text-indigo-300">
              View on IKEA →
            </a>
          </div>
        </Html>
      )}
    </group>
  );
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function Scene({ roomLayout, placements, products, selectedId, onSelect, violations = [] }: RoomViewerProps) {
  const { width, length, height } = roomLayout.dimensions;
  const window = roomLayout.openings.find((o) => o.type === 'window');
  const flagged = useMemo(() => new Set(violations.flatMap((v) => v.objects)), [violations]);
  const sunPos = useMemo<[number, number, number]>(() => {
    if (!window) return [width, height * 2.5, length];
    const [x, z] = toWorld(roomLayout, window.position.x, window.position.y);
    // Push the light source outward through the window.
    return [x * 2.2 + 0.5, height * 2.2, z * 2.2 + 0.5];
  }, [window, roomLayout, width, length, height]);
  const gridSize = Math.ceil(Math.max(width, length) * 2) / 2;

  return (
    <>
      <color attach="background" args={['#0B1120']} />
      <fog attach="fog" args={['#0B1120', 18, 40]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#E0E7FF', '#3F2E1E', 0.35]} />
      <directionalLight
        position={sunPos}
        intensity={1.6}
        color="#FFF4E0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0005}
      />

      <Floor room={roomLayout} onMiss={() => onSelect?.(null)} />
      <gridHelper args={[gridSize, gridSize * 2, '#8A6A4A', '#A07C58']} position={[0, 0.003, 0]}>
        <meshBasicMaterial attach="material" transparent opacity={0.18} />
      </gridHelper>
      {/* plinth around the room so it reads like a model on a table */}
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[width + WALL_THICKNESS * 2 + 0.3, 0.1, length + WALL_THICKNESS * 2 + 0.3]} />
        <meshStandardMaterial color="#1E293B" roughness={0.9} />
      </mesh>

      {roomLayout.walls.map((wall) => (
        <WallMesh key={wall.id} room={roomLayout} wall={wall} />
      ))}
      {roomLayout.openings
        .filter((o) => o.type === 'door')
        .map((door, i) => (
          <DoorSwing key={i} room={roomLayout} door={door} />
        ))}

      {placements.map((p, i) => {
        const product = products.find((x) => x.id === p.product_id);
        if (!product) return null;
        return (
          <FurniturePiece
            key={p.placement_id + p.product_id}
            room={roomLayout}
            placement={p}
            product={product}
            index={i}
            selected={selectedId === p.placement_id}
            flagged={flagged.has(p.placement_id)}
            onSelect={onSelect}
          />
        );
      })}

      <OrbitControls
        makeDefault
        target={[0, 0.4, 0]}
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={2}
        maxDistance={Math.max(width, length) * 3.5}
      />
    </>
  );
}

export default function RoomViewer(props: RoomViewerProps) {
  const { width, length } = props.roomLayout.dimensions;
  const dist = Math.max(width, length) * 1.25 + 1.5;
  // 45° down, looking in from the door-side corner.
  const camera = useMemo(
    () => ({
      position: [dist * 0.55, dist * 0.85, -dist * 0.75] as [number, number, number],
      fov: 45,
    }),
    [dist],
  );

  return (
    <Canvas shadows dpr={[1, 2]} camera={camera} gl={{ antialias: true }}>
      <Scene {...props} />
    </Canvas>
  );
}
