/**
 * The three FurnishAR agents. API routes and the pipeline orchestrator share
 * these so the standalone endpoints and the streamed pipeline behave the same.
 */
import { callArgon, extractJson, hasArgonKey } from './argon';
import { fallbackDesign } from './fallbackDesigner';
import { products as catalog } from './products';
import { buildRectangularRoom } from './room';
import { computeBudgetSummary, normalizeRotation, verifyDesign } from './verification';
import type {
  AgentStep,
  DesignPlan,
  Placement,
  Priorities,
  Product,
  RoomLayout,
  VerifiedPlan,
  Violation,
} from './types';

export const AGENT_NAMES = {
  analyzer: 'Room Analyzer',
  designer: 'Designer',
  verifier: 'Verifier',
} as const;

// ── Agent 1: Room Analyzer ───────────────────────────────────────────────────

const ANALYZER_PROMPT = `You are a room analyzer. Convert the user's description of a room into a room_layout JSON object.
Use meters. Coordinate system: origin (0,0) is the top-left corner of the floor plan, x along width, y along length.
Walls: "wall-north" (y=0), "wall-east" (x=width), "wall-south" (y=length), "wall-west" (x=0).
Return ONLY JSON matching:
{"room_id": string, "room_type": string, "dimensions": {"width": number, "length": number, "height": number},
 "walls": [{"id": string, "start": {"x","y"}, "end": {"x","y"}, "hasWindow": boolean, "hasDoor": boolean}],
 "openings": [{"type": "door"|"window"|"archway", "wall_id": string, "position": {"x","y"}, "width": number, "height": number, "swing_direction": "inward"|"outward"|"none"}],
 "existing_furniture": [], "natural_light": "low"|"medium"|"high", "floor_type": string}`;

export async function runAnalyzer(input: {
  dimensions: { width: number; length: number; height: number };
  roomType: string;
  description?: string;
}): Promise<{ roomLayout: RoomLayout; agentStatus: AgentStep }> {
  const { dimensions, roomType, description } = input;
  if (!dimensions || !(dimensions.width > 0) || !(dimensions.length > 0) || !(dimensions.height > 0)) {
    throw new Error('Room dimensions must be positive numbers');
  }
  const manual = buildRectangularRoom(dimensions, roomType);

  // Manual dimensions → deterministic rectangle, no LLM needed.
  if (!description?.trim() || !hasArgonKey()) {
    return {
      roomLayout: manual,
      agentStatus: {
        agent: AGENT_NAMES.analyzer,
        status: 'complete',
        message: `${dimensions.width.toFixed(2)}m × ${dimensions.length.toFixed(2)}m ${roomType.replace('_', ' ')} · 1 door, 1 window`,
      },
    };
  }

  try {
    const text = await callArgon(
      ANALYZER_PROMPT,
      `Room type: ${roomType}\nDimensions (m): ${JSON.stringify(dimensions)}\nDescription: ${description}`,
    );
    const parsed = extractJson<RoomLayout>(text);
    const roomLayout: RoomLayout = {
      ...manual,
      ...parsed,
      room_id: parsed.room_id || manual.room_id,
      dimensions: parsed.dimensions ?? manual.dimensions,
      walls: parsed.walls?.length ? parsed.walls : manual.walls,
      openings: parsed.openings ?? manual.openings,
    };
    return {
      roomLayout,
      agentStatus: {
        agent: AGENT_NAMES.analyzer,
        status: 'complete',
        message: `Parsed ${roomLayout.openings.length} openings with Argon`,
      },
    };
  } catch (err) {
    return {
      roomLayout: manual,
      agentStatus: {
        agent: AGENT_NAMES.analyzer,
        status: 'complete',
        message: `Argon parse failed (${(err as Error).message}); used rectangular room`,
      },
    };
  }
}

// ── Agent 2: Designer ────────────────────────────────────────────────────────

const DESIGNER_PROMPT = `You are a room designer. Given room dimensions and a product catalog, create a design_plan JSON placing furniture. Position is CENTER of piece in meters. Rotation: 0/90/180/270 degrees. Respect budget, prioritize must-have items. If violations are provided, fix them.

Coordinate system: origin (0,0) is the top-left floor corner; x runs along room width, y along room length; z is always 0.
A product's footprint is width (x) × depth (y) at rotation 0/180, and depth (x) × width (y) at rotation 90/270.
Facing: rotation 0 = back against the north wall (y=0) facing +y; 180 = back against the south wall (y=length); 90 = back against the west wall (x=0); 270 = back against the east wall (x=width).
Hard rules (a deterministic verifier will check them):
- Every footprint must lie inside the room.
- Non-rug furniture must not overlap (a desk chair may tuck under its desk).
- Leave at least 0.60m between non-rug pieces, or push them flush together. Lamps, chair+desk, coffee_table+sofa and coffee_table+chair are exempt.
- Keep 0.80m clear in front of every door, across the door's full width.
- Total price must not exceed the budget. Drop stretch items before nice-to-have items.
Only use product_id values from the catalog. Use at most one product per requested category unless asked otherwise.

Return ONLY JSON matching:
{"plan_id": string, "room_id": string, "style": string,
 "placements": [{"placement_id": string, "product_id": string, "product_name": string, "category": string,
   "position": {"x": number, "y": number, "z": 0}, "rotation": 0|90|180|270,
   "priority": "must-have"|"nice-to-have"|"stretch", "reasoning": string}],
 "budget_summary": {"total": number, "budget_limit": number, "within_budget": boolean,
   "by_priority": {"must_have": number, "nice_to_have": number, "stretch": number}, "savings_suggestions": string[]},
 "style_summary": string}`;

export interface DesignInput {
  roomLayout: RoomLayout;
  style: string;
  budget: number;
  priorities: Priorities;
  violations?: Violation[];
  refinement?: string;
  previousPlan?: DesignPlan | null;
}

function compactCatalog(list: Product[]) {
  return list.map(({ id, name, category, price, dimensions, styleTags }) => ({
    id,
    name,
    category,
    price,
    dimensions,
    styleTags,
  }));
}

/** Coerce whatever the model returned into a well-formed DesignPlan. */
function normalizePlan(raw: Partial<DesignPlan>, input: DesignInput): DesignPlan {
  const placements: Placement[] = (Array.isArray(raw.placements) ? raw.placements : []).map((p, i) => {
    const product = catalog.find((c) => c.id === p.product_id);
    return {
      placement_id: p.placement_id || `p${i + 1}`,
      product_id: p.product_id,
      product_name: product?.name ?? p.product_name ?? p.product_id,
      category: product?.category ?? p.category ?? 'unknown',
      position: { x: Number(p.position?.x) || 0, y: Number(p.position?.y) || 0, z: 0 },
      rotation: normalizeRotation(p.rotation),
      priority: p.priority ?? 'nice-to-have',
      reasoning: p.reasoning ?? '',
    };
  });
  return {
    plan_id: raw.plan_id || `plan-${Date.now().toString(36)}`,
    room_id: input.roomLayout.room_id,
    style: raw.style || input.style,
    placements,
    // Never trust LLM arithmetic — recompute from the catalog.
    budget_summary: {
      ...computeBudgetSummary(placements, catalog, input.budget),
      savings_suggestions: raw.budget_summary?.savings_suggestions?.length
        ? raw.budget_summary.savings_suggestions
        : computeBudgetSummary(placements, catalog, input.budget).savings_suggestions,
    },
    style_summary: raw.style_summary || '',
  };
}

export async function runDesigner(
  input: DesignInput,
): Promise<{ designPlan: DesignPlan; agentStatus: AgentStep; usedFallback: boolean }> {
  const { roomLayout, style, budget, priorities, violations, refinement, previousPlan } = input;

  const userPrompt = [
    `ROOM_LAYOUT:\n${JSON.stringify(roomLayout)}`,
    `PRODUCT_CATALOG:\n${JSON.stringify(compactCatalog(catalog))}`,
    `PREFERENCES:\n${JSON.stringify({ style, budget_limit: budget, priorities })}`,
    previousPlan ? `PREVIOUS_PLAN:\n${JSON.stringify(previousPlan)}` : '',
    violations?.length
      ? `VIOLATIONS_TO_FIX (from the verifier — fix every one, keep everything else stable):\n${JSON.stringify(violations)}`
      : '',
    refinement ? `USER_REFINEMENT_REQUEST: "${refinement}" — adjust the previous plan accordingly.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (hasArgonKey()) {
    try {
      const text = await callArgon(DESIGNER_PROMPT, userPrompt);
      const designPlan = normalizePlan(extractJson<Partial<DesignPlan>>(text), input);
      if (!designPlan.placements.length) throw new Error('Argon returned no placements');
      return {
        designPlan,
        usedFallback: false,
        agentStatus: {
          agent: AGENT_NAMES.designer,
          status: 'complete',
          message: `Argon placed ${designPlan.placements.length} pieces · $${designPlan.budget_summary.total}`,
        },
      };
    } catch (err) {
      console.error('[designer] Argon failed, using fallback layout engine:', err);
      const designPlan = fallbackDesign({ roomLayout, style, budget, priorities, catalog, refinement });
      return {
        designPlan,
        usedFallback: true,
        agentStatus: {
          agent: AGENT_NAMES.designer,
          status: 'complete',
          message: `Argon error (${(err as Error).message.slice(0, 80)}) — fallback engine placed ${designPlan.placements.length} pieces`,
        },
      };
    }
  }

  const designPlan = fallbackDesign({ roomLayout, style, budget, priorities, catalog, refinement });
  return {
    designPlan,
    usedFallback: true,
    agentStatus: {
      agent: AGENT_NAMES.designer,
      status: 'complete',
      message: `No GEMINI_API_KEY — offline layout engine placed ${designPlan.placements.length} pieces`,
    },
  };
}

// ── Agent 3: Verifier (pure code) ────────────────────────────────────────────

export function runVerifier(
  roomLayout: RoomLayout,
  designPlan: DesignPlan,
  products: Product[] = catalog,
  iteration = 1,
): { verifiedPlan: VerifiedPlan; agentStatus: AgentStep } {
  const verifiedPlan = verifyDesign(roomLayout, designPlan, products, iteration);
  const n = verifiedPlan.violations.length;
  return {
    verifiedPlan,
    agentStatus: {
      agent: AGENT_NAMES.verifier,
      status: verifiedPlan.status === 'pass' ? 'complete' : 'error',
      violationCount: n,
      message:
        verifiedPlan.status === 'pass'
          ? `All ${verifiedPlan.checks_run.length} checks passed${verifiedPlan.auto_fixed.length ? ` · ${verifiedPlan.auto_fixed.length} auto-fixed` : ''}`
          : `${n} violation${n === 1 ? '' : 's'}: ${[...new Set(verifiedPlan.violations.map((v) => v.type))].join(', ')}`,
    },
  };
}
