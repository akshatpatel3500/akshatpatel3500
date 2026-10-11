#!/usr/bin/env python3
"""Run the policy-grounded agent over a transcript and print a per-turn reviewer trace.

    python3 run.py                       # bundled data/
    python3 run.py --data DIR            # another policy/KB/transcript set
    python3 run.py --transcript FILE     # a variant transcript against bundled policy/KB
    python3 run.py --explain             # numbered step-by-step workflow view per turn
"""
import argparse
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from agent import load_bundle, run_conversation  # noqa: E402
from agent.explain import format_steps  # noqa: E402

WIDTH = 100


def wrap(text, indent):
    return textwrap.fill(text, WIDTH, initial_indent=indent, subsequent_indent=indent)


def render(results):
    out = []
    for r in results:
        out.append("=" * WIDTH)
        out.append(f"[{r.turn_id}] CUSTOMER: {r.customer_text}")
        out.append("-" * WIDTH)
        out.append(f"intent: {r.intent}   action: {r.action}   governing policy: {r.governing_rule or '-'}")
        out.append(f"grounded: {'yes' if r.covered else 'NO (evidence does not answer)'}   "
                   f"escalate: {'yes ' + ', '.join(r.escalation_rules) if r.escalate else 'no'}   "
                   f"pending: {', '.join(r.pending_checks) or '-'}")
        ranked = ", ".join(f"{kid} ({score:.2f})" for kid, score in r.retrieved) or "-"
        out.append(f"retrieved (BM25, evidence only): {ranked}")
        kb_cited = sorted(i for i in r.cited_ids if i.startswith("KB-"))
        out.append(f"KB articles cited: {', '.join(kb_cited) or '-'}")
        shown = {k: v for k, v in r.computed.items() if v is not None}
        if shown:
            out.append("computed: " + ", ".join(f"{k}={v}" for k, v in shown.items()))
        out.append("claims:")
        for c in r.claims:
            out.append(wrap(f"[{c.kind}] {c.text}", "  "))
            for cit in c.citations:
                out.append(wrap(f'<- {cit.source_id}: "{cit.span}"', "      "))
        out.append("reply:")
        out.append(wrap(r.reply, "  "))
    out.append("=" * WIDTH)
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", default=str(ROOT / "data"), help="directory with policy, KB and transcript")
    p.add_argument("--transcript", help="transcript file to use instead of the one in --data")
    p.add_argument("--explain", action="store_true", help="show the step-by-step workflow view")
    args = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
    bundle = load_bundle(args.data)
    text = Path(args.transcript).read_text(encoding="utf-8") if args.transcript else None
    results = run_conversation(bundle, transcript_text=text)
    if args.explain:
        sep = "\n" + "=" * WIDTH + "\n"
        print(sep.join(format_steps(r, WIDTH) for r in results))
    else:
        print(render(results))


if __name__ == "__main__":
    main()
