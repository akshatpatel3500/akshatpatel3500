#!/usr/bin/env python3
"""Live demo page: edit the conversation in the browser, click Run, see the workflow update.

    python3 serve.py              # then open http://localhost:8000
    python3 serve.py --port 8080

Runs only on this computer (127.0.0.1). Every click re-runs the same
run_conversation() used by run.py, chat.py and the tests; nothing is cached.
"""
import argparse
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from agent import load_bundle, run_conversation  # noqa: E402
from agent.transcript import parse_turns  # noqa: E402
from report import CSS, e, render_summary, render_turn  # noqa: E402

EXTRA_CSS = """
form.card textarea{width:100%;min-height:260px;font:13px/1.45 ui-monospace,Consolas,monospace;
background:var(--quote);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px}
form.card input[type=text]{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);
border-radius:8px;background:var(--quote);color:var(--ink)}
form.card label{display:block;font-weight:600;margin:10px 0 4px}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.row button,.row a{font:inherit;font-weight:600;border-radius:8px;padding:8px 16px;cursor:pointer;
border:1px solid var(--accent);text-decoration:none}
.row button{background:var(--accent);color:#fff}.row a{background:var(--card);color:var(--accent)}
.hint{color:var(--muted);font-size:13px;margin:4px 0 0}
.err{color:var(--bad);font-weight:600}
"""


def next_time(text):
    turns = parse_turns(text)
    if not turns:
        return "14:00"
    h, m = map(int, turns[-1].turn_id.split(":"))
    m += 2
    return f"{h + m // 60:02d}:{m % 60:02d}"


def customer_name(text):
    for t in parse_turns(text):
        if t.speaker == "Customer":
            return t.name
    return "Customer"


def page(bundle, text, question="", error=""):
    results, body_error = [], error
    try:
        results = run_conversation(bundle, transcript_text=text)
    except Exception as exc:  # show problems in the page instead of crashing the demo
        body_error = f"Could not process this conversation: {exc}"
    focus = results[-1].turn_id.replace(":", "") if results else ""
    cards = render_summary(results, 0) + "".join(
        render_turn(r, f"r0-{r.turn_id.replace(':', '')}") for r in results)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Policy-Grounded Agent Live</title>
<style>{CSS}{EXTRA_CSS}</style></head><body><main>
<h1>Policy-Grounded Agent: live demo</h1>
<p class="sub">Edit anything below (plan charge, outage dates, chat date) or add a new customer question,
then click <b>Run agent</b>. Every result is recomputed from the policy and KB.</p>
<form class="card" method="post" action="/run">
<label for="q">Add a customer question (optional)</label>
<input type="text" id="q" name="question" value=""
 placeholder="e.g. how much credit will I get?  /  can you waive my roaming fee?">
<label for="t">Conversation (editable)</label>
<textarea id="t" name="transcript">{e(text)}</textarea>
<p class="hint">Try: change <b>$225.00/month</b> to <b>$900.00/month</b>, or <b>September 21, 6:00 AM</b>
to <b>September 15, 6:00 AM</b>, or <b>Date: October 5, 2026</b> to <b>Date: October 25, 2026</b>.</p>
<div class="row"><button type="submit">Run agent</button><a href="/">Reset to original</a></div>
{f'<p class="err">{e(body_error)}</p>' if body_error else ''}
</form>
{cards}
</main>{f'<script>document.getElementById("r0-{focus}").scrollIntoView()</script>' if question and focus else ''}</body></html>"""


def make_handler(bundle):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, html_text, status=200):
            data = html_text.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self._send(page(bundle, bundle.transcript_text))
            else:
                self._send("<h1>Not found</h1>", 404)

        def do_POST(self):
            if self.path != "/run":
                self._send("<h1>Not found</h1>", 404)
                return
            length = min(int(self.headers.get("Content-Length", 0)), 1_000_000)
            form = parse_qs(self.rfile.read(length).decode("utf-8"), keep_blank_values=True)
            text = form.get("transcript", [""])[0].replace("\r\n", "\n")
            question = form.get("question", [""])[0].strip()
            if question:
                text = (text.rstrip() + f"\n\n[{next_time(text)}] Customer "
                        f"({customer_name(text)}): {question}\n")
            self._send(page(bundle, text, question))

        def log_message(self, fmt, *args):
            pass

    return Handler


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", default=str(ROOT / "data"))
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    bundle = load_bundle(args.data)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(bundle))
    url = f"http://localhost:{args.port}"
    print(f"Live demo running at {url}  (press Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
