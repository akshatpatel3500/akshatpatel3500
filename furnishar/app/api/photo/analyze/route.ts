import { callArgon, callArgonWithImage, extractJson, hasArgonKey } from '@/lib/argon';
import {
  ANALYZER_PROMPT,
  PHOTO_DESIGNER_PROMPT,
  PHOTO_STEPS,
  checkFit,
  type FreeZone,
  type PhotoAnalysis,
  type PhotoEvent,
  type PhotoSuggestion,
} from '@/lib/photo';
import { products } from '@/lib/products';
import type { AgentStep } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
const positive = (n: unknown, fallback: number) => (Number(n) > 0 ? Number(n) : fallback);

function normalizeAnalysis(raw: Partial<PhotoAnalysis>): PhotoAnalysis {
  const zones: FreeZone[] = (Array.isArray(raw.free_zones) ? raw.free_zones : []).slice(0, 3).map((z, i) => {
    const [x0, y0, x1, y1] = (Array.isArray(z.bbox) ? z.bbox : [0, 0, 1, 1]).map(clamp01);
    return {
      id: z.id || `zone_${i + 1}`,
      label: z.label || `Space ${i + 1}`,
      bbox: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
      estimated_width_m: positive(z.estimated_width_m, 1),
      estimated_depth_m: positive(z.estimated_depth_m, 0.6),
      max_height_m: positive(z.max_height_m, 2.4),
      notes: z.notes || '',
    };
  });
  return {
    style: raw.style || 'unknown',
    palette: Array.isArray(raw.palette) ? raw.palette.slice(0, 6) : [],
    existing_items: Array.isArray(raw.existing_items) ? raw.existing_items : [],
    free_zones: zones,
    scale_reference: raw.scale_reference || '',
  };
}

/**
 * Photo pipeline: Room Analyzer (Argon vision) → Designer (Argon) → Verifier (code).
 * The Visualizer runs later, on demand, via /api/photo/render.
 */
export async function POST(req: Request) {
  const { image, budget = 500 } = await req.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PhotoEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const steps: AgentStep[] = PHOTO_STEPS.map((agent) => ({ agent, status: 'pending' }));
      const update = (i: number, patch: Partial<AgentStep>) => {
        steps[i] = { ...steps[i], ...patch };
        send({ type: 'step', steps: steps.map((s) => ({ ...s })) });
      };

      try {
        if (!hasArgonKey()) throw new Error('Photo mode needs GEMINI_API_KEY in .env.local');
        if (typeof image !== 'string' || !image.startsWith('data:image/')) throw new Error('Upload a photo first');

        // Agent 1: Room Analyzer (vision)
        update(0, { status: 'running', message: 'Looking for empty spaces and measuring them…' });
        const analysis = normalizeAnalysis(
          extractJson<Partial<PhotoAnalysis>>(
            await callArgonWithImage(ANALYZER_PROMPT, 'Analyze this room photo.', image),
          ),
        );
        if (!analysis.free_zones.length) throw new Error('No empty space found in this photo — try a wider shot');
        update(0, {
          status: 'complete',
          message: `${analysis.style} room · found ${analysis.free_zones.length} empty space${analysis.free_zones.length === 1 ? '' : 's'}`,
        });
        send({ type: 'analysis', analysis });

        // Agent 2: Designer
        update(1, { status: 'running', message: `Picking IKEA pieces that suit a ${analysis.style} room within $${budget}…` });
        const catalog = products.map(({ id, name, category, price, dimensions, styleTags, color }) => ({
          id, name, category, price, dimensions, styleTags, color,
        }));
        const designed = extractJson<{ suggestions?: Partial<PhotoSuggestion>[] }>(
          await callArgon(
            PHOTO_DESIGNER_PROMPT,
            `ROOM_ANALYSIS:\n${JSON.stringify(analysis)}\n\nPRODUCT_CATALOG:\n${JSON.stringify(catalog)}\n\nBUDGET: $${budget}`,
          ),
        );
        const raw = (designed.suggestions ?? []).filter(
          (s) => products.some((p) => p.id === s.product_id) && analysis.free_zones.some((z) => z.id === s.zone_id),
        );
        update(1, { status: 'complete', message: `Suggested ${raw.length} pieces across ${analysis.free_zones.length} space(s)` });

        // Agent 3: Verifier (deterministic)
        update(2, { status: 'running', message: 'Checking each piece against the measured space…' });
        const suggestions: PhotoSuggestion[] = raw.map((s) => {
          const product = products.find((p) => p.id === s.product_id)!;
          const zone = analysis.free_zones.find((z) => z.id === s.zone_id)!;
          return {
            zone_id: zone.id,
            product_id: product.id,
            reasoning: s.reasoning ?? '',
            placement_hint: s.placement_hint ?? '',
            fit: checkFit(product, zone),
          };
        });
        const rejected = suggestions.filter((s) => !s.fit.fits).length;
        update(2, {
          status: 'complete',
          violationCount: rejected,
          message: rejected
            ? `${suggestions.length - rejected} fit · ${rejected} too wide for the space (kept, flagged)`
            : `All ${suggestions.length} pieces fit their space`,
        });
        update(3, { status: 'pending', message: 'Pick a piece and click “See it in my room”' });

        send({ type: 'result', analysis, suggestions });
      } catch (err) {
        const running = steps.findIndex((s) => s.status === 'running');
        if (running !== -1) update(running, { status: 'error', message: (err as Error).message.slice(0, 200) });
        send({ type: 'error', message: (err as Error).message.slice(0, 300) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
