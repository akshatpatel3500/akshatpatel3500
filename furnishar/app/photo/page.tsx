'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import AgentStatus, { type AgentMeta } from '@/components/AgentStatus';
import { checkFit, PHOTO_STEPS, type FreeZone, type PhotoAnalysis, type PhotoEvent, type PhotoSuggestion } from '@/lib/photo';
import { products } from '@/lib/products';
import type { AgentStep } from '@/lib/types';

const PHOTO_META: AgentMeta = {
  'Room Analyzer': { icon: '📷', role: 'Finds & measures empty spaces in your photo', engine: 'Gemini 4 Argon (vision)' },
  Designer: { icon: '🎨', role: 'Picks IKEA pieces that suit your room', engine: 'Gemini 4 Argon' },
  Verifier: { icon: '🛡️', role: 'Checks real product sizes against each space', engine: 'Deterministic code' },
  Visualizer: { icon: '🖼️', role: 'Draws the piece into your actual photo', engine: 'Gemini image model' },
};

const ZONE_COLORS = ['#818CF8', '#34D399', '#FBBF24'];
const INITIAL_STEPS: AgentStep[] = PHOTO_STEPS.map((agent) => ({ agent, status: 'pending' }));
const M_PER_IN = 0.0254;

interface Added {
  image: string;
  productId: string;
  zoneId: string;
}

/** Downscale on the client so uploads stay small and fast for the models. */
function resizeImage(file: File, maxSide = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image this browser can open'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function PhotoPage() {
  const [original, setOriginal] = useState<string | null>(null);
  const [added, setAdded] = useState<Added[]>([]);
  const [budget, setBudget] = useState(500);
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [suggestions, setSuggestions] = useState<PhotoSuggestion[]>([]);
  const [measured, setMeasured] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<AgentStep[]>(INITIAL_STEPS);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<'analyzing' | 'rendering' | null>(null);
  const [renderingKey, setRenderingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastSteps = useRef<AgentStep[]>(INITIAL_STEPS);

  const current = added.length ? added[added.length - 1].image : original;
  const displayed = showOriginal ? original : current;
  const total = added.reduce((sum, a) => sum + (products.find((p) => p.id === a.productId)?.price ?? 0), 0);

  /** Zones with any tape-measured width the user typed in, which overrides the AI's estimate. */
  const zones: FreeZone[] = useMemo(
    () =>
      (analysis?.free_zones ?? []).map((z) => {
        const inches = parseFloat(measured[z.id] ?? '');
        return inches > 0 ? { ...z, estimated_width_m: inches * M_PER_IN } : z;
      }),
    [analysis, measured],
  );

  const setStep = (i: number, patch: Partial<AgentStep>) =>
    setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));
  const addLog = (line: string) => setLog((l) => [...l, line]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await resizeImage(file);
      setOriginal(dataUrl);
      setAdded([]);
      setAnalysis(null);
      setSuggestions([]);
      setMeasured({});
      setSteps(INITIAL_STEPS);
      setLog([]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function analyze() {
    if (!original) return;
    setBusy('analyzing');
    setError(null);
    setAnalysis(null);
    setSuggestions([]);
    setSteps(INITIAL_STEPS);
    setLog([]);
    lastSteps.current = INITIAL_STEPS;
    try {
      const res = await fetch('/api/photo/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: original, budget }),
      });
      if (!res.ok || !res.body) throw new Error(`Analysis failed (${res.status})`);
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
          if (!chunk.startsWith('data: ')) continue;
          const event = JSON.parse(chunk.slice(6)) as PhotoEvent;
          if (event.type === 'step') {
            event.steps.forEach((st, i) => {
              if (st.message && st.message !== lastSteps.current[i]?.message) addLog(`${st.agent}: ${st.message}`);
            });
            lastSteps.current = event.steps;
            setSteps(event.steps);
          } else if (event.type === 'analysis') {
            setAnalysis(event.analysis);
          } else if (event.type === 'result') {
            setAnalysis(event.analysis);
            setSuggestions(event.suggestions);
          } else if (event.type === 'error') {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function render(s: PhotoSuggestion) {
    const zone = zones.find((z) => z.id === s.zone_id);
    const product = products.find((p) => p.id === s.product_id);
    if (!current || !zone || !product || !analysis) return;
    setBusy('rendering');
    setRenderingKey(`${s.zone_id}:${s.product_id}`);
    setError(null);
    setShowOriginal(false);
    setStep(3, { status: 'running', message: `Placing ${product.name} in “${zone.label}”…` });
    addLog(`Visualizer: placing ${product.name}…`);
    try {
      const res = await fetch('/api/photo/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: current,
          productId: product.id,
          zone,
          placementHint: s.placement_hint,
          scaleReference: analysis.scale_reference,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Render failed');
      setAdded((a) => [...a, { image: data.image, productId: product.id, zoneId: zone.id }]);
      setStep(3, { status: 'complete', message: `Added ${product.name} to your photo` });
      addLog(`Visualizer: added ${product.name} ($${product.price})`);
    } catch (err) {
      setStep(3, { status: 'error', message: (err as Error).message.slice(0, 160) });
      setError((err as Error).message);
    } finally {
      setBusy(null);
      setRenderingKey(null);
    }
  }

  async function copyList() {
    const lines = added.map((a) => {
      const p = products.find((x) => x.id === a.productId)!;
      return `• ${p.name} (${p.category.replace('_', ' ')}) — $${p.price}\n  ${p.ikeaUrl}`;
    });
    await navigator.clipboard.writeText(['FurnishAR — my room', '', ...lines, '', `Total: $${total}`].join('\n'));
    addLog('Shopping list copied to clipboard');
  }

  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-5 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-black tracking-tight">
            Furnish<span className="text-indigo-400">AR</span>
          </Link>
          <span className="rounded bg-indigo-600/20 px-2 py-1 text-xs font-semibold text-indigo-300">📷 Photo mode</span>
        </div>
        <Link href="/" className="text-sm text-slate-400 hover:text-white">
          3D planner →
        </Link>
      </header>

      {!original ? (
        <section className="bg-grid flex min-h-[calc(100vh-57px)] items-center justify-center p-6">
          <div className="w-full max-w-2xl text-center">
            <h1 className="mb-2 text-4xl font-black tracking-tight">See IKEA furniture in your actual room</h1>
            <p className="mb-8 text-slate-400">
              Upload a photo. AI finds the empty spaces, suggests pieces that fit, and shows you how they look — in your photo.
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void onFile(e.dataTransfer.files[0]);
              }}
              className={`flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 transition ${
                dragOver ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-600 bg-slate-900/60 hover:border-indigo-500'
              }`}
            >
              <span className="text-5xl">📷</span>
              <span className="text-lg font-semibold">Drop a room photo here, or click to upload</span>
              <span className="text-sm text-slate-500">Tip: stand back so the floor and the empty space are both in frame</span>
            </button>
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </div>
        </section>
      ) : (
        <div className="grid gap-0 lg:grid-cols-[1fr_400px]">
          {/* Photo */}
          <section className="flex flex-col items-center gap-3 bg-[#0B1120] p-4 lg:min-h-[calc(100vh-57px)]">
            <div className="relative inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayed!} alt="Your room" className="block max-h-[72vh] w-auto max-w-full rounded-xl shadow-2xl" />
              {/* Zone boxes are in the original photo's coordinates, so only draw them on the original. */}
              {(showOriginal || !added.length) &&
                zones.map((z, i) => (
                  <div
                    key={z.id}
                    className="pointer-events-none absolute rounded-md border-2 border-dashed"
                    style={{
                      left: `${z.bbox[0] * 100}%`,
                      top: `${z.bbox[1] * 100}%`,
                      width: `${(z.bbox[2] - z.bbox[0]) * 100}%`,
                      height: `${(z.bbox[3] - z.bbox[1]) * 100}%`,
                      borderColor: ZONE_COLORS[i % ZONE_COLORS.length],
                      background: `${ZONE_COLORS[i % ZONE_COLORS.length]}22`,
                    }}
                  >
                    <span
                      className="absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-900"
                      style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}
                    >
                      {i + 1}. {z.label}
                    </span>
                  </div>
                ))}
              {busy === 'rendering' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-950/60 backdrop-blur-sm">
                  <div className="h-12 w-12 animate-spin rounded-xl border-4 border-indigo-500/30 border-t-indigo-500" />
                  <p className="text-sm font-semibold">Placing furniture in your photo…</p>
                </div>
              )}
              {added.length > 0 && (
                <span className="absolute left-3 top-3 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-semibold backdrop-blur">
                  {showOriginal ? 'Before' : `After · ${added.length} piece${added.length === 1 ? '' : 's'} added`}
                </span>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-2 text-sm">
              {added.length > 0 && (
                <>
                  <button
                    onPointerDown={() => setShowOriginal(true)}
                    onPointerUp={() => setShowOriginal(false)}
                    onPointerLeave={() => setShowOriginal(false)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 hover:border-indigo-500"
                  >
                    👁 Hold to see before
                  </button>
                  <button
                    onClick={() => setAdded((a) => a.slice(0, -1))}
                    disabled={!!busy}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 hover:border-indigo-500 disabled:opacity-40"
                  >
                    ↶ Undo last
                  </button>
                  <a
                    href={current!}
                    download="furnishar-room.jpg"
                    className="rounded-lg border border-slate-700 px-3 py-1.5 hover:border-indigo-500"
                  >
                    ⬇ Download
                  </a>
                </>
              )}
              <button
                onClick={() => fileInput.current?.click()}
                disabled={!!busy}
                className="rounded-lg border border-slate-700 px-3 py-1.5 hover:border-indigo-500 disabled:opacity-40"
              >
                🔄 New photo
              </button>
            </div>

            {error && (
              <div className="w-full max-w-2xl rounded-lg border border-red-500/50 bg-red-950/80 px-4 py-2 text-sm text-red-200">{error}</div>
            )}
          </section>

          {/* Sidebar */}
          <aside className="space-y-5 border-l border-slate-800 bg-slate-900 p-4 lg:max-h-[calc(100vh-57px)] lg:overflow-y-auto">
            {!analysis && busy !== 'analyzing' && (
              <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-800/40 p-4">
                <label className="block">
                  <span className="mb-1 flex justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
                    Budget <span className="text-white">${budget.toLocaleString()}</span>
                  </span>
                  <input
                    type="range"
                    min={50}
                    max={3000}
                    step={50}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    className="w-full"
                  />
                </label>
                <button
                  onClick={analyze}
                  className="w-full rounded-lg bg-indigo-600 py-3 font-bold shadow-[0_10px_30px_-10px_rgba(79,70,229,0.9)] hover:bg-indigo-500"
                >
                  Find furniture for my room →
                </button>
              </div>
            )}

            <AgentStatus steps={steps} log={log} meta={PHOTO_META} />

            {analysis && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="rounded bg-slate-800 px-2 py-1 capitalize text-slate-200">{analysis.style}</span>
                {analysis.palette.map((c) => (
                  <span key={c} className="h-4 w-4 rounded-full ring-1 ring-white/20" style={{ background: c }} title={c} />
                ))}
              </div>
            )}

            {zones.map((zone, i) => {
              const zoneSuggestions = suggestions.filter((s) => s.zone_id === zone.id);
              return (
                <div key={zone.id} className="rounded-xl border border-slate-800 bg-slate-800/30 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-slate-900"
                      style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}
                    >
                      {i + 1}
                    </span>
                    <span className="font-semibold">{zone.label}</span>
                  </div>
                  {zone.notes && <p className="mb-2 text-xs text-slate-400">{zone.notes}</p>}
                  <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
                    <span>
                      {measured[zone.id] ? 'Measured' : 'AI estimate'}: {Math.round(zone.estimated_width_m * 100)} cm wide (
                      {Math.round(zone.estimated_width_m / M_PER_IN)} in)
                    </span>
                    <input
                      type="number"
                      min={1}
                      placeholder="your tape (in)"
                      value={measured[zone.id] ?? ''}
                      onChange={(e) => setMeasured({ ...measured, [zone.id]: e.target.value })}
                      className="ml-auto w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
                    />
                  </div>

                  {zoneSuggestions.length === 0 && busy === 'analyzing' && <p className="text-xs text-slate-500">Designer is choosing…</p>}
                  <ul className="space-y-2">
                    {zoneSuggestions.map((s) => {
                      const product = products.find((p) => p.id === s.product_id)!;
                      // Re-run the deterministic check so a typed-in measurement updates the verdict instantly.
                      const fit = checkFit(product, zone);
                      const key = `${s.zone_id}:${s.product_id}`;
                      const isAdded = added.some((a) => a.productId === s.product_id && a.zoneId === s.zone_id);
                      return (
                        <li key={key} className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-3">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 h-9 w-9 shrink-0 rounded-md ring-1 ring-white/10" style={{ background: product.color }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <a href={product.ikeaUrl} target="_blank" rel="noreferrer" className="font-bold hover:text-indigo-300">
                                  {product.name}
                                </a>
                                <span className="font-semibold text-emerald-400">${product.price}</span>
                              </div>
                              <div className={`mt-1 text-xs font-semibold ${fit.fits ? 'text-emerald-400' : 'text-red-400'}`}>
                                {fit.fits ? '✓' : '✕'} {fit.summary}
                              </div>
                              {fit.warnings.map((w) => (
                                <div key={w} className="text-[11px] text-amber-300">
                                  ⚠ {w}
                                </div>
                              ))}
                              {s.reasoning && <p className="mt-1.5 text-xs leading-snug text-slate-300">{s.reasoning}</p>}
                            </div>
                          </div>
                          <button
                            onClick={() => render(s)}
                            disabled={!!busy}
                            className={`mt-2 w-full rounded-md py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                              fit.fits ? 'bg-indigo-600 hover:bg-indigo-500' : 'border border-slate-600 text-slate-300 hover:border-indigo-500'
                            }`}
                          >
                            {renderingKey === key
                              ? 'Placing…'
                              : isAdded
                                ? '✓ Added — add again'
                                : fit.fits
                                  ? '✨ See it in my room'
                                  : 'Try anyway'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            {added.length > 0 && (
              <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/5 p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">In your photo</span>
                  <span className={`font-bold ${total > budget ? 'text-red-400' : 'text-white'}`}>
                    ${total} <span className="text-xs font-normal text-slate-500">/ ${budget}</span>
                  </span>
                </div>
                <ul className="mb-3 space-y-1 text-sm">
                  {added.map((a, i) => {
                    const p = products.find((x) => x.id === a.productId)!;
                    return (
                      <li key={i} className="flex justify-between">
                        <a href={p.ikeaUrl} target="_blank" rel="noreferrer" className="hover:text-indigo-300">
                          {p.name} ↗
                        </a>
                        <span className="text-slate-300">${p.price}</span>
                      </li>
                    );
                  })}
                </ul>
                <button onClick={copyList} className="w-full rounded-md border border-slate-600 py-1.5 text-xs font-semibold hover:border-indigo-500">
                  📋 Copy shopping list
                </button>
              </div>
            )}

            <p className="text-[11px] leading-snug text-slate-500">
              Sizes from a photo are estimates — type in a tape measurement for an exact fit check. The rendered image is an
              AI visualization; product sizes and prices are IKEA&apos;s real ones.
            </p>
          </aside>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </main>
  );
}
