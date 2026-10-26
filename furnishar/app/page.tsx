'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CATEGORIES } from '@/lib/products';
import { FEET_TO_METERS } from '@/lib/room';
import { useDesign } from './context/DesignContext';

const ROOM_TYPES = [
  { id: 'living_room', label: 'Living Room' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'studio', label: 'Studio' },
  { id: 'office', label: 'Office' },
];

const STYLES = [
  { name: 'Modern Minimalist', emoji: '◻️', blurb: 'Clean lines, neutral tones', swatch: ['#F1F5F9', '#94A3B8', '#1E293B'] },
  { name: 'Cozy Scandinavian', emoji: '🌿', blurb: 'Light wood, soft textiles', swatch: ['#F5F0E8', '#D4C4A8', '#8B6914'] },
  { name: 'Industrial', emoji: '🏭', blurb: 'Dark metal, raw finishes', swatch: ['#3D3D3D', '#78716C', '#B45309'] },
  { name: 'Bohemian', emoji: '🪶', blurb: 'Layered, natural, eclectic', swatch: ['#F5F0E8', '#C2410C', '#65A30D'] },
  { name: 'Mid-Century Modern', emoji: '🪑', blurb: 'Walnut, curves, classics', swatch: ['#C4A882', '#8B6914', '#0F766E'] },
  { name: 'Japanese Zen', emoji: '🎋', blurb: 'Calm, low, natural', swatch: ['#F5F0E8', '#A8A29E', '#44403C'] },
];

type Column = 'mustHave' | 'niceToHave' | 'stretch';
const COLUMNS: Array<{ id: Column; label: string; color: string; chip: string }> = [
  { id: 'mustHave', label: 'Must-Have', color: 'border-emerald-500/40', chip: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' },
  { id: 'niceToHave', label: 'Nice-to-Have', color: 'border-amber-400/40', chip: 'bg-amber-400/15 text-amber-200 ring-amber-400/40' },
  { id: 'stretch', label: 'Stretch', color: 'border-slate-500/40', chip: 'bg-slate-500/15 text-slate-300 ring-slate-500/40' },
];
const NEXT: Record<Column, Column> = { mustHave: 'niceToHave', niceToHave: 'stretch', stretch: 'mustHave' };

const DEFAULT_PRIORITIES: Record<string, Column> = {
  sofa: 'mustHave',
  desk: 'mustHave',
  bookshelf: 'niceToHave',
  rug: 'niceToHave',
  lamp: 'stretch',
  coffee_table: 'stretch',
  chair: 'stretch',
};

export default function SetupPage() {
  const router = useRouter();
  const { runPipeline } = useDesign();
  const [feet, setFeet] = useState({ width: 14, length: 12, height: 9 });
  const [roomType, setRoomType] = useState('living_room');
  const [style, setStyle] = useState(STYLES[0].name);
  const [budget, setBudget] = useState(2000);
  const [assignment, setAssignment] = useState<Record<string, Column>>(DEFAULT_PRIORITIES);
  const [submitting, setSubmitting] = useState(false);

  const valid = feet.width >= 6 && feet.length >= 6 && feet.height >= 7;
  const meters = {
    width: +(feet.width * FEET_TO_METERS).toFixed(3),
    length: +(feet.length * FEET_TO_METERS).toFixed(3),
    height: +(feet.height * FEET_TO_METERS).toFixed(3),
  };

  function generate() {
    if (!valid) return;
    setSubmitting(true);
    const priorities = {
      mustHave: CATEGORIES.filter((c) => assignment[c.id] === 'mustHave').map((c) => c.id),
      niceToHave: CATEGORIES.filter((c) => assignment[c.id] === 'niceToHave').map((c) => c.id),
      stretch: CATEGORIES.filter((c) => assignment[c.id] === 'stretch').map((c) => c.id),
    };
    // Kick off the streamed pipeline and jump straight to the 3D view so the
    // agents can be watched working live.
    void runPipeline({ dimensions: meters, roomType, style, budget, priorities });
    router.push('/design');
  }

  return (
    <main className="bg-grid min-h-screen">
      <div className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        {/* Hero */}
        <header className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
            3 agents · Gemini 4 Argon · real IKEA products
          </div>
          <h1 className="bg-gradient-to-br from-white via-indigo-100 to-indigo-400 bg-clip-text text-6xl font-black tracking-tight text-transparent sm:text-7xl">
            FurnishAR
          </h1>
          <p className="mt-3 text-xl text-slate-300">Furnish before you move in.</p>
          <Link
            href="/photo"
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-indigo-500 hover:text-white"
          >
            📷 Already in the room? <span className="text-indigo-300">Upload a photo and see IKEA pieces in it →</span>
          </Link>
        </header>

        <div className="space-y-8">
          {/* Room */}
          <Section step={1} title="Your room">
            <div className="grid gap-4 sm:grid-cols-4">
              {(['width', 'length', 'height'] as const).map((k) => (
                <label key={k} className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{k} (ft)</span>
                  <input
                    type="number"
                    min={k === 'height' ? 7 : 6}
                    max={40}
                    step={0.5}
                    value={feet[k]}
                    onChange={(e) => setFeet({ ...feet, [k]: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-lg font-semibold text-white outline-none ring-indigo-500 transition focus:border-indigo-500 focus:ring-2"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">{meters[k].toFixed(2)} m</span>
                </label>
              ))}
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Room type</span>
                <select
                  value={roomType}
                  onChange={(e) => setRoomType(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-3 text-base font-semibold text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                >
                  {ROOM_TYPES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!valid && <p className="mt-2 text-sm text-red-400">Rooms need to be at least 6 × 6 ft with a 7 ft ceiling.</p>}
          </Section>

          {/* Style */}
          <Section step={2} title="Pick a style">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {STYLES.map((s) => {
                const active = s.name === style;
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setStyle(s.name)}
                    className={`group rounded-xl border p-4 text-left transition-all ${
                      active
                        ? 'border-indigo-500 bg-indigo-500/15 shadow-[0_0_30px_-10px_rgba(79,70,229,0.8)]'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800'
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-2xl">{s.emoji}</span>
                      <div className="flex -space-x-1">
                        {s.swatch.map((c) => (
                          <span key={c} className="h-4 w-4 rounded-full ring-2 ring-slate-900" style={{ background: c }} />
                        ))}
                      </div>
                    </div>
                    <div className="font-semibold text-white">{s.name}</div>
                    <div className="text-xs text-slate-400">{s.blurb}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Budget */}
          <Section step={3} title="Budget">
            <div className="flex items-center gap-6">
              <input
                type="range"
                min={500}
                max={5000}
                step={100}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="flex-1"
              />
              <div className="w-28 text-right text-3xl font-bold tabular-nums text-white">${budget.toLocaleString()}</div>
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>$500</span>
              <span>$5,000</span>
            </div>
          </Section>

          {/* Priorities */}
          <Section step={4} title="Priorities" hint="Click a chip to move it to the next column">
            <div className="grid gap-3 sm:grid-cols-3">
              {COLUMNS.map((col) => (
                <div key={col.id} className={`min-h-[120px] rounded-xl border-2 border-dashed ${col.color} bg-slate-900/40 p-3`}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{col.label}</div>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.filter((c) => assignment[c.id] === col.id).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setAssignment({ ...assignment, [c.id]: NEXT[col.id] })}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition hover:scale-105 active:scale-95 ${col.chip}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <button
            type="button"
            onClick={generate}
            disabled={!valid || submitting}
            className="group relative w-full overflow-hidden rounded-xl bg-indigo-600 px-6 py-4 text-lg font-bold text-white shadow-[0_10px_40px_-10px_rgba(79,70,229,0.9)] transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="relative z-10">{submitting ? 'Launching agents…' : 'Generate Design →'}</span>
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </button>
        </div>
      </div>
    </main>
  );
}

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold">{step}</span>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
