export interface Dimensions3D {
  width: number;
  depth: number;
  height: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  dimensions: Dimensions3D;
  color: string;
  styleTags: string[];
  ikeaUrl: string;
  imageUrl: string;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  start: Point2D;
  end: Point2D;
  hasWindow: boolean;
  hasDoor: boolean;
}

export interface Opening {
  type: 'door' | 'window' | 'archway';
  wall_id: string;
  /** Center of the opening on the floor plan, in meters. */
  position: Point2D;
  width: number;
  height: number;
  swing_direction: 'inward' | 'outward' | 'none' | string;
  /** Height of the bottom edge above the floor (windows). */
  sill_height?: number;
}

export interface RoomLayout {
  room_id: string;
  room_type: string;
  /** Meters. Width runs along X, length along Y (floor plan) / Z (3D). */
  dimensions: { width: number; length: number; height: number };
  walls: Wall[];
  openings: Opening[];
  existing_furniture: any[];
  natural_light: 'low' | 'medium' | 'high' | string;
  floor_type: string;
}

export type Priority = 'must-have' | 'nice-to-have' | 'stretch';

export interface Placement {
  placement_id: string;
  product_id: string;
  product_name: string;
  category: string;
  /** CENTER of the piece in meters. x along width, y along length, z = elevation (usually 0). */
  position: { x: number; y: number; z: number };
  /** Degrees: 0 / 90 / 180 / 270. */
  rotation: number;
  priority: Priority;
  reasoning: string;
}

export interface BudgetSummary {
  total: number;
  budget_limit: number;
  within_budget: boolean;
  by_priority: { must_have: number; nice_to_have: number; stretch: number };
  savings_suggestions: string[];
}

export interface DesignPlan {
  plan_id: string;
  room_id: string;
  style: string;
  placements: Placement[];
  budget_summary: BudgetSummary;
  style_summary: string;
}

export interface Violation {
  type: string;
  objects: string[];
  severity: 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
  measurements?: { actual_cm: number; required_cm: number };
}

export interface VerifiedPlan {
  plan_id: string;
  status: 'pass' | 'fail';
  checks_run: string[];
  violations: Violation[];
  placements: Placement[];
  iteration: number;
  auto_fixed: string[];
}

export interface AgentStep {
  agent: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  message?: string;
  /** Number of violations reported by the verifier on its last run. */
  violationCount?: number;
  /** Current attempt (1-based) when the designer/verifier loop retries. */
  attempt?: number;
  maxAttempts?: number;
}

export interface Priorities {
  mustHave: string[];
  niceToHave: string[];
  stretch: string[];
}

/** Server-sent event payloads emitted by /api/pipeline. */
export type PipelineEvent =
  | { type: 'step'; steps: AgentStep[] }
  | { type: 'room'; roomLayout: RoomLayout }
  | { type: 'plan'; designPlan: DesignPlan; verifiedPlan: VerifiedPlan }
  | { type: 'result'; roomLayout: RoomLayout; designPlan: DesignPlan; verifiedPlan: VerifiedPlan }
  | { type: 'error'; message: string };
