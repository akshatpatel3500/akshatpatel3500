import { NextResponse } from 'next/server';
import { runAnalyzer } from '@/lib/agents';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { dimensions, roomType = 'living_room', description } = await req.json();
    const result = await runAnalyzer({ dimensions, roomType, description });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, agentStatus: { agent: 'Room Analyzer', status: 'error', message: (err as Error).message } },
      { status: 400 },
    );
  }
}
