#!/usr/bin/env python3
"""Write report.html: a browser view of every turn's workflow, for reviewers and demos.

    python3 report.py                 # bundled transcript + data/variants/*.txt
    python3 report.py --out FILE      # choose the output path

The page is self-contained (inline CSS and a few lines of JS), works offline,
and is produced from exactly the same run_conversation() results as run.py.
"""
import argparse
import html
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from agent import load_bundle, run_conversation  # noqa: E402

ACTION_BADGE = {
    "answer": ("ANSWER", "ok"),
    "answer_pending": ("ANSWER · ISSUANCE PENDING", "warn"),
    "decline_escalate": ("ESCALATE", "bad"),
    "gather_info": ("ASK FOR INFO", "info"),
    "acknowledge": ("ACKNOWLEDGE", "info"),
}
PIPELINE = [
    ("Facts", "parsed from the chat"),
    ("Question type", "keyword rules"),
    ("Rule check", "code, fixed priority"),
    ("Search", "BM25, evidence only"),
    ("Math", "Decimal, in code"),
    ("Quote check", "every claim cited"),
    ("Decision", "answer / pending / escalate"),
]

CSS = """
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2330;--muted:#5d6675;--line:#e2e5ea;--accent:#2f5bd3;
--ok:#1f7a4d;--okbg:#e5f4ec;--warn:#8a5a00;--warnbg:#fdf1d8;--bad:#b42318;--badbg:#fde8e6;
--info:#40506b;--infobg:#eaeef5;--bar:#c9d3e6;--barhi:#2f5bd3;--quote:#f1f3f7}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1b1f27;--ink:#e6e9ef;--muted:#9aa3b2;
--line:#2c323d;--accent:#7d9bff;--ok:#6fd3a0;--okbg:#173527;--warn:#f2c46b;--warnbg:#3a2e14;
--bad:#ff8a80;--badbg:#3d1d1b;--info:#b4c0d6;--infobg:#252c39;--bar:#38425a;--barhi:#7d9bff;--quote:#232834}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:0}
.sub{color:var(--muted);margin:0 0 20px}
.flow{display:flex;flex-wrap:wrap;gap:6px;align-items:stretch;margin:16px 0 8px}
.flow div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:13px}
.flow b{display:block}.flow span{color:var(--muted);font-size:12px}
.flow .arrow{border:0;background:none;padding:6px 0;color:var(--muted)}
.flow .key{border-color:var(--accent)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:20px 0 16px}
.tabs button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--card);color:var(--ink);
border-radius:999px;padding:5px 12px;cursor:pointer}.tabs button[aria-selected=true]{background:var(--accent);
color:#fff;border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 14px}
.head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.time{font-weight:700;font-variant-numeric:tabular-nums}
.badge{font-size:12px;font-weight:700;border-radius:6px;padding:2px 8px}
.ok{color:var(--ok);background:var(--okbg)}.warn{color:var(--warn);background:var(--warnbg)}
.bad{color:var(--bad);background:var(--badbg)}.info{color:var(--info);background:var(--infobg)}
.chip{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:var(--muted)}
.cust{font-style:italic;margin:4px 0 12px;color:var(--ink)}
.steps{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;font-size:14px;margin:0 0 12px}
.steps dt{color:var(--muted);font-weight:600}.steps dd{margin:0}
.steps .l{display:block}.l.y{color:var(--ok)}.l.n{color:var(--bad)}.l.p{color:var(--warn)}.l.s{color:var(--muted)}
.l.g{font-weight:700}
.bars{display:grid;grid-template-columns:70px 1fr 44px;gap:3px 8px;align-items:center;font-size:13px}
.bars .t{height:10px;border-radius:5px;background:var(--bar)}.bars .t.hi{background:var(--barhi)}
.bars .v{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.legend{font-size:12px;color:var(--muted);margin-top:4px}
details{border-top:1px solid var(--line);padding:6px 0}summary{cursor:pointer}
.kind{font-size:11px;font-weight:700;text-transform:uppercase;margin-right:6px;color:var(--muted)}
.kind.gap{color:var(--bad)}
blockquote{margin:6px 0 6px 12px;padding:6px 10px;background:var(--quote);border-radius:6px;font-size:13px}
blockquote b{color:var(--accent)}
.reply{background:var(--quote);border-left:3px solid var(--accent);border-radius:6px;padding:10px 12px;margin-top:10px}
.reply small{display:block;color:var(--muted);font-weight:600;margin-bottom:2px}
[hidden]{display:none}
.summary h2{margin-bottom:8px}.sum{display:grid;grid-template-columns:56px 210px 90px 1fr;gap:8px;align-items:center;
padding:6px 4px;border-top:1px solid var(--line);color:var(--ink);text-decoration:none}.sum:hover{background:var(--quote)}.sum .badge{justify-self:start}
.muted{color:var(--muted)}
@media (max-width:640px){.sum{grid-template-columns:50px 1fr}.sum .muted{grid-column:2}}
@media (max-width:640px){.steps{grid-template-columns:1fr}.steps dt{margin-top:6px}}
"""

JS = """
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{
document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));
document.querySelectorAll('section.run').forEach(s=>s.hidden=s.id!==b.dataset.t);}));
"""


def e(text):
    return html.escape(str(text))


def line_class(line):
    if "GOVERNS" in line or line.startswith(("ANSWER", "DECLINE", "ESCALATE", "ASK")):
        return "g"
    return {"✓": "y", "✗": "n", "?": "p", "–": "s"}.get(line[:1], "")


def render_steps(r):
    rows = []
    for title, lines in r.steps:
        if title.startswith("Search results"):
            continue
        body = "".join(f'<span class="l {line_class(x)}">{e(x)}</span>' for x in lines)
        rows.append(f"<dt>{e(title.split(' (')[0])}</dt><dd>{body}</dd>")
    return f'<dl class="steps">{"".join(rows)}</dl>'


def render_bars(r):
    if not r.retrieved:
        return ""
    top = max(s for _, s in r.retrieved)
    cited = r.cited_ids
    rows = "".join(
        f'<span>{e(k)}</span><span class="t{" hi" if k in cited else ""}" '
        f'style="width:{max(4, round(100 * s / top))}%"></span><span class="v">{s:.1f}</span>'
        for k, s in r.retrieved
    )
    return (f'<div class="bars">{rows}</div><div class="legend">Search ranking (BM25). '
            "Blue = article actually quoted. Ranking never chooses the rule.</div>")


def render_claims(r):
    out = []
    for c in r.claims:
        quotes = "".join(f"<blockquote><b>{e(q.source_id)}</b>: “{e(q.span)}”</blockquote>"
                         for q in c.citations) or "<blockquote>no source states this</blockquote>"
        out.append(f'<details><summary><span class="kind {e(c.kind)}">{e(c.kind)}</span>{e(c.text)}'
                   f"</summary>{quotes}</details>")
    return "".join(out)


def render_summary(results, i):
    rows = []
    for r in results:
        label, tone = ACTION_BADGE.get(r.action, (r.action, "info"))
        key = ""
        if r.computed.get("credit") is not None:
            key = f"credit ${r.computed['credit']}"
        elif r.computed.get("request_deadline") is not None and r.intent == "request_deadline":
            d = r.computed["request_deadline"]
            key = f"deadline {d:%b} {d.day}, {d.year}"
        elif not r.covered:
            key = "not covered, no guessing"
        rows.append(
            f'<a class="sum" href="#r{i}-{r.turn_id.replace(':', '')}"><span class="time">{e(r.turn_id)}</span>'
            f'<span class="badge {tone}">{e(label)}</span><span>{e(r.governing_rule or "no rule")}</span>'
            f'<span class="muted">{e(key)}</span></a>')
    return f'<div class="card summary"><h2>At a glance (click a turn)</h2>{"".join(rows)}</div>'


def render_turn(r, anchor):
    label, tone = ACTION_BADGE.get(r.action, (r.action, "info"))
    rule = f'<span class="chip">governing: {e(r.governing_rule)}</span>' if r.governing_rule else ""
    grounded = ('<span class="chip">grounded</span>' if r.covered
                else '<span class="badge bad">NOT COVERED BY EVIDENCE</span>')
    return f"""<article class="card" id="{anchor}">
<div class="head"><span class="time">{e(r.turn_id)}</span><span class="badge {tone}">{e(label)}</span>{rule}{grounded}
<span class="chip">{e(r.intent)}</span></div>
<p class="cust">“{e(r.customer_text)}”</p>
{render_steps(r)}
{render_bars(r)}
<h2 style="margin-top:14px;font-size:14px">Claims and their quotes (click to expand)</h2>
{render_claims(r)}
<div class="reply"><small>Reply sent to customer</small>{e(r.reply)}</div>
</article>"""


def build(bundle, runs):
    tabs = "".join(
        f'<button data-t="run{i}" aria-selected="{str(i == 0).lower()}">{e(name)}</button>'
        for i, (name, _) in enumerate(runs)
    )
    sections = "".join(
        f'<section class="run" id="run{i}"{"" if i == 0 else " hidden"}>'
        + render_summary(results, i)
        + "".join(render_turn(r, f"r{i}-{r.turn_id.replace(':', '')}") for r in results) + "</section>"
        for i, (name, results) in enumerate(runs)
    )
    flow = '<div class="arrow">→</div>'.join(
        f'<div class="{"key" if t in ("Rule check", "Quote check") else ""}"><b>{n}. {e(t)}</b><span>{e(d)}</span></div>'
        for n, (t, d) in enumerate(PIPELINE, 1)
    )
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Policy-Grounded Agent Report</title>
<style>{CSS}</style></head><body><main>
<h1>Policy-Grounded Agent: workflow report</h1>
<p class="sub">How each customer turn was decided. Code picks the rule, search only supplies quotes,
and any claim without a quote turns the reply into a decline + escalation.</p>
<div class="flow">{flow}</div>
<div class="tabs" role="tablist">{tabs}</div>
{sections}
</main><script>{JS}</script></body></html>
"""


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", default=str(ROOT / "data"))
    p.add_argument("--out", default=str(ROOT / "report.html"))
    args = p.parse_args(argv)
    bundle = load_bundle(args.data)
    runs = [("Dana Whitfield (original)", run_conversation(bundle))]
    for f in sorted((Path(args.data) / "variants").glob("*.txt")):
        runs.append((f"Variant: {f.stem.replace('_', ' ')}",
                     run_conversation(bundle, transcript_text=f.read_text(encoding="utf-8"))))
    Path(args.out).write_text(build(bundle, runs), encoding="utf-8")
    print(f"wrote {args.out}  (open it in a browser)")


if __name__ == "__main__":
    main()
