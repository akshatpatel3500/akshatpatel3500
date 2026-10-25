import { AGENT_NAMES, runAnalyzer, runDesigner, runVerifier } from '@/lib/agents';
import type { AgentStep, DesignPlan, PipelineEvent, VerifiedPlan } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_RETRIES = 2;
const MAX_ATTEMPTS = MAX_RETRIES + 1;

/**
 * Orchestrates Analyzer → Designer → Verifier, looping Designer ↔ Verifier
 * (with the verifier's violations as feedback) until the plan passes or we
 * run out of retries. Streams progress as Server-Sent Events.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PipelineEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const steps: AgentStep[] = [
        { agent: AGENT_NAMES.analyzer, status: 'pending' },
        { agent: AGENT_NAMES.designer, status: 'pending' },
        { agent: AGENT_NAMES.verifier, status: 'pending' },
      ];
      const update = (i: number, patch: Partial<AgentStep>) => {
        steps[i] = { ...steps[i], ...patch };
        send({ type: 'step', steps: steps.map((s) => ({ ...s })) });
      };

      try {
        // Agent 1
        update(0, { status: 'running', message: 'Mapping walls, doors and windows…' });
        const analyzed = await runAnalyzer({
          dimensions: body.dimensions,
          roomType: body.roomType ?? 'living_room',
          description: body.description,
        });
        await pause(400); // let the UI breathe so judges can see each agent hand off
        update(0, analyzed.agentStatus);
        send({ type: 'room', roomLayout: analyzed.roomLayout });

        let designPlan: DesignPlan | null = null;
        let verifiedPlan: VerifiedPlan | null = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const isRetry = attempt > 1;
          // Agent 2
          update(1, {
            status: 'running',
            attempt,
            maxAttempts: MAX_ATTEMPTS,
            message: isRetry
              ? `Fixing ${verifiedPlan!.violations.length} violation(s)…`
              : `Choosing ${body.style} pieces within $${body.budget}…`,
          });
          if (isRetry) update(2, { status: 'pending', attempt, maxAttempts: MAX_ATTEMPTS });

          const designed = await runDesigner({
            roomLayout: analyzed.roomLayout,
            style: body.style,
            budget: Number(body.budget),
            priorities: body.priorities,
            violations: verifiedPlan?.violations,
            previousPlan: designPlan,
          });
          designPlan = designed.designPlan;
          update(1, { ...designed.agentStatus, attempt, maxAttempts: MAX_ATTEMPTS });

          // Agent 3
          update(2, { status: 'running', attempt, maxAttempts: MAX_ATTEMPTS, message: 'Checking bounds, collisions, walkways, doors, budget…' });
          await pause(300);
          const verified = runVerifier(analyzed.roomLayout, designPlan, undefined, attempt);
          verifiedPlan = verified.verifiedPlan;
          update(2, { ...verified.agentStatus, attempt, maxAttempts: MAX_ATTEMPTS });
          send({ type: 'plan', designPlan, verifiedPlan });

          if (verifiedPlan.status === 'pass') break;
          // The offline engine is deterministic; re-running it can't change the outcome.
          if (designed.usedFallback) break;
        }

        send({ type: 'result', roomLayout: analyzed.roomLayout, designPlan: designPlan!, verifiedPlan: verifiedPlan! });
      } catch (err) {
        const running = steps.findIndex((s) => s.status === 'running');
        if (running !== -1) update(running, { status: 'error', message: (err as Error).message });
        send({ type: 'error', message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
