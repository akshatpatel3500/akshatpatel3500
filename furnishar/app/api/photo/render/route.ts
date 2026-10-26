import { NextResponse } from 'next/server';
import { editImage, hasArgonKey } from '@/lib/argon';
import { buildRenderPrompt, type FreeZone } from '@/lib/photo';
import { products } from '@/lib/products';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/** Agent 4: Visualizer — draws one product into the (possibly already edited) room photo. */
export async function POST(req: Request) {
  try {
    if (!hasArgonKey()) throw new Error('Photo mode needs GEMINI_API_KEY in .env.local');
    const { image, productId, zone, placementHint = '', scaleReference = '' } = (await req.json()) as {
      image: string;
      productId: string;
      zone: FreeZone;
      placementHint?: string;
      scaleReference?: string;
    };
    const product = products.find((p) => p.id === productId);
    if (!product) throw new Error(`Unknown product "${productId}"`);
    if (!zone?.bbox) throw new Error('zone is required');

    const prompt = buildRenderPrompt(product, zone, placementHint, scaleReference);
    const rendered = await editImage(prompt, image);
    return NextResponse.json({ image: rendered });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 300) }, { status: 400 });
  }
}
