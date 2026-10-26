/**
 * Photo mode: upload a picture of a real room, get IKEA suggestions for its
 * empty spaces, and see them rendered into the photo.
 *
 * Agents: Room Analyzer (Argon vision) → Designer (Argon) → Verifier (this
 * file's `checkFit`, pure code) → Visualizer (Gemini image model).
 */
import type { AgentStep, Product } from './types';

export interface FreeZone {
  id: string;
  label: string;
  /** Normalized [x0, y0, x1, y1] box around the empty floor/wall area in the photo. */
  bbox: [number, number, number, number];
  /** Width along the wall, depth into the room, and height clearance, in meters (AI estimates). */
  estimated_width_m: number;
  estimated_depth_m: number;
  max_height_m: number;
  notes: string;
}

export interface PhotoAnalysis {
  style: string;
  palette: string[];
  existing_items: string[];
  free_zones: FreeZone[];
  scale_reference: string;
}

export interface FitResult {
  fits: boolean;
  /** Human-readable measurements, e.g. "68 cm wide in a 90 cm space". */
  summary: string;
  warnings: string[];
}

export interface PhotoSuggestion {
  zone_id: string;
  product_id: string;
  reasoning: string;
  placement_hint: string;
  fit: FitResult;
}

export type PhotoEvent =
  | { type: 'step'; steps: AgentStep[] }
  | { type: 'analysis'; analysis: PhotoAnalysis }
  | { type: 'result'; analysis: PhotoAnalysis; suggestions: PhotoSuggestion[] }
  | { type: 'error'; message: string };

/** What each product looks like, so the image model draws the real thing. */
export const PRODUCT_LOOKS: Record<string, string> = {
  'kivik-sofa': 'IKEA KIVIK 3-seat sofa: deep seat, soft beige Tibbleby fabric, wide padded armrests, short dark legs',
  'friheten-sleeper': 'IKEA FRIHETEN sleeper sectional with chaise: dark gray Skiftebo fabric, straight modern lines',
  'bekant-desk': 'IKEA BEKANT sit/stand desk: plain white rectangular top on white metal T-shaped legs',
  'lagkapten-desk': 'IKEA LAGKAPTEN/ADILS desk: white-stained oak-effect top on four slim white round legs',
  'micke-desk': 'IKEA MICKE compact desk: white, with a small drawer and a cable hole, white legs',
  'kallax-shelf': 'IKEA KALLAX shelf unit: white, 2 columns by 4 rows of square open cubes, thick flat panels',
  'billy-bookcase': 'IKEA BILLY bookcase: white, tall and narrow, five open adjustable shelves',
  'tiphede-rug': 'IKEA TIPHEDE flatwoven rug: natural off-white cotton with a subtle woven texture',
  'stoense-rug': 'IKEA STOENSE low-pile rug: plain medium gray, soft and solid colored',
  'tertial-lamp': 'IKEA TERTIAL work lamp: dark gray metal, adjustable jointed arm, small conical shade',
  'hektar-lamp': 'IKEA HEKTAR floor lamp: dark gray metal, tall thin stand, large industrial dome shade',
  'lack-table': 'IKEA LACK side table: white, square 55 x 55 cm top, thick square legs',
  'listerby-table': 'IKEA LISTERBY coffee table: oak veneer, rectangular top, slim tapered wooden legs',
  'stockholm-table': 'IKEA STOCKHOLM coffee table: walnut veneer, long low oval top, wooden legs',
  'markus-chair': 'IKEA MARKUS office chair: black mesh high back with headrest, swivel base on casters',
  'poang-chair':
    'IKEA POÄNG armchair: bentwood birch-veneer cantilever frame, light beige cushion, curved arms',
};

export const PHOTO_STEPS = ['Room Analyzer', 'Designer', 'Verifier', 'Visualizer'] as const;

const WIDTH_TOLERANCE = 0.03; // 3cm

function cm(m: number): number {
  return Math.round(m * 100);
}

/**
 * Deterministic fit check of a product against a zone (Agent 3 in photo mode).
 * Width along the wall is the hard constraint; depth and height are warnings,
 * since an open floor area can usually take a piece that sticks out a little.
 */
export function checkFit(product: Product, zone: FreeZone): FitResult {
  const { width, depth, height } = product.dimensions;
  const W = zone.estimated_width_m;
  const D = zone.estimated_depth_m;
  // Try the piece both ways round; prefer the orientation that fits the width.
  const across = width <= W + WIDTH_TOLERANCE ? width : Math.min(width, depth);
  const into = across === width ? depth : width;
  const fits = across <= W + WIDTH_TOLERANCE;
  const warnings: string[] = [];

  if (fits && into > D + 0.1) {
    warnings.push(`Sticks out ${cm(into - D)} cm past the open area into the room`);
  }
  if (zone.max_height_m > 0 && height > zone.max_height_m + 0.05) {
    warnings.push(`${cm(height)} cm tall — above the ${cm(zone.max_height_m)} cm clearance (e.g. a lamp shade or window)`);
  }
  if (fits && W - across < 0.1) warnings.push('Tight fit — measure before buying');

  const summary = fits
    ? `${cm(across)} cm wide in a ${cm(W)} cm space${across !== width ? ' (turned sideways)' : ''}`
    : `Too wide: ${cm(across)} cm for a ${cm(W)} cm space`;
  return { fits, summary, warnings };
}

// ── Prompts ──────────────────────────────────────────────────────────────────

export const ANALYZER_PROMPT = `You are a room analyzer for an interior-design app. Look at the photo of a real room.
Find up to 3 EMPTY areas where new furniture could realistically go (open floor along a wall, an empty corner, open floor in front of seating).
For each, give a normalized bounding box [x0, y0, x1, y1] (0-1, origin top-left) around the empty floor footprint in the image,
and estimate its real size in meters using reference objects (wall outlets are ~11.4 cm tall, light switches ~11.4 cm,
baseboards ~8-12 cm, interior doors ~203 cm tall, common TV sizes). Note obstacles (outlets, cables, routers, lamp shades overhead, windows).
Return ONLY JSON:
{"style": string, "palette": [hex], "existing_items": [string],
 "free_zones": [{"id": "zone_1", "label": string, "bbox": [x0,y0,x1,y1], "estimated_width_m": number,
   "estimated_depth_m": number, "max_height_m": number (clearance; use 2.4 if nothing overhead), "notes": string}],
 "scale_reference": string}`;

export const PHOTO_DESIGNER_PROMPT = `You are an interior designer. You get an analysis of a real room photo, a product catalog with exact dimensions (meters), and a budget.
Suggest products for each free zone that (1) physically fit the zone's estimated width, (2) suit the room's style, palette and existing furniture,
(3) make sense for the spot (e.g. don't put a tall bookcase under a lamp shade or a desk where there is no room to sit), and (4) keep the total of the top pick per zone within budget.
Give 2-3 ranked options per zone, best first. Only use product_id values from the catalog.
Return ONLY JSON: {"suggestions": [{"zone_id": string, "product_id": string, "reasoning": string (1-2 friendly sentences that mention the room's existing items; describe colors in words, never hex codes),
 "placement_hint": string (where exactly in the zone and which way it faces)}]}`;

function describeRegion([x0, y0, x1, y1]: FreeZone['bbox']): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `the area spanning ${pct(x0)}–${pct(x1)} of the image width and ${pct(y0)}–${pct(y1)} of its height`;
}

export function buildRenderPrompt(
  product: Product,
  zone: FreeZone,
  placementHint: string,
  scaleReference: string,
): string {
  const { width, depth, height } = product.dimensions;
  const look = PRODUCT_LOOKS[product.id] ?? `IKEA ${product.name} ${product.category.replace('_', ' ')}`;
  return [
    'Edit this photo of a real room. Add exactly ONE new piece of furniture and change nothing else.',
    `Furniture: ${look}. Real size: ${cm(width)} cm wide × ${cm(depth)} cm deep × ${cm(height)} cm tall.`,
    `Where: ${zone.label} — ${describeRegion(zone.bbox)}. ${placementHint}`.trim(),
    `Scale it correctly relative to the existing objects (${scaleReference}). It must stand on the floor with realistic contact shadows.`,
    'Keep the camera angle, framing, lighting, walls, floor and every existing object exactly the same. Photorealistic.',
  ].join('\n');
}
