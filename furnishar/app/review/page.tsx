'use client';

import Link from 'next/link';
import { useState } from 'react';
import BudgetBar from '@/components/BudgetBar';
import { products } from '@/lib/products';
import type { Priority } from '@/lib/types';
import { computeBudgetSummary } from '@/lib/verification';
import { useDesign } from '../context/DesignContext';

const ORDER: Record<Priority, number> = { 'must-have': 0, 'nice-to-have': 1, stretch: 2 };
const BADGE: Record<Priority, string> = {
  'must-have': 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  'nice-to-have': 'bg-amber-400/15 text-amber-200 ring-amber-400/30',
  stretch: 'bg-slate-500/20 text-slate-300 ring-slate-500/30',
};

export default function ReviewPage() {
  const { request, designPlan, verifiedPlan } = useDesign();
  const [copied, setCopied] = useState(false);

  const placements = verifiedPlan?.placements ?? designPlan?.placements ?? [];
  const rows = placements
    .map((p) => ({ p, product: products.find((x) => x.id === p.product_id) }))
    .filter((r): r is { p: (typeof placements)[number]; product: NonNullable<typeof r.product> } => Boolean(r.product))
    .sort((a, b) => ORDER[a.p.priority] - ORDER[b.p.priority] || b.product.price - a.product.price);
  const summary = computeBudgetSummary(placements, products, request?.budget ?? 0);

  async function copyList() {
    const lines = [
      `FurnishAR shopping list — ${request?.style ?? ''} ${request?.roomType.replace('_', ' ') ?? ''}`.trim(),
      '',
      ...rows.map(({ p, product }) => `• ${product.name} (${product.category.replace('_', ' ')}) — $${product.price} [${p.priority}]\n  ${product.ikeaUrl}`),
      '',
      `Total: $${summary.total} / $${summary.budget_limit} budget`,
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!rows.length) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-slate-400">Your shopping list is empty.</p>
        <Link href="/" className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500">
          ← Design a room
        </Link>
      </main>
    );
  }

  return (
    <main className="bg-grid min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/design" className="text-sm text-slate-400 hover:text-white">
              ← Back to Design
            </Link>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Shopping List</h1>
            <p className="text-slate-400">
              {rows.length} IKEA pieces for your {request?.style} {request?.roomType.replace('_', ' ')}
            </p>
          </div>
          <button
            onClick={copyList}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold transition hover:bg-indigo-500"
          >
            {copied ? '✓ Copied!' : '📋 Copy List'}
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-800/50 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map(({ p, product }) => (
                  <tr key={p.placement_id} className="transition hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-white/10" style={{ background: product.color }} />
                        <div>
                          <div className="font-semibold">{product.name}</div>
                          <div className="whitespace-nowrap text-xs text-slate-500">
                            {Math.round(product.dimensions.width * 100)}×{Math.round(product.dimensions.depth * 100)}×
                            {Math.round(product.dimensions.height * 100)} cm
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-300">{product.category.replace('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${BADGE[p.priority]}`}>{p.priority}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">${product.price}</td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={product.ikeaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="whitespace-nowrap font-semibold text-indigo-400 hover:text-indigo-300"
                      >
                        View on IKEA ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-700 bg-slate-800/30">
                <tr>
                  <td colSpan={3} className="px-4 py-3 font-semibold">
                    Total
                  </td>
                  <td className="px-4 py-3 text-right text-lg font-bold tabular-nums">${summary.total}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">Budget summary</h2>
              <div className="mb-4 text-4xl font-black tabular-nums">
                ${summary.total.toLocaleString()}
                <span className="text-base font-medium text-slate-500"> / ${summary.budget_limit.toLocaleString()}</span>
              </div>
              <BudgetBar summary={summary} compact />
              <dl className="mt-4 space-y-1.5 text-sm">
                <Row label="Must-have" value={summary.by_priority.must_have} dot="bg-emerald-500" />
                <Row label="Nice-to-have" value={summary.by_priority.nice_to_have} dot="bg-amber-400" />
                <Row label="Stretch" value={summary.by_priority.stretch} dot="bg-slate-400" />
              </dl>
              <div
                className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold ${
                  summary.within_budget ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
                }`}
              >
                {summary.within_budget
                  ? `✓ $${(summary.budget_limit - summary.total).toLocaleString()} under budget`
                  : `⚠ $${(summary.total - summary.budget_limit).toLocaleString()} over budget`}
              </div>
            </div>
            {summary.savings_suggestions.length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Ways to save</h2>
                <ul className="space-y-1.5 text-sm text-slate-300">
                  {summary.savings_suggestions.map((s) => (
                    <li key={s}>💡 {s}</li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-2 text-slate-400">
        <span className={`h-2 w-2 rounded-sm ${dot}`} />
        {label}
      </dt>
      <dd className="font-semibold tabular-nums">${value}</dd>
    </div>
  );
}
