'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AgentStep,
  DesignPlan,
  PipelineEvent,
  Priorities,
  RoomLayout,
  VerifiedPlan,
} from '@/lib/types';

export interface DesignRequest {
  dimensions: { width: number; length: number; height: number };
  roomType: string;
  style: string;
  budget: number;
  priorities: Priorities;
}

interface DesignState {
  request: DesignRequest | null;
  roomLayout: RoomLayout | null;
  designPlan: DesignPlan | null;
  verifiedPlan: VerifiedPlan | null;
  agentSteps: AgentStep[];
  isRunning: boolean;
  error: string | null;
  log: string[];
}

interface DesignContextValue extends DesignState {
  runPipeline: (request: DesignRequest) => Promise<void>;
  refine: (text: string) => Promise<void>;
}

const INITIAL_STEPS: AgentStep[] = [
  { agent: 'Room Analyzer', status: 'pending' },
  { agent: 'Designer', status: 'pending' },
  { agent: 'Verifier', status: 'pending' },
];

const EMPTY: DesignState = {
  request: null,
  roomLayout: null,
  designPlan: null,
  verifiedPlan: null,
  agentSteps: INITIAL_STEPS,
  isRunning: false,
  error: null,
  log: [],
};

const STORAGE_KEY = 'furnishar:state';
const MAX_REFINE_ATTEMPTS = 3;

const DesignContext = createContext<DesignContextValue | null>(null);

export function DesignProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DesignState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Restore the last design so refreshing /design or /review keeps working.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setState({ ...EMPTY, ...JSON.parse(saved), isRunning: false });
    } catch {
      // ignore unavailable/corrupt storage
    }
  }, []);

  useEffect(() => {
    if (state.isRunning) return;
    try {
      const { request, roomLayout, designPlan, verifiedPlan, agentSteps } = state;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ request, roomLayout, designPlan, verifiedPlan, agentSteps }));
    } catch {
      // ignore
    }
  }, [state]);

  const patch = (p: Partial<DesignState> | ((s: DesignState) => Partial<DesignState>)) =>
    setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));

  const runPipeline = useCallback(async (request: DesignRequest) => {
    setState({ ...EMPTY, request, isRunning: true, agentSteps: INITIAL_STEPS });
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok || !res.body) throw new Error(`Pipeline failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as PipelineEvent;
          switch (event.type) {
            case 'step':
              patch((s) => ({
                agentSteps: event.steps,
                log: [
                  ...s.log,
                  ...event.steps
                    .filter((st, i) => st.message && st.message !== s.agentSteps[i]?.message)
                    .map((st) => `${st.agent}: ${st.message}`),
                ],
              }));
              break;
            case 'room':
              patch({ roomLayout: event.roomLayout });
              break;
            case 'plan':
              patch({ designPlan: event.designPlan, verifiedPlan: event.verifiedPlan });
              break;
            case 'result':
              patch({ roomLayout: event.roomLayout, designPlan: event.designPlan, verifiedPlan: event.verifiedPlan });
              break;
            case 'error':
              patch({ error: event.message });
              break;
          }
        }
      }
    } catch (err) {
      patch({ error: (err as Error).message });
    } finally {
      patch({ isRunning: false });
    }
  }, []);

  /** Refinement loop run from the client: Designer (with refinement) → Verifier, retrying on violations. */
  const refine = useCallback(async (text: string) => {
    const { request, roomLayout, verifiedPlan, designPlan } = stateRef.current;
    if (!request || !roomLayout) return;
    const setStep = (i: number, step: Partial<AgentStep>) =>
      patch((s) => ({ agentSteps: s.agentSteps.map((st, j) => (j === i ? { ...st, ...step } : st)) }));

    patch((s) => ({ isRunning: true, error: null, log: [...s.log, `You: "${text}"`] }));
    let previous: DesignPlan | null = designPlan
      ? { ...designPlan, placements: verifiedPlan?.placements ?? designPlan.placements }
      : null;
    let violations = undefined as VerifiedPlan['violations'] | undefined;
    try {
      for (let attempt = 1; attempt <= MAX_REFINE_ATTEMPTS; attempt++) {
        setStep(1, { status: 'running', attempt, maxAttempts: MAX_REFINE_ATTEMPTS, message: violations ? `Fixing ${violations.length} violation(s)…` : `Refining: "${text}"` });
        setStep(2, { status: 'pending', attempt, maxAttempts: MAX_REFINE_ATTEMPTS });
        const dRes = await fetch('/api/design', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, roomLayout, refinement: text, previousPlan: previous, violations }),
        });
        const d = await dRes.json();
        if (!dRes.ok) throw new Error(d.error ?? 'Designer failed');
        setStep(1, { ...d.agentStatus, attempt, maxAttempts: MAX_REFINE_ATTEMPTS });

        setStep(2, { status: 'running', message: 'Re-verifying…' });
        const vRes = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomLayout, designPlan: d.designPlan, iteration: attempt }),
        });
        const v = await vRes.json();
        if (!vRes.ok) throw new Error(v.error ?? 'Verifier failed');
        setStep(2, { ...v.agentStatus, attempt, maxAttempts: MAX_REFINE_ATTEMPTS });
        patch((s) => ({
          designPlan: d.designPlan,
          verifiedPlan: v.verifiedPlan,
          log: [...s.log, `Designer: ${d.agentStatus.message}`, `Verifier: ${v.agentStatus.message}`],
        }));

        // The offline engine is deterministic, so retrying it can't change the outcome.
        if (v.verifiedPlan.status === 'pass' || d.usedFallback) break;
        previous = d.designPlan;
        violations = v.verifiedPlan.violations;
      }
    } catch (err) {
      patch({ error: (err as Error).message });
    } finally {
      patch({ isRunning: false });
    }
  }, []);

  return (
    <DesignContext.Provider value={{ ...state, runPipeline, refine }}>{children}</DesignContext.Provider>
  );
}

export function useDesign() {
  const ctx = useContext(DesignContext);
  if (!ctx) throw new Error('useDesign must be used inside <DesignProvider>');
  return ctx;
}
