/**
 * Deterministic verification engine (Agent 3).
 *
 * Pure TypeScript — no AI. Given a room and a design plan it runs geometric and
 * budget checks and returns machine-readable violations the Designer agent can
 * act on in its next iteration.
 *
 * Coordinate system (floor plan, meters):
 *   origin (0,0) is the room's top-left corner, x runs along `width`,
 *   y runs along `length`. Placement.position is the CENTER of the piece.
 */
import type {
  BudgetSummary,
  DesignPlan,
  Opening,
  Placement,
  Product,
  RoomLayout,
  VerifiedPlan,
  Violation,
  Wall,
} from './types';

const BOUNDS_TOLERANCE = 0.05; // 5cm
const COLLISION_TOLERANCE = 0.01; // 1cm of overlap is treated as touching
const MIN_WALKWAY = 0.6; // 60cm
const FLUSH_GAP = 0.05; // pieces closer than 5cm are "pushed together" on purpose
const DOOR_CLEARANCE = 0.8; // 80cm
const AUTO_CLAMP_MAX = 0.3; // auto-fix pieces that poke out of the room by up to 30cm

/** Furniture pairs that are meant to sit close together (no walkway needed between them). */
const FUNCTIONAL_GROUPS: Array<[string, string]> = [
  ['chair', 'desk'],
  ['coffee_table', 'sofa'],
  ['coffee_table', 'chair'],
  ['lamp', '*'],
];

export interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function normalizeRotation(rotation: number): number {
  const r = ((Math.round((Number(rotation) || 0) / 90) * 90) % 360 + 360) % 360;
  return r;
}

/** Footprint (x-extent, y-extent) of a product given its rotation. */
export function footprint(product: Product, rotation: number): { w: number; d: number } {
  const r = normalizeRotation(rotation);
  const { width, depth } = product.dimensions;
  return r === 90 || r === 270 ? { w: depth, d: width } : { w: width, d: depth };
}

export function placementRect(p: Placement, product: Product): Rect {
  const { w, d } = footprint(product, p.rotation);
  return {
    minX: p.position.x - w / 2,
    maxX: p.position.x + w / 2,
    minY: p.position.y - d / 2,
    maxY: p.position.y + d / 2,
  };
}

function overlap1D(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

/** Positive = overlap depth on both axes (min of the two); negative = separated. */
function rectOverlap(a: Rect, b: Rect): { ox: number; oy: number } {
  return {
    ox: overlap1D(a.minX, a.maxX, b.minX, b.maxX),
    oy: overlap1D(a.minY, a.maxY, b.minY, b.maxY),
  };
}

/** Shortest distance between two axis-aligned rectangles (0 if they touch/overlap). */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX);
  const dy = Math.max(0, b.minY - a.maxY, a.minY - b.maxY);
  return Math.hypot(dx, dy);
}

function cm(m: number): number {
  return Math.round(m * 100);
}

function label(p: Placement): string {
  return `${p.product_name} (${p.placement_id})`;
}

function isFunctionalGroup(a: string, b: string): boolean {
  return FUNCTIONAL_GROUPS.some(
    ([x, y]) =>
      (x === a && (y === b || y === '*')) ||
      (x === b && (y === a || y === '*')),
  );
}

/** Rectangle on the floor that must stay clear in front of a door. */
export function doorClearanceRect(room: RoomLayout, door: Opening): Rect | null {
  const wall: Wall | undefined = room.walls.find((w) => w.id === door.wall_id);
  const cx = room.dimensions.width / 2;
  const cy = room.dimensions.length / 2;

  let along: { x: number; y: number };
  let inward: { x: number; y: number };
  if (wall) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy) || 1;
    along = { x: dx / len, y: dy / len };
    inward = { x: -along.y, y: along.x };
    // Flip the normal so it points toward the room's center.
    const toCenter = { x: cx - door.position.x, y: cy - door.position.y };
    if (inward.x * toCenter.x + inward.y * toCenter.y < 0) inward = { x: -inward.x, y: -inward.y };
  } else {
    // No wall info — infer from the nearest room edge.
    const { width: W, length: L } = room.dimensions;
    const d = [
      { dist: door.position.y, inward: { x: 0, y: 1 } },
      { dist: L - door.position.y, inward: { x: 0, y: -1 } },
      { dist: door.position.x, inward: { x: 1, y: 0 } },
      { dist: W - door.position.x, inward: { x: -1, y: 0 } },
    ].sort((a, b) => a.dist - b.dist)[0];
    inward = d.inward;
    along = { x: inward.y, y: -inward.x };
  }

  const hw = door.width / 2;
  const corners = [
    { x: door.position.x + along.x * hw, y: door.position.y + along.y * hw },
    { x: door.position.x - along.x * hw, y: door.position.y - along.y * hw },
  ];
  corners.push(
    ...corners.map((c) => ({ x: c.x + inward.x * DOOR_CLEARANCE, y: c.y + inward.y * DOOR_CLEARANCE })),
  );
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

export function computeBudgetSummary(
  placements: Placement[],
  catalog: Product[],
  budgetLimit: number,
): BudgetSummary {
  const by_priority = { must_have: 0, nice_to_have: 0, stretch: 0 };
  for (const p of placements) {
    const price = catalog.find((c) => c.id === p.product_id)?.price ?? 0;
    if (p.priority === 'must-have') by_priority.must_have += price;
    else if (p.priority === 'nice-to-have') by_priority.nice_to_have += price;
    else by_priority.stretch += price;
  }
  const total = by_priority.must_have + by_priority.nice_to_have + by_priority.stretch;

  const savings_suggestions: string[] = [];
  for (const p of placements) {
    const current = catalog.find((c) => c.id === p.product_id);
    if (!current) continue;
    const cheaper = catalog
      .filter((c) => c.category === current.category && c.price < current.price)
      .sort((a, b) => a.price - b.price)[0];
    if (cheaper && current.price - cheaper.price >= 50) {
      savings_suggestions.push(
        `Swap ${current.name} for ${cheaper.name} to save $${current.price - cheaper.price}`,
      );
    }
  }
  if (total > budgetLimit && by_priority.stretch > 0) {
    savings_suggestions.unshift(`Drop stretch items to save $${by_priority.stretch}`);
  }

  return {
    total,
    budget_limit: budgetLimit,
    within_budget: total <= budgetLimit,
    by_priority,
    savings_suggestions: savings_suggestions.slice(0, 4),
  };
}

export function verifyDesign(
  room: RoomLayout,
  plan: DesignPlan,
  catalog: Product[],
  iteration = 1,
): VerifiedPlan {
  const { width: W, length: L } = room.dimensions;
  const violations: Violation[] = [];
  const auto_fixed: string[] = [];
  const checks_run: string[] = [];

  // ── Pre-pass: normalize + auto-fix trivial issues ───────────────────────────
  const placements: Placement[] = [];
  (plan.placements || []).forEach((raw, i) => {
    const product = catalog.find((c) => c.id === raw.product_id);
    if (!product) {
      auto_fixed.push(`Removed unknown product "${raw.product_id}"`);
      return;
    }
    const p: Placement = {
      ...raw,
      placement_id: raw.placement_id || `p${i + 1}`,
      product_name: product.name,
      category: product.category,
      position: {
        x: Number(raw.position?.x) || 0,
        y: Number(raw.position?.y) || 0,
        z: 0,
      },
      rotation: normalizeRotation(raw.rotation),
      priority: (['must-have', 'nice-to-have', 'stretch'] as const).includes(raw.priority)
        ? raw.priority
        : 'nice-to-have',
      reasoning: raw.reasoning || '',
    };
    if (p.rotation !== raw.rotation) auto_fixed.push(`Snapped ${label(p)} rotation to ${p.rotation}°`);

    // Nudge pieces that barely poke through a wall back inside.
    const { w, d } = footprint(product, p.rotation);
    const clamp = (v: number, half: number, max: number) => Math.min(Math.max(v, half), max - half);
    if (w <= W && d <= L) {
      const nx = clamp(p.position.x, w / 2, W);
      const ny = clamp(p.position.y, d / 2, L);
      const shift = Math.hypot(nx - p.position.x, ny - p.position.y);
      if (shift > BOUNDS_TOLERANCE && shift <= AUTO_CLAMP_MAX) {
        auto_fixed.push(`Moved ${label(p)} ${cm(shift)}cm back inside the room`);
        p.position = { ...p.position, x: +nx.toFixed(3), y: +ny.toFixed(3) };
      }
    }
    placements.push(p);
  });

  const items = placements.map((p) => ({
    p,
    product: catalog.find((c) => c.id === p.product_id)!,
    rect: placementRect(p, catalog.find((c) => c.id === p.product_id)!),
  }));
  const solid = items.filter((it) => it.product.category !== 'rug');

  // ── 1. Bounds ───────────────────────────────────────────────────────────────
  checks_run.push('bounds');
  for (const { p, rect } of items) {
    const outBy = Math.max(
      -BOUNDS_TOLERANCE - rect.minX,
      rect.maxX - W - BOUNDS_TOLERANCE,
      -BOUNDS_TOLERANCE - rect.minY,
      rect.maxY - L - BOUNDS_TOLERANCE,
    );
    if (outBy > 0) {
      violations.push({
        type: 'out_of_bounds',
        objects: [p.placement_id],
        severity: 'high',
        description: `${label(p)} extends ${cm(outBy + BOUNDS_TOLERANCE)}cm outside the ${W.toFixed(2)}m × ${L.toFixed(2)}m room.`,
        suggestion: `Move ${p.placement_id} so its footprint [${rect.minX.toFixed(2)}–${rect.maxX.toFixed(2)}, ${rect.minY.toFixed(2)}–${rect.maxY.toFixed(2)}] fits within x∈[0,${W.toFixed(2)}], y∈[0,${L.toFixed(2)}], or rotate it / choose a smaller product.`,
      });
    }
  }

  // ── 2. Collisions (AABB, rugs skipped) ─────────────────────────────────────
  checks_run.push('collisions');
  const collided = new Set<string>();
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      const { ox, oy } = rectOverlap(a.rect, b.rect);
      if (ox > COLLISION_TOLERANCE && oy > COLLISION_TOLERANCE) {
        // A chair tucked under a desk is expected, not a collision.
        const pair = [a.p.category, b.p.category].sort().join('+');
        if (pair === 'chair+desk' && Math.min(ox, oy) <= 0.3) continue;
        collided.add(`${a.p.placement_id}|${b.p.placement_id}`);
        violations.push({
          type: 'collision',
          objects: [a.p.placement_id, b.p.placement_id],
          severity: 'high',
          description: `${label(a.p)} overlaps ${label(b.p)} by ${cm(ox)}cm × ${cm(oy)}cm.`,
          suggestion: `Separate them by at least ${cm(Math.min(ox, oy))}cm along the ${ox < oy ? 'x' : 'y'} axis (plus ${cm(MIN_WALKWAY)}cm if people need to walk between).`,
          measurements: { actual_cm: -cm(Math.min(ox, oy)), required_cm: 0 },
        });
      }
    }
  }

  // ── 3. Walkway (≥60cm between non-rug furniture) ───────────────────────────
  checks_run.push('walkway');
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      if (collided.has(`${a.p.placement_id}|${b.p.placement_id}`)) continue;
      if (isFunctionalGroup(a.p.category, b.p.category)) continue;
      const gap = rectGap(a.rect, b.rect);
      if (gap > FLUSH_GAP && gap < MIN_WALKWAY) {
        violations.push({
          type: 'walkway',
          objects: [a.p.placement_id, b.p.placement_id],
          severity: 'medium',
          description: `Only ${cm(gap)}cm between ${label(a.p)} and ${label(b.p)} — too tight to walk through.`,
          suggestion: `Increase the gap to ${cm(MIN_WALKWAY)}cm (move one piece ${cm(MIN_WALKWAY - gap)}cm further away) or push them flush together.`,
          measurements: { actual_cm: cm(gap), required_cm: cm(MIN_WALKWAY) },
        });
      }
    }
  }

  // ── 4. Door clearance (80cm in front of doors) ─────────────────────────────
  checks_run.push('door_clearance');
  for (const door of room.openings.filter((o) => o.type === 'door' || o.type === 'archway')) {
    const zone = doorClearanceRect(room, door);
    if (!zone) continue;
    for (const { p, rect } of solid) {
      const { ox, oy } = rectOverlap(zone, rect);
      if (ox > COLLISION_TOLERANCE && oy > COLLISION_TOLERANCE) {
        violations.push({
          type: 'door_clearance',
          objects: [p.placement_id, `${door.type}:${door.wall_id}`],
          severity: 'high',
          description: `${label(p)} blocks the ${door.type} on ${door.wall_id} (needs ${cm(DOOR_CLEARANCE)}cm clear in front).`,
          suggestion: `Keep the zone x∈[${zone.minX.toFixed(2)},${zone.maxX.toFixed(2)}], y∈[${zone.minY.toFixed(2)},${zone.maxY.toFixed(2)}] empty — move ${p.placement_id} elsewhere.`,
          measurements: {
            actual_cm: cm(Math.max(0, DOOR_CLEARANCE - Math.min(ox, oy))),
            required_cm: cm(DOOR_CLEARANCE),
          },
        });
      }
    }
  }

  // ── 5. Budget ──────────────────────────────────────────────────────────────
  checks_run.push('budget');
  const budgetLimit = plan.budget_summary?.budget_limit ?? Infinity;
  const budget = computeBudgetSummary(placements, catalog, budgetLimit);
  if (!budget.within_budget) {
    const over = budget.total - budgetLimit;
    const stretch = placements.filter((p) => p.priority === 'stretch').map((p) => p.placement_id);
    violations.push({
      type: 'over_budget',
      objects: stretch.length ? stretch : placements.map((p) => p.placement_id),
      severity: over > budgetLimit * 0.1 ? 'high' : 'medium',
      description: `Total $${budget.total} exceeds the $${budgetLimit} budget by $${over}.`,
      suggestion: budget.savings_suggestions[0] ?? 'Remove stretch items or choose cheaper products in the same category.',
    });
  }

  const blocking = violations.filter((v) => v.severity !== 'low');
  return {
    plan_id: plan.plan_id,
    status: blocking.length === 0 ? 'pass' : 'fail',
    checks_run,
    violations,
    placements,
    iteration,
    auto_fixed,
  };
}
