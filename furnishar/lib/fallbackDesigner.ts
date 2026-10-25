/**
 * Deterministic layout engine used when Argon is unavailable (no API key,
 * network failure, unparseable output). It picks products by style + budget
 * and greedily searches positions, using the verifier itself as the oracle so
 * every piece it places is collision-free and clear of doors.
 */
import { computeBudgetSummary, footprint, verifyDesign } from './verification';
import type { DesignPlan, Placement, Priorities, Priority, Product, RoomLayout } from './types';

export const STYLE_KEYWORDS: Record<string, string[]> = {
  'Modern Minimalist': ['modern', 'minimalist', 'neutral', 'simple'],
  'Cozy Scandinavian': ['scandinavian', 'natural', 'wood', 'comfortable', 'classic'],
  Industrial: ['industrial', 'dark', 'functional'],
  Bohemian: ['boho', 'natural', 'comfortable', 'plush'],
  'Mid-Century Modern': ['wood', 'classic', 'elegant', 'premium', 'modern'],
  'Japanese Zen': ['minimalist', 'natural', 'simple', 'neutral'],
};

const WALL_HUGGERS = new Set(['sofa', 'desk', 'bookshelf']);

/** Rough share of the budget each category "deserves" — used to spend generous budgets sensibly. */
const BUDGET_SHARE: Record<string, number> = {
  sofa: 0.35,
  desk: 0.2,
  chair: 0.12,
  coffee_table: 0.1,
  bookshelf: 0.08,
  rug: 0.08,
  lamp: 0.04,
};

/** Map common refinement phrasing onto catalog style tags. */
const REFINEMENT_SYNONYMS: Record<string, string[]> = {
  cozy: ['comfortable', 'plush', 'natural'],
  cosy: ['comfortable', 'plush', 'natural'],
  warm: ['wood', 'natural', 'comfortable'],
  cheap: ['budget'],
  cheaper: ['budget'],
  affordable: ['budget'],
  work: ['office', 'ergonomic', 'adjustable'],
  office: ['office', 'ergonomic', 'adjustable'],
  bright: ['modern', 'simple'],
  luxury: ['premium', 'elegant', 'statement'],
  fancy: ['premium', 'elegant', 'statement'],
};

function styleScore(product: Product, style: string, refinement = ''): number {
  const styleTags = STYLE_KEYWORDS[style] ?? [];
  const refWords = refinement.toLowerCase().split(/\W+/).filter(Boolean);
  const refTags = new Set([...refWords, ...refWords.flatMap((w) => REFINEMENT_SYNONYMS[w] ?? [])]);
  // Refinement matches weigh double so "make it cozier" visibly changes the picks.
  return product.styleTags.reduce(
    (n, t) => n + (styleTags.includes(t) ? 1 : 0) + (refTags.has(t) ? 2 : 0),
    0,
  );
}

function chooseProducts(
  catalog: Product[],
  priorities: Priorities,
  style: string,
  budget: number,
  refinement?: string,
): Array<{ product: Product; priority: Priority }> {
  const ordered: Array<{ category: string; priority: Priority }> = [
    ...priorities.mustHave.map((c) => ({ category: c, priority: 'must-have' as const })),
    ...priorities.niceToHave.map((c) => ({ category: c, priority: 'nice-to-have' as const })),
    ...priorities.stretch.map((c) => ({ category: c, priority: 'stretch' as const })),
  ];
  // Reserve the cheapest option for every must-have so early picks can't starve later ones.
  const cheapest = (cat: string) =>
    Math.min(...catalog.filter((p) => p.category === cat).map((p) => p.price), Infinity);
  let remaining = budget;
  let reserved = priorities.mustHave.reduce((s, c) => s + (Number.isFinite(cheapest(c)) ? cheapest(c) : 0), 0);

  const picks: Array<{ product: Product; priority: Priority }> = [];
  for (const { category, priority } of ordered) {
    const options = catalog
      .filter((p) => p.category === category)
      .sort((a, b) => {
        const target = budget * (BUDGET_SHARE[category] ?? 0.1);
        return (
          styleScore(b, style, refinement) - styleScore(a, style, refinement) ||
          Math.abs(a.price - target) - Math.abs(b.price - target)
        );
      });
    if (!options.length) continue;
    const ownReserve = priority === 'must-have' ? cheapest(category) : 0;
    const allowance = remaining - (reserved - ownReserve);
    let pick = options.find((p) => p.price <= allowance);
    if (!pick && priority === 'must-have') pick = options.reduce((a, b) => (a.price <= b.price ? a : b));
    if (priority === 'must-have') reserved -= ownReserve;
    if (!pick) continue;
    remaining -= pick.price;
    picks.push({ product: pick, priority });
  }
  return picks;
}

interface Candidate {
  x: number;
  y: number;
  rotation: number;
  score: number;
}

function candidatesFor(
  product: Product,
  room: RoomLayout,
  placed: Placement[],
  catalog: Product[],
): Candidate[] {
  const { width: W, length: L } = room.dimensions;
  const find = (cat: string) => placed.find((p) => p.category === cat);
  const prod = (p: Placement) => catalog.find((c) => c.id === p.product_id)!;
  const window = room.openings.find((o) => o.type === 'window');
  const door = room.openings.find((o) => o.type === 'door');
  const out: Candidate[] = [];
  const step = 0.05;

  // Wall-hugging pieces: back flush to a wall, slide along it.
  if (WALL_HUGGERS.has(product.category)) {
    const walls = [
      { rot: 0, fixed: 'y', at: (d: number) => d / 2, len: W },
      { rot: 180, fixed: 'y', at: (d: number) => L - d / 2, len: W },
      { rot: 90, fixed: 'x', at: (d: number) => d / 2, len: L },
      { rot: 270, fixed: 'x', at: (d: number) => W - d / 2, len: L },
    ];
    for (const wall of walls) {
      const { w, d } = footprint(product, wall.rot);
      const along = wall.fixed === 'y' ? w : d;
      const across = wall.fixed === 'y' ? d : w;
      for (let s = along / 2; s <= wall.len - along / 2 + 1e-6; s += step) {
        const x = wall.fixed === 'y' ? s : wall.at(across);
        const y = wall.fixed === 'y' ? wall.at(across) : s;
        let score = 0;
        if (product.category === 'sofa') {
          // Long wall, centered, far from the door.
          score = Math.abs(s - wall.len / 2) - wall.len * 0.5;
          if (door) score -= Math.hypot(x - door.position.x, y - door.position.y) * 0.5;
        } else if (product.category === 'desk') {
          // Near natural light.
          score = window ? Math.hypot(x - window.position.x, y - window.position.y) : 0;
        } else {
          // Shelves: corners, away from the sofa.
          score = Math.min(s, wall.len - s);
          const sofa = find('sofa');
          if (sofa) score -= Math.hypot(x - sofa.position.x, y - sofa.position.y) * 0.3;
        }
        out.push({ x, y, rotation: wall.rot, score });
      }
    }
    return out;
  }

  // Free-standing pieces: grid search around a category-specific target.
  const sofa = find('sofa');
  const desk = find('desk');
  let target = { x: W / 2, y: L / 2 };
  let preferredRot = 0;
  const facing = (p: Placement) => {
    const r = p.rotation;
    return r === 0 ? { x: 0, y: 1 } : r === 180 ? { x: 0, y: -1 } : r === 90 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  };
  if (sofa && ['rug', 'coffee_table'].includes(product.category)) {
    const f = facing(sofa);
    const sd = prod(sofa).dimensions.depth;
    const offset = product.category === 'rug' ? sd / 2 + 0.6 : sd / 2 + 0.45 + product.dimensions.depth / 2;
    target = { x: sofa.position.x + f.x * offset, y: sofa.position.y + f.y * offset };
    preferredRot = product.category === 'rug' ? (sofa.rotation + 90) % 180 : sofa.rotation % 180;
  } else if (product.category === 'chair' && desk && product.styleTags.includes('office')) {
    const f = facing(desk);
    const off = prod(desk).dimensions.depth / 2 + product.dimensions.depth / 2 - 0.15;
    target = { x: desk.position.x + f.x * off, y: desk.position.y + f.y * off };
    preferredRot = (desk.rotation + 180) % 360;
  } else if (product.category === 'chair' && sofa) {
    const f = facing(sofa);
    target = { x: sofa.position.x + f.x * 1.6 + f.y * 1.2, y: sofa.position.y + f.y * 1.6 + f.x * 1.2 };
  } else if (product.category === 'lamp') {
    const anchor = sofa ?? desk;
    if (anchor) {
      const { w } = footprint(prod(anchor), anchor.rotation);
      target = { x: anchor.position.x + w / 2 + 0.25, y: anchor.position.y };
    }
  }

  for (const rotation of [0, 90, 180, 270]) {
    const { w, d } = footprint(product, rotation);
    for (let x = w / 2; x <= W - w / 2 + 1e-6; x += step) {
      for (let y = d / 2; y <= L - d / 2 + 1e-6; y += step) {
        const score = Math.hypot(x - target.x, y - target.y) + (rotation === preferredRot ? 0 : 0.15);
        out.push({ x, y, rotation, score });
      }
    }
  }
  return out;
}

export function fallbackDesign(opts: {
  roomLayout: RoomLayout;
  style: string;
  budget: number;
  priorities: Priorities;
  catalog: Product[];
  refinement?: string;
}): DesignPlan {
  const { roomLayout, style, budget, priorities, catalog, refinement } = opts;
  const picks = chooseProducts(catalog, priorities, style, budget, refinement);
  // Big wall-huggers first so the free-standing pieces can anchor to them.
  const order = ['sofa', 'desk', 'bookshelf', 'rug', 'coffee_table', 'chair', 'lamp'];
  picks.sort((a, b) => order.indexOf(a.product.category) - order.indexOf(b.product.category));

  const placements: Placement[] = [];
  const probePlan = (ps: Placement[]): DesignPlan => ({
    plan_id: 'probe',
    room_id: roomLayout.room_id,
    style,
    placements: ps,
    budget_summary: computeBudgetSummary(ps, catalog, Infinity),
    style_summary: '',
  });

  picks.forEach(({ product, priority }, i) => {
    const id = `p${i + 1}`;
    const candidates = candidatesFor(product, roomLayout, placements, catalog).sort((a, b) => a.score - b.score);
    for (const c of candidates) {
      const candidate: Placement = {
        placement_id: id,
        product_id: product.id,
        product_name: product.name,
        category: product.category,
        position: { x: +c.x.toFixed(3), y: +c.y.toFixed(3), z: 0 },
        rotation: c.rotation,
        priority,
        reasoning: '',
      };
      const result = verifyDesign(roomLayout, probePlan([...placements, candidate]), catalog);
      const blocked = result.violations.some((v) => v.objects.includes(id) && v.type !== 'over_budget');
      if (!blocked) {
        candidate.reasoning = reasonFor(product, style);
        placements.push(candidate);
        break;
      }
    }
  });

  return {
    plan_id: `plan-${Date.now().toString(36)}`,
    room_id: roomLayout.room_id,
    style,
    placements,
    budget_summary: computeBudgetSummary(placements, catalog, budget),
    style_summary: `A ${style.toLowerCase()} layout anchored by the ${placements[0]?.product_name ?? 'main piece'}, keeping walkways and the doorway clear.`,
  };
}

function reasonFor(product: Product, style: string): string {
  const tags = product.styleTags.slice(0, 2).join(', ');
  switch (product.category) {
    case 'sofa':
      return `Anchors the room against a long wall; ${tags} fits ${style}.`;
    case 'desk':
      return 'Placed near the window for natural light while working.';
    case 'bookshelf':
      return 'Tucked against a wall to add storage without eating floor space.';
    case 'rug':
      return 'Defines the seating zone in front of the sofa.';
    case 'coffee_table':
      return 'Within easy reach of the sofa, leaving a comfortable gap.';
    case 'chair':
      return product.styleTags.includes('office') ? 'Pulled up to the desk.' : 'Adds a conversational seat facing the sofa.';
    case 'lamp':
      return 'Adds warm layered lighting beside the main seating.';
    default:
      return `Matches the ${style} palette (${tags}).`;
  }
}
