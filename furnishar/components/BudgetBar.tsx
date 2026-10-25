"use client";

import type { BudgetSummary } from "@/lib/types";

export default function BudgetBar({
  summary,
  compact = false,
}: {
  summary: BudgetSummary;
  compact?: boolean;
}) {
  const {
    total,
    budget_limit,
    by_priority,
    within_budget,
    savings_suggestions,
  } = summary;
  const scale = Math.max(total, budget_limit) || 1;
  const pct = (n: number) => `${(n / scale) * 100}%`;
  const segments = [
    {
      key: "must",
      label: "Must-have",
      value: by_priority.must_have,
      color: "bg-emerald-500",
    },
    {
      key: "nice",
      label: "Nice-to-have",
      value: by_priority.nice_to_have,
      color: "bg-amber-400",
    },
    {
      key: "stretch",
      label: "Stretch",
      value: by_priority.stretch,
      color: "bg-slate-400",
    },
  ];

  return (
    <div className="w-full">
      {!compact && (
        <div className="mb-1.5 flex items-baseline justify-between gap-4">
          <div className="text-sm">
            <span
              className={`text-lg font-bold ${within_budget ? "text-white" : "text-red-400"}`}
            >
              ${total.toLocaleString()}
            </span>
            <span className="text-slate-400">
              {" "}
              / ${budget_limit.toLocaleString()} budget
            </span>
          </div>
          <div className="flex gap-3 text-[11px] text-slate-400">
            {segments.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-sm ${s.color}`} />
                {s.label} ${s.value}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-800 ring-1 ring-white/5">
        <div className="flex h-full">
          {segments.map((s) => (
            <div
              key={s.key}
              className={`${s.color} h-full transition-all duration-700`}
              style={{ width: pct(s.value) }}
            />
          ))}
        </div>
        {/* budget limit marker when we're over */}
        {total > budget_limit && (
          <div
            className="absolute top-0 h-full w-0.5 bg-red-500"
            style={{ left: pct(budget_limit) }}
          />
        )}
      </div>
      {!compact && savings_suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-400">
          {savings_suggestions.slice(0, 3).map((s) => (
            <span key={s}>💡 {s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
