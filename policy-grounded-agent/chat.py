#!/usr/bin/env python3
"""Live chat: type customer messages and see the agent's reply plus its workflow.

The conversation starts from the bundled transcript (so the account, invoice
and NOC outage ticket are already known); every message you type is appended
as a new customer turn and processed by exactly the same workflow as run.py.

    python3 chat.py            # step-by-step view under each reply
    python3 chat.py --brief    # reply only
    python3 chat.py --fresh    # start from the transcript header only
Commands: /steps (toggle steps), /quit
"""
import argparse
import sys
import textwrap
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from agent import load_bundle, run_conversation  # noqa: E402
from agent.explain import format_steps  # noqa: E402
from agent.transcript import parse_turns  # noqa: E402

WIDTH = 100


def next_time(text):
    turns = parse_turns(text)
    last = datetime.strptime(turns[-1].turn_id, "%H:%M") if turns else datetime(2000, 1, 1, 14, 0)
    return (last + timedelta(minutes=1)).strftime("%H:%M")


def customer_name(text):
    for t in parse_turns(text):
        if t.speaker == "Customer":
            return t.name
    return "Customer"


def start_text(bundle, fresh):
    text = bundle.transcript_text.rstrip() + "\n"
    if fresh:
        first = parse_turns(text)
        text = text[: first[0].position] if first else text
    return text


def reply_to(bundle, text, message):
    line = f"[{next_time(text)}] Customer ({customer_name(bundle.transcript_text)}): {message.strip()}\n"
    text = text.rstrip() + "\n\n" + line
    return text, run_conversation(bundle, transcript_text=text)[-1]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", default=str(ROOT / "data"))
    p.add_argument("--brief", action="store_true", help="show replies without the workflow steps")
    p.add_argument("--fresh", action="store_true", help="start without the existing conversation")
    args = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    bundle = load_bundle(args.data)
    text = start_text(bundle, args.fresh)
    show_steps = not args.brief
    print("Policy-grounded agent: live chat. Context:",
          "transcript header only" if args.fresh else "Dana Whitfield conversation so far")
    print("Type a customer message. Commands: /steps, /quit\n")
    for raw in sys.stdin if not sys.stdin.isatty() else iter(lambda: input("Customer> "), None):
        message = raw.strip()
        if not message:
            continue
        if message in ("/quit", "/exit", "quit", "exit"):
            break
        if message == "/steps":
            show_steps = not show_steps
            print(f"(steps {'on' if show_steps else 'off'})\n")
            continue
        if not sys.stdin.isatty():
            print(f"Customer> {message}")
        text, result = reply_to(bundle, text, message)
        if show_steps:
            print(format_steps(result, WIDTH))
        else:
            print(textwrap.fill(result.reply, WIDTH, initial_indent="Agent> ", subsequent_indent="       "))
        print("-" * WIDTH)


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print()
