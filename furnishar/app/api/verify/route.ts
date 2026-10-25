import { NextResponse } from 'next/server';
import { runVerifier } from '@/lib/agents';
import { products as catalog } from '@/lib/products';

export const dynamic = 'force-dynamic';

// Agent 3 is deterministic TypeScript — no LLM involved.
export async function POST(req: Request) {
  try {
    const { roomLayout, designPlan, products, iteration } = await req.json();
    if (!roomLayout || !designPlan) throw new Error('roomLayout and designPlan are required');
    const result = runVerifier(roomLayout, designPlan, products?.length ? products : catalog, iteration ?? 1);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, agentStatus: { agent: 'Verifier', status: 'error', message: (err as Error).message } },
      { status: 400 },
    );
  }
}
