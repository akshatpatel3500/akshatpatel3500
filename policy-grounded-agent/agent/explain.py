"""Human-readable, step-by-step explanation of how one turn was decided.

Re-derives every check from the same facts and policy functions the workflow
used, so the explanation cannot drift from the decision.
"""
import textwrap
from datetime import timedelta

from agent import policy
from agent.transcript import case_from

OK, FAIL, WAIT, SKIP = "✓", "✗", "?", "–"
POLICY_INTENTS = {"credit_amount", "dispute_open", "request_deadline", "verification"}


def _d(x):
    return f"{x:%b} {x.day}, {x.year}"


def _dt(x):
    return f"{_d(x.date())} {x.strftime('%I:%M %p').lstrip('0')}"


def _facts_lines(facts):
    lines = []
    if "mrc" in facts:
        lines.append(f"plan charge ${facts['mrc'].value:,.2f}/month")
    if "chat_date" in facts:
        lines.append(f"request date {_d(facts['chat_date'].value)}")
    if "statement_date" in facts:
        lines.append(f"invoice dated {_d(facts['statement_date'].value)}")
    if "line_item" in facts:
        lines.append(f"disputed item: {facts['line_item'].value}")
    noc = facts.get("noc")
    if noc:
        n = noc.value
        if n["start"]:
            lines.append(f"outage ticket {n['ticket']}: {_dt(n['start'])} → {_dt(n['end'])}")
        else:
            lines.append(f"outage ticket {n['ticket']}: window not verifiable")
    else:
        lines.append("outage ticket: none found in conversation yet")
    lines.append("dispute history / fraud flags: not available in a chat")
    return lines


def _credit_checks(facts):
    if "mrc" not in facts or "chat_date" not in facts:
        return [f"{FAIL} plan charge or request date missing → cannot evaluate"]
    f = case_from(facts)
    d = policy.decide_credit(f)
    out = [f"{WAIT} Rule 5 (repeat dispute / fraud, overrides all): history not in evidence → PENDING"
           if f.prior_resolved_disputes is None else f"{OK} Rule 5: no repeat dispute or fraud"]
    has_ticket = f.noc_status == "verified"
    out.append(f"{OK if has_ticket else (WAIT if f.noc_status == 'unverifiable' else FAIL)} "
               f"Rule 3 · NOC outage ticket: {f.noc_ticket or 'none'} ({f.noc_status})")
    if f.outage_start and f.outage_end:
        span = f.outage_end - f.outage_start
        hours = span / timedelta(hours=1)
        deadline = policy.request_deadline(f.outage_end)
        out.append(f"{OK if hours > policy.RULE3_MIN_HOURS else FAIL} Rule 3 · outage > "
                   f"{policy.RULE3_MIN_HOURS} hours: {hours:g} hours")
        out.append(f"{OK if f.request_date <= deadline else FAIL} Rule 3 · requested within "
                   f"{policy.RULE3_REQUEST_DAYS} days of resolution: {_d(f.request_date)} vs deadline {_d(deadline)}")
    if d.governing_rule in ("Rule 3", "Rule 5") and d.fallback_reason is None:
        out.append(f"→ Rule 3 (Service-Outage Credit) GOVERNS")
        out.append(f"{SKIP} Rule 2 ($75 goodwill cap): not applied, Rule 3 is the more specific rule")
        if d.credit is not None:
            span = f.outage_end - f.outage_start
            out.append(f"{OK if d.credit <= policy.RULE4B_MAX_CREDIT else FAIL} Rule 4(b) · credit "
                       f"${d.credit} ≤ ${policy.RULE4B_MAX_CREDIT}")
            out.append(f"{OK if span <= timedelta(days=policy.RULE4B_MAX_OUTAGE_DAYS) else FAIL} "
                       f"Rule 4(b) · outage ≤ {policy.RULE4B_MAX_OUTAGE_DAYS} days ({d.full_days} full days)")
        else:
            out.append(f"{FAIL} Rule 4(b) · ticket cannot be verified → ESCALATE")
        out.append(f"{SKIP} Rule 4(a) ($75 escalation): not checked, applies only to Rule 2 credits")
    else:
        out.append(f"→ Rule 3 fails ({d.fallback_reason}) → Rule 2 (general goodwill, $75 cap) GOVERNS")
        out.append(f"{WAIT} Rule 4(a) · rolling 12-month goodwill total not in evidence → PENDING")
    return out


def _rule_checks(facts, intent):
    if intent == "credit_amount":
        return _credit_checks(facts)
    if intent == "dispute_open":
        stmt, chat, item = facts.get("statement_date"), facts.get("chat_date"), facts.get("line_item")
        out = [f"{OK if item else FAIL} Rule 1 · specific line item named"
               + (f": {item.value}" if item else " → ask the customer")]
        if stmt and chat:
            e = policy.dispute_eligibility(stmt.value, chat.value)
            out.append(f"{OK if e.eligible else FAIL} Rule 1 · within {policy.RULE1_WINDOW_DAYS} days of "
                       f"statement: {_d(chat.value)} vs window end {_d(e.window_end)}")
            out.append("→ Rule 1 GOVERNS (dispute eligibility)")
        else:
            out.append(f"{WAIT} Rule 1 · statement date not given yet → ask the customer")
        return out
    if intent == "request_deadline":
        noc = facts.get("noc")
        out = ["→ Rule 3, condition 3 GOVERNS: 30 calendar days from the outage's resolution date"]
        if noc and noc.value["end"]:
            end = noc.value["end"].date()
            out.append(f"{OK} resolution {_d(end)} + {policy.RULE3_REQUEST_DAYS} days = "
                       f"{_d(policy.request_deadline(noc.value['end']))}")
        out.append(f"{SKIP} Rule 1 ({policy.RULE1_WINDOW_DAYS}-day window): not used, it is for "
                   "disputing the invoice, not requesting the outage credit")
        return out
    if intent == "verification":
        return [f"{SKIP} no policy decision needed (identity check, KB-1001 step 1)"]
    return [f"{SKIP} no rule in the policy governs this question → coverage check on the evidence"]


def _decision(result):
    a = result.action
    if a == "answer":
        return "ANSWER: every claim is quoted from a rule, KB article or the transcript"
    if a == "answer_pending":
        return f"ANSWER, BUT ISSUANCE PENDING: {', '.join(result.pending_checks)} check needed first"
    if a == "decline_escalate" and not result.covered:
        return "DECLINE + ESCALATE: the evidence does not answer this question, so no guessing"
    if a == "decline_escalate":
        return f"ESCALATE: {', '.join(result.escalation_rules)} requires Tier 2 before any credit"
    if a == "gather_info":
        return "ASK FOR MISSING INFORMATION before applying policy"
    return "ACKNOWLEDGE"


def build_steps(facts, intent, trigger_text, result):
    steps = [
        ("Facts found", _facts_lines(facts)),
        ("Question type", [f"{intent}" + (f'  (matched "{trigger_text}")' if trigger_text
                                          else "  (no known pattern → treated as unknown)")]),
        ("Rule check (code, fixed priority)", _rule_checks(facts, intent)),
        ("Search results (evidence only, never picks the rule)",
         ["  ·  ".join(f"{k} {s:.1f}" for k, s in result.retrieved) or "none"]),
    ]
    if intent not in POLICY_INTENTS:
        if result.covered:
            steps.append(("Coverage check", [f"{OK} a ranked article states the answer directly"]))
        else:
            steps.append(("Coverage check", [
                f"{FAIL} no ranked article states the answer; topical matches are not answers",
                "closest evidence quoted, rest marked not covered",
            ]))
    c = result.computed
    if c.get("credit") is not None:
        steps.append(("Math (in code)", [
            f"${case_from(facts).monthly_recurring_charge} ÷ {policy.PRORATION_DIVISOR} = "
            f"${c['daily_rate']}/day × {c['full_days']} full days = ${c['credit']}"]))
    elif c.get("request_deadline") is not None and intent == "request_deadline":
        steps.append(("Math (in code)", [f"deadline = {_d(c['request_deadline'])}"]))
    elif c.get("dispute_window_end") is not None:
        steps.append(("Math (in code)", [f"dispute window ends {_d(c['dispute_window_end'])}"]))
    quoted = sum(1 for cl in result.claims if cl.citations)
    gaps = sum(1 for cl in result.claims if cl.kind == "gap")
    sources = ", ".join(sorted(result.cited_ids)) or "none"
    steps.append(("Quote check", [
        f"{len(result.claims)} claims, {quoted} with exact quotes, {gaps} marked as not covered",
        f"sources: {sources}",
    ]))
    steps.append(("Decision", [_decision(result)]))
    return steps


def format_steps(result, width=100):
    """Numbered workflow view of one turn, followed by the reply."""
    out = [f'[{result.turn_id}] CUSTOMER: "{result.customer_text}"']
    for n, (title, lines) in enumerate(result.steps, 1):
        out.append(f" STEP {n}  {title}")
        for line in lines:
            out.append(textwrap.fill(line, width, initial_indent="         ",
                                     subsequent_indent="           "))
    out.append(" REPLY")
    out.append(textwrap.fill(result.reply, width, initial_indent="         ",
                             subsequent_indent="         "))
    return "\n".join(out)
