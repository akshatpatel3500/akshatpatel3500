import { NextResponse } from 'next/server';
import { runDesigner } from '@/lib/agents';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.roomLayout) throw new Error('roomLayout is required');
    const { designPlan, agentStatus, usedFallback } = await runDesigner({
      roomLayout: body.roomLayout,
      style: body.style ?? 'Modern Minimalist',
      budget: Number(body.budget) || 2000,
      priorities: body.priorities ?? { mustHave: [], niceToHave: [], stretch: [] },
      violations: body.violations,
      refinement: body.refinement,
      previousPlan: body.previousPlan,
    });
    return NextResponse.json({ designPlan, agentStatus, usedFallback });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, agentStatus: { agent: 'Designer', status: 'error', message: (err as Error).message } },
      { status: 400 },
    );
  }
}
