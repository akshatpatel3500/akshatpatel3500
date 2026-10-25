'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import AgentStatus from '@/components/AgentStatus';
import BudgetBar from '@/components/BudgetBar';
import { products } from '@/lib/products';
import { computeBudgetSummary } from '@/lib/verification';
import { useDesign } from '../context/DesignContext';

const RoomViewer = dynamic(() => import('@/components/RoomViewer'), {
  ssr: false,
  loading: () => <CanvasPlaceholder label="Loading 3D engine…" />,
});

type Tab = 'status' | 'catalog' | 'refine';

const REFINE_IDEAS = ['Make it more cozy', 'Make it cheaper', 'More work-friendly', 'Add more storage'];

const PRIORITY_BADGE: Record<string, string> = {
  'must-have': 'bg-emerald-500/15 text-emerald-300',
  'nice-to-have': 'bg-amber-400/15 text-amber-200',
  stretch: 'bg-slate-500/20 text-slate-300',
};

export default function DesignPage() {
  const { request, roomLayout, designPlan, verifiedPlan, agentSteps, isRunning, error, log, refine } = useDesign();
  const [tab, setTab] = useState<Tab>('status');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!request && !isRunning) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
        <p className="text-slate-400">No design yet.</p>
        <Link href="/" className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500">
          ← Set up a room
        </Link>
      </main>
    );
  }

  const placements = verifiedPlan?.placements ?? designPlan?.placements ?? [];
  const violations = verifiedPlan?.violations ?? [];
  const budget = computeBudgetSummary(placements, products, request?.budget ?? 0);
  const failed = verifiedPlan?.status === 'fail' && !isRunning;
  const bannerKey = verifiedPlan ? `${verifiedPlan.plan_id}-${verifiedPlan.iteration}` : null;

  async function submitRefine(text: string) {
    if (!text.trim() || isRunning) return;
    setTab('status');
    setRefineText('');
    await refine(text.trim());
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-5 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-black tracking-tight">
            Furnish<span className="text-indigo-400">AR</span>
          </Link>
          {request && (
            <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
              <span className="rounded bg-slate-800 px-2 py-1">{request.roomType.replace('_', ' ')}</span>
              <span className="rounded bg-slate-800 px-2 py-1">
                {request.dimensions.width.toFixed(1)} × {request.dimensions.length.toFixed(1)} m
              </span>
              <span className="rounded bg-indigo-600/20 px-2 py-1 text-indigo-300">{request.style}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {isRunning ? (
            <span className="flex items-center gap-2 text-amber-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" /> Agents working…
            </span>
          ) : verifiedPlan?.status === 'pass' ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-300">
              ✓ Verified layout
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 3D canvas — 70% */}
        <section className="relative min-w-0 basis-[70%]">
          {roomLayout ? (
            <RoomViewer
              roomLayout={roomLayout}
              placements={placements}
              products={products}
              selectedId={selectedId}
              onSelect={setSelectedId}
              violations={violations}
            />
          ) : (
            <CanvasPlaceholder label="Room Analyzer is mapping your space…" />
          )}

          {/* Violation banner */}
          {failed && violations.length > 0 && dismissed !== bannerKey && (
            <div className="absolute left-4 right-4 top-4 rounded-xl border border-red-500/50 bg-red-950/90 p-4 shadow-2xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-bold text-red-300">
                  ⚠ Verifier found {violations.length} issue{violations.length === 1 ? '' : 's'} after {verifiedPlan!.iteration} attempt
                  {verifiedPlan!.iteration === 1 ? '' : 's'}
                </span>
                <button onClick={() => setDismissed(bannerKey)} className="text-red-300 hover:text-white">
                  ✕
                </button>
              </div>
              <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-red-100/90">
                {violations.map((v, i) => (
                  <li key={i}>
                    <span className="mr-1.5 rounded bg-red-500/30 px-1.5 py-0.5 font-mono text-[10px] uppercase">{v.type}</span>
                    {v.description}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-red-200/70">Flagged pieces are outlined in red. Try a refinement like “fix the overlaps” or pick fewer items.</p>
            </div>
          )}

          {error && (
            <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-red-500/50 bg-red-950/90 px-4 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {roomLayout && (
            <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-slate-900/70 px-3 py-1.5 text-[11px] text-slate-400 backdrop-blur">
              Drag to orbit · scroll to zoom · click furniture for details
            </div>
          )}
        </section>

        {/* Sidebar — 30% */}
        <aside className="flex min-w-[300px] basis-[30%] flex-col border-l border-slate-800 bg-slate-900">
          <nav className="flex border-b border-slate-800">
            {(['status', 'catalog', 'refine'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-sm font-semibold capitalize transition ${
                  tab === t ? 'border-b-2 border-indigo-500 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t}
                {t === 'status' && isRunning && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'status' && (
              <div className="space-y-5">
                <AgentStatus steps={agentSteps} log={log} />
                {designPlan?.style_summary && (
                  <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-sm text-slate-300">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Design notes</div>
                    {designPlan.style_summary}
                  </div>
                )}
                {verifiedPlan && (
                  <div className="text-[11px] text-slate-500">
                    Checks run: {verifiedPlan.checks_run.join(' · ')}
                    {verifiedPlan.auto_fixed.length > 0 && (
                      <ul className="mt-1 list-inside list-disc text-slate-400">
                        {verifiedPlan.auto_fixed.map((f) => (
                          <li key={f}>Auto-fixed: {f}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'catalog' && (
              <div className="space-y-5">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">In your room</h3>
                  {placements.length === 0 && <p className="text-sm text-slate-500">Nothing placed yet.</p>}
                  <ul className="space-y-1.5">
                    {placements.map((p) => {
                      const product = products.find((x) => x.id === p.product_id);
                      if (!product) return null;
                      const flagged = violations.some((v) => v.objects.includes(p.placement_id));
                      return (
                        <li key={p.placement_id}>
                          <button
                            onClick={() => setSelectedId(selectedId === p.placement_id ? null : p.placement_id)}
                            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                              selectedId === p.placement_id
                                ? 'border-indigo-500 bg-indigo-500/10'
                                : flagged
                                  ? 'border-red-500/40 bg-red-500/5'
                                  : 'border-slate-800 bg-slate-800/40 hover:border-slate-600'
                            }`}
                          >
                            <span className="h-8 w-8 shrink-0 rounded-md ring-1 ring-white/10" style={{ background: product.color }} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{product.name}</span>
                              <span className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10px] ${PRIORITY_BADGE[p.priority]}`}>{p.priority}</span>
                            </span>
                            <span className="text-sm font-semibold text-emerald-400">${product.price}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Full catalog</h3>
                  <ul className="divide-y divide-slate-800 text-sm">
                    {products.map((product) => (
                      <li key={product.id} className="flex items-center gap-3 py-2">
                        <span className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-white/10" style={{ background: product.color }} />
                        <span className="flex-1">
                          <a href={product.ikeaUrl} target="_blank" rel="noreferrer" className="font-medium hover:text-indigo-300">
                            {product.name}
                          </a>
                          <span className="ml-2 text-xs text-slate-500">{product.category.replace('_', ' ')}</span>
                        </span>
                        <span className="text-slate-300">${product.price}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {tab === 'refine' && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">
                  Tell the Designer what to change. It will re-plan, and the Verifier will re-check every rule before the room updates.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitRefine(refineText);
                  }}
                  className="space-y-2"
                >
                  <textarea
                    value={refineText}
                    onChange={(e) => setRefineText(e.target.value)}
                    placeholder="e.g. make it more cozy"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={isRunning || !refineText.trim()}
                    className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40"
                  >
                    {isRunning ? 'Agents working…' : 'Refine design'}
                  </button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {REFINE_IDEAS.map((idea) => (
                    <button
                      key={idea}
                      disabled={isRunning}
                      onClick={() => void submitRefine(idea)}
                      className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-indigo-500 hover:text-white disabled:opacity-40"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom bar */}
      <footer className="flex items-center gap-6 border-t border-slate-800 bg-slate-900/95 px-5 py-3">
        <div className="min-w-0 flex-1">
          <BudgetBar summary={budget} />
        </div>
        <Link
          href="/review"
          aria-disabled={!placements.length}
          className={`shrink-0 rounded-lg px-5 py-3 text-sm font-bold transition ${
            placements.length ? 'bg-indigo-600 hover:bg-indigo-500' : 'pointer-events-none bg-slate-700 text-slate-400'
          }`}
        >
          View Shopping List →
        </Link>
      </footer>
    </main>
  );
}

function CanvasPlaceholder({ label }: { label: string }) {
  return (
    <div className="bg-grid flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0B1120]">
      <div className="h-16 w-16 animate-spin rounded-2xl border-4 border-indigo-500/30 border-t-indigo-500" />
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}
