'use client';

import { useEffect, useRef } from 'react';
import type { AgentStep } from '@/lib/types';

export type AgentMeta = Record<string, { icon: string; role: string; engine: string }>;

const META: AgentMeta = {
  'Room Analyzer': { icon: '📐', role: 'Maps walls, doors & windows', engine: 'Argon / geometry' },
  Designer: { icon: '🎨', role: 'Picks IKEA pieces & places them', engine: 'Gemini 4 Argon' },
  Verifier: { icon: '🛡️', role: 'Bounds · collisions · walkways · doors · budget', engine: 'Deterministic code' },
  Visualizer: { icon: '🖼️', role: 'Renders the pieces into your photo', engine: 'Gemini image model' },
};

function Indicator({ status }: { status: AgentStep['status'] }) {
  switch (status) {
    case 'running':
      return (
        <span className="relative flex h-6 w-6 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
        </span>
      );
    case 'complete':
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">✓</span>
      );
    case 'error':
      return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm font-bold text-white">✕</span>;
    default:
      return (
        <span className="flex h-6 w-6 items-center justify-center">
          <span className="h-3 w-3 rounded-full bg-slate-600" />
        </span>
      );
  }
}

export default function AgentStatus({
  steps,
  log = [],
  meta: metaOverrides,
}: {
  steps: AgentStep[];
  log?: string[];
  /** Per-agent descriptions for pipelines that use the agents differently (e.g. photo mode). */
  meta?: AgentMeta;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [log.length]);
  const designer = steps.find((s) => s.agent === 'Designer');
  const attempt = designer?.attempt ?? 1;
  const max = designer?.maxAttempts ?? 3;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Agent Pipeline</h3>
        {attempt > 1 && steps.some((s) => s.status === "running") && (
          <span className="animate-pulse rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            Retry {attempt}/{max}…
          </span>
        )}
      </div>

      <ol className="relative">
        {steps.map((step, i) => {
          const meta = metaOverrides?.[step.agent] ?? META[step.agent] ?? { icon: '🤖', role: '', engine: '' };
          const isLast = i === steps.length - 1;
          const lineDone = step.status === 'complete';
          return (
            <li key={step.agent} className="relative flex gap-3 pb-6 last:pb-0">
              {!isLast && (
                <span
                  className={`absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-0.5 transition-colors duration-500 ${
                    lineDone ? 'bg-emerald-500/70' : 'bg-slate-700'
                  }`}
                />
              )}
              <Indicator status={step.status} />
              <div
                className={`min-w-0 flex-1 rounded-lg border px-3 py-2 transition-all duration-300 ${
                  step.status === 'running'
                    ? 'border-amber-400/50 bg-amber-400/5 shadow-[0_0_20px_-6px_rgba(251,191,36,0.5)]'
                    : step.status === 'error'
                      ? 'border-red-500/50 bg-red-500/5'
                      : step.status === 'complete'
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-slate-700/60 bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{meta.icon}</span>
                  <span className="font-semibold text-white">{step.agent}</span>
                  {step.agent === 'Verifier' && step.status === 'error' && (step.violationCount ?? 0) > 0 && (
                    <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      {step.violationCount} violation{step.violationCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {step.agent !== 'Room Analyzer' && (step.attempt ?? 1) > 1 && step.status !== 'error' && (
                    <span className="ml-auto text-[10px] font-semibold text-slate-400">
                      pass {step.attempt}/{step.maxAttempts}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {meta.role} · <span className="text-indigo-300/80">{meta.engine}</span>
                </div>
                {step.message && <div className="mt-1.5 text-xs leading-snug text-slate-300">{step.message}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      {log.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Agent log</h4>
          <div ref={logRef} className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-black/30 p-2 font-mono text-[10.5px] leading-relaxed text-slate-400">
            {log.map((line, i) => (
              <div key={i}>
                <span className="text-indigo-400">›</span> {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
