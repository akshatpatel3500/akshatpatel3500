"""Multi-turn workflow: intent -> facts -> policy engine -> evidence -> grounded reply.

Every sentence of a reply that states a fact is a Claim carrying verbatim
citations. Rule citations come from the policy layer the engine selected; KB
citations are found by searching the BM25-ranked articles for the statement the
claim needs. If a question's answer is not stated in the ranked evidence, the
turn declines and escalates instead of answering.
"""
import re
from dataclasses import dataclass, field

from agent import policy
from agent.intents import classify
from agent.loader import TRANSCRIPT_ID, normalize
from agent.retrieval import BM25Index
from agent.transcript import case_facts, parse_turns

TRACE_TOP_K = 5
ESCALATE_TO = "a Tier 2 Billing Specialist"

INTENT_QUERY_TERMS = {
    "dispute_open": "dispute charge invoice statement date line item",
    "credit_amount": "credit amount limit calculation escalation",
    "request_deadline": "request credit within days resolved deadline",
    "tax_surcharge": "credit taxes regulatory surcharges plan charge",
    "verification": "confirm identity account number payment method",
}

# A KB span must state the relationship asked about, not just share its topic.
ANSWERABILITY = {
    "tax_surcharge": [
        re.compile(r"[^.]*\bcredits?\b[^.]{0,80}\b(reduc|offset|lower|appl|includ|exclud)\w*[^.]{0,60}\b(tax|surcharge)\w*[^.]*"),
        re.compile(r"[^.]*\b(tax|surcharge)\w*[^.]{0,80}\b(reduc|offset|lower|credited|adjusted|refunded)\w*[^.]{0,60}\bcredits?\b[^.]*"),
    ],
}
CLOSEST_EVIDENCE = {
    "tax_surcharge": [
        re.compile(r"\b(?:This|The|An?) [^.]{0,40}?\bcredit applies to\b[^.]*?\bonly\b"),
        re.compile(r"Taxes and surcharges are [^.;]*?authority"),
    ],
}


class PolicyTextDrift(RuntimeError):
    """A rule span the engine relies on is no longer in the policy text."""


@dataclass(frozen=True)
class Citation:
    source_id: str
    span: str


@dataclass
class Claim:
    text: str
    kind: str  # "fact" | "calc" | "gap"
    citations: list = field(default_factory=list)


@dataclass
class TurnResult:
    turn_id: str
    customer_text: str
    intent: str
    action: str
    governing_rule: str | None
    reply: str
    claims: list
    retrieved: list
    computed: dict
    covered: bool
    escalate: bool
    escalation_rules: list
    pending_checks: list

    @property
    def cited_ids(self):
        return {c.source_id for claim in self.claims for c in claim.citations}


def fmt_date(d):
    return f"{d:%B} {d.day}, {d.year}"


def fmt_dt(dt):
    return f"{fmt_date(dt.date())} {dt.strftime('%I:%M %p').lstrip('0')}"


def usd(x):
    return f"${x:,.2f}"


class Evidence:
    def __init__(self, bundle, transcript_text, ranked):
        self.rules = {rid: normalize(s.text) for rid, s in bundle.rules.items()}
        self.kb = {kid: normalize(s.text) for kid, s in bundle.articles.items()}
        self.transcript = normalize(transcript_text)
        self.ranked = [kid for kid, _ in ranked]

    def rule(self, rule_id, pattern):
        m = re.search(pattern, self.rules.get(rule_id, ""))
        if not m:
            raise PolicyTextDrift(f"{rule_id}: pattern {pattern!r} not found")
        return Citation(rule_id, m.group(0))

    def kb_span(self, pattern):
        """First ranked article stating the pattern, or None."""
        for kid in self.ranked:
            m = re.search(pattern, self.kb[kid])
            if m:
                return Citation(kid, m.group(0))
        return None

    def said(self, span):
        span = normalize(span)
        if span not in self.transcript:
            raise ValueError(f"transcript span not found: {span!r}")
        return Citation(TRANSCRIPT_ID, span)


def claim(text, kind, *citations):
    return Claim(text, kind, [c for c in citations if c is not None])


def _result(turn, intent, ranked, claims, closing="", **kw):
    reply = " ".join([c.text for c in claims] + ([closing] if closing else []))
    base = dict(
        governing_rule=None, computed={}, covered=True, escalate=False,
        escalation_rules=[], pending_checks=[],
    )
    base.update(kw)
    return TurnResult(
        turn_id=turn.turn_id, customer_text=turn.text, intent=intent, reply=reply,
        claims=claims, retrieved=ranked[:TRACE_TOP_K], **base,
    )


# ---------------------------------------------------------------- handlers
def handle_verification(turn, facts, ev, ranked):
    claims = [claim(
        "Thanks. I'll verify your identity using your account number and the last 4 digits "
        "of the payment method on file.", "fact",
        ev.kb_span(r"Confirm the account holder's identity \([^)]*\)"),
    )]
    return _result(turn, "verification", ranked, claims, action="acknowledge")


def handle_dispute(turn, facts, ev, ranked):
    stmt, item, chat = facts.get("statement_date"), facts.get("line_item"), facts.get("chat_date")
    rule1_item = ev.rule("Rule 1", r"The dispute must identify the specific line item or charge being contested")
    if not (stmt and item and chat):
        claims = [claim(
            "To open a dispute I need the specific charge you're contesting as it appears on "
            "the invoice, and the dates you were without service.", "fact",
            rule1_item,
            ev.kb_span(r"Identify the exact line item being disputed[^.]*"),
            ev.kb_span(r"Confirm the customer's service address and the approximate outage dates"),
        )]
        return _result(turn, "dispute_open", ranked, claims, action="gather_info", governing_rule="Rule 1")

    e = policy.dispute_eligibility(stmt.value, chat.value)
    window = ev.rule("Rule 1", rf"[^.]*within {policy.RULE1_WINDOW_DAYS} calendar days of the statement date[^.]*\.")
    claims = [
        claim(f"You're disputing the {item.value} on the invoice dated {fmt_date(stmt.value)}.",
              "fact", ev.said(item.span), ev.said(stmt.span), rule1_item),
    ]
    computed = {"dispute_eligible": e.eligible, "dispute_window_end": e.window_end,
                "statement_date": stmt.value}
    if e.eligible:
        claims.append(claim(
            f"A charge can be disputed within {policy.RULE1_WINDOW_DAYS} calendar days of the "
            f"statement date, so the window for this invoice runs through {fmt_date(e.window_end)}. "
            f"Today, {fmt_date(chat.value)}, is {e.days_since_statement} days after the statement "
            "date, so your dispute is eligible.", "calc",
            window, ev.kb_span(r"Customers can dispute a specific charge[^.]*"), ev.said(chat.span),
        ))
        claims.append(claim(
            "Because the charge relates to a service outage, I'll confirm which policy governs "
            "before calculating any credit.", "fact",
            ev.kb_span(r"Determine which policy governs the disputed charge[^.]*"),
        ))
        return _result(turn, "dispute_open", ranked, claims, action="answer",
                       governing_rule="Rule 1", computed=computed)
    claims.append(claim(
        f"The {policy.RULE1_WINDOW_DAYS}-day dispute window for this invoice ended on "
        f"{fmt_date(e.window_end)}, so a late dispute needs Tier 2 Billing Specialist sign-off "
        "and is not guaranteed.", "calc",
        window, ev.rule("Rule 1", r"Disputes filed after the \d+-day window[^.]*\."), ev.said(chat.span),
    ))
    return _result(turn, "dispute_open", ranked, claims, action="decline_escalate",
                   governing_rule="Rule 1", computed=computed, escalate=True,
                   escalation_rules=["Rule 1"],
                   )


def _case_from(facts):
    noc = facts.get("noc")
    n = noc.value if noc else {"ticket": None, "start": None, "end": None, "status": "unverifiable"}
    return policy.CaseFacts(
        monthly_recurring_charge=facts["mrc"].value,
        outage_start=n["start"], outage_end=n["end"], noc_ticket=n["ticket"],
        noc_status=n["status"], request_date=facts["chat_date"].value,
        prior_resolved_disputes=None, fraud_flags=(),
    )


def _rule5_claim(ev, d):
    tier2 = ev.rule("Rule 5", r"must have the credit decision made by a Tier 2 Billing Specialist, not the front-line agent")
    kb = ev.kb_span(r"the new dispute must be handled by a Tier 2 Billing Specialist[^.]*")
    if d.rule5_reason:
        return claim(
            "Because this account has a recent prior dispute or a fraud indicator, the credit "
            f"decision has to be made by {ESCALATE_TO}.", "fact", tier2, kb)
    return claim(
        "Before it is issued, the credit is pending a repeat-dispute and fraud check: your "
        f"dispute history isn't in the information I have, and if a prior dispute was resolved in "
        f"the last {policy.RULE5_REPEAT_DAYS} days the decision must be made by {ESCALATE_TO}.",
        "fact", tier2, kb)


def handle_credit(turn, facts, ev, ranked):
    if "mrc" not in facts or "chat_date" not in facts:
        return handle_uncovered(turn, "credit_amount", ev, ranked)
    d = policy.decide_credit(_case_from(facts))
    noc = facts.get("noc")
    claims = []
    computed = {"credit": d.credit, "full_days": d.full_days, "daily_rate": d.daily_rate,
                "cap_applies": d.cap_applies, "request_deadline": d.request_deadline}
    rule4b = ev.rule("Rule 4", r"b\. A Service-Outage Credit calculated under Rule 3 exceeds \$[\d.,]+\d[^.]*")

    if d.governing_rule in ("Rule 3", "Rule 5") and d.fallback_reason is None and d.credit is not None:
        n = noc.value
        claims.append(claim(
            f"Outage ticket {n['ticket']} confirms your service was out from {fmt_dt(n['start'])} "
            f"to {fmt_dt(n['end'])}, more than {policy.RULE3_MIN_HOURS} consecutive hours, and you're "
            f"asking within {policy.RULE3_REQUEST_DAYS} calendar days of the outage being resolved, "
            "so this falls under the Service-Outage Credit policy rather than the general refund limit.",
            "fact",
            ev.said(noc.span),
            ev.rule("Rule 3", r"A valid NOC outage ticket number exists[^.]*\."),
            ev.rule("Rule 3", rf"The outage duration recorded on the NOC ticket exceeds {policy.RULE3_MIN_HOURS} consecutive hours\."),
            ev.rule("Rule 3", rf"The customer requests the credit within {policy.RULE3_REQUEST_DAYS} calendar days of the outage's resolution date[^.]*\."),
            ev.kb_span(r"If Network Operations \(NOC\) confirms a service outage[^,]*"),
        ))
        claims.append(claim(
            f"The credit is (monthly recurring charge {usd(facts['mrc'].value)} ÷ "
            f"{policy.PRORATION_DIVISOR}) × {d.full_days} full days without service = "
            f"{usd(d.daily_rate)} × {d.full_days} = {usd(d.credit)}.", "calc",
            ev.rule("Rule 3", r"Service-Outage Credit = \(current monthly recurring charge ÷ \d+\) × number of full days the account was without service"),
            ev.kb_span(r"\(current monthly recurring charge ÷ \d+\) × number of full days without service"),
            ev.said(facts["mrc"].span), ev.said(noc.span),
        ))
        claims.append(claim(
            f"The {usd(policy.RULE2_CAP)} limit you saw is the general goodwill limit; it does not "
            "apply here, because a Service-Outage Credit is not counted against, and not capped by, "
            "that limit.", "fact",
            ev.rule("Rule 3", r"not counted against, and not capped by, the \$75\.00 General Refund/Goodwill Credit Limit"),
            ev.kb_span(r"is issued separately from, and is not limited by, the standard \$75\.00 goodwill credit ceiling[^.]*?KB-1002"),
        ))
        if "Rule 4(b)" in d.escalation_rules:
            claims.append(claim(
                f"Because the credit is above {usd(policy.RULE4B_MAX_CREDIT)} or the outage lasted "
                f"more than {policy.RULE4B_MAX_OUTAGE_DAYS} consecutive days, {ESCALATE_TO} has to "
                "approve it before it is applied.", "fact",
                rule4b, ev.kb_span(r"Above either threshold, escalate[^.]*"),
            ))
        else:
            claims.append(claim(
                f"No escalation is needed for the amount: {usd(d.credit)} is not above "
                f"{usd(policy.RULE4B_MAX_CREDIT)} and the outage did not exceed "
                f"{policy.RULE4B_MAX_OUTAGE_DAYS} consecutive days.", "fact",
                rule4b,
                ev.rule("Rule 4", r"a Service-Outage Credit that exceeds \$75\.00 does not, by itself, trigger escalation under \(a\)"),
                ev.kb_span(r"If the calculated credit is \$300\.00 or less[^.]*"),
                ev.kb_span(r"A Service-Outage Credit above \$75\.00 does not by itself require escalation"),
            ))
    elif d.governing_rule == "Rule 3":  # ticket mentioned but not verifiable
        claims.append(claim(
            f"I can't verify a NOC outage ticket for these dates, so {ESCALATE_TO} must review this "
            "before any outage credit is calculated or applied.", "fact",
            rule4b, ev.kb_span(r"the NOC ticket can't be verified"),
        ))
    else:
        claims.append(claim(
            f"This request doesn't qualify for a Service-Outage Credit because {d.fallback_reason}.",
            "fact",
            ev.rule("Rule 3", r"If any condition is not met.*?Rule 4 escalation\."),
            ev.said(noc.span) if noc else None,
            ev.said(facts["chat_date"].span),
        ))
        claims.append(claim(
            f"It would be reviewed as a general goodwill credit instead, which is limited to "
            f"{usd(policy.RULE2_CAP)} per account per rolling 12-month period across all goodwill "
            "credits. I don't have this account's goodwill credit history, so I can't promise an "
            "amount until that is checked.", "fact",
            ev.rule("Rule 2", r"up to \$75\.00 per account, per rolling 12-month period"),
            ev.kb_span(r"do not promise an amount above \$75\.00 without that approval"),
        ))
    claims.append(_rule5_claim(ev, d))

    if d.escalate:
        action, closing = "decline_escalate", f"I'm escalating this to {ESCALATE_TO} before any credit is issued."
    elif d.pending_checks:
        action, closing = "answer_pending", "I'll confirm as soon as that check is complete."
    else:
        action, closing = "answer", ""
    return _result(turn, "credit_amount", ranked, claims, closing, action=action,
                   governing_rule=d.governing_rule, computed=computed, escalate=d.escalate,
                   escalation_rules=list(d.escalation_rules), pending_checks=list(d.pending_checks))


def handle_deadline(turn, facts, ev, ranked):
    noc, chat = facts.get("noc"), facts.get("chat_date")
    rule3 = ev.rule("Rule 3", rf"The customer requests the credit within {policy.RULE3_REQUEST_DAYS} calendar days of the outage's resolution date[^.]*\.")
    kb_rule = ev.kb_span(r"the request must be made within \d+ days of the outage being resolved")
    kb_step = ev.kb_span(r"Confirm the customer is requesting within \d+ days of the ticket's resolution date")
    rule1 = ev.rule("Rule 1", rf"[^.]*within {policy.RULE1_WINDOW_DAYS} calendar days of the statement date[^.]*\.")
    computed = {}
    if noc and noc.value["end"] is not None:
        end = noc.value["end"]
        deadline = policy.request_deadline(end)
        computed["request_deadline"] = deadline
        claims = [claim(
            f"A Service-Outage Credit must be requested within {policy.RULE3_REQUEST_DAYS} calendar "
            f"days of the outage's resolution date. Your outage was resolved on {fmt_date(end.date())}, "
            f"so the deadline is {fmt_date(deadline)}.", "calc",
            rule3, kb_rule, kb_step, ev.said(noc.span),
        )]
        if chat:
            day = (chat.value - end.date()).days
            if chat.value <= deadline:
                claims.append(claim(
                    f"Today, {fmt_date(chat.value)}, is day {day} of {policy.RULE3_REQUEST_DAYS}, so "
                    "your request is within the window.", "calc", rule3, ev.said(chat.span)))
            else:
                claims.append(claim(
                    f"Today, {fmt_date(chat.value)}, is past that deadline, so a request now is "
                    "reviewed as a general goodwill request instead.", "calc",
                    ev.rule("Rule 3", r"If any condition is not met.*?Rule 4 escalation\."),
                    ev.said(chat.span)))
    else:
        claims = [claim(
            f"A Service-Outage Credit must be requested within {policy.RULE3_REQUEST_DAYS} calendar "
            "days of the outage's resolution date, as recorded on the NOC outage ticket.", "fact",
            rule3, kb_rule, kb_step)]
    claims.append(claim(
        f"That is separate from the {policy.RULE1_WINDOW_DAYS}-day window for disputing an invoice "
        "charge, which runs from the statement date.", "fact", rule1))
    return _result(turn, "request_deadline", ranked, claims, action="answer",
                   governing_rule="Rule 3", computed=computed)


def handle_uncovered(turn, intent, ev, ranked):
    """Answer only if a ranked KB span states the asked relationship; otherwise decline."""
    for pattern in ANSWERABILITY.get(intent, []):
        span = ev.kb_span(pattern)
        if span:
            claims = [claim(span.span, "fact", span)]
            return _result(turn, intent, ranked, claims, action="answer")
    claims = []
    closest = [ev.kb_span(p) for p in CLOSEST_EVIDENCE.get(intent, [])]
    if closest and closest[0]:
        claims.append(claim(
            "Our outage-credit guidance says this credit applies to the recurring plan charge only.",
            "fact", closest[0]))
    if intent == "tax_surcharge":
        claims.append(claim(
            "It does not say whether the taxes and regulatory surcharges billed for those days are "
            "reduced or adjusted, and our billing guidance only explains that taxes and surcharges "
            "are itemized separately and passed through from the taxing authority, so I won't guess.",
            "gap", *[c for c in closest[1:] if c]))
    else:
        claims.append(claim(
            "I don't have documented policy or knowledge-base guidance that answers this, so I "
            "won't guess.", "gap"))
    closing = (f"I'm escalating this question to {ESCALATE_TO} and will follow up with a "
               "confirmed answer.")
    return _result(turn, intent, ranked, claims, closing, action="decline_escalate",
                   covered=False, escalate=True)


HANDLERS = {
    "verification": handle_verification,
    "dispute_open": handle_dispute,
    "credit_amount": handle_credit,
    "request_deadline": handle_deadline,
}


def _query(turn, intent, facts):
    parts = [turn.text, INTENT_QUERY_TERMS.get(intent, "")]
    if "noc" in facts or re.search(r"\boutage|service (was|went) (out|down)", turn.text, re.I):
        parts.append("service outage")
    return " ".join(parts)


def run_conversation(bundle, transcript_text=None):
    text = transcript_text if transcript_text is not None else bundle.transcript_text
    index = BM25Index((kid, f"{a.title} {a.text}") for kid, a in sorted(bundle.articles.items()))
    turns = parse_turns(text)
    results = []
    for i, turn in enumerate(turns):
        if turn.speaker != "Customer":
            continue
        facts = case_facts(text, turns[: i + 1])
        intent = classify(turn.text)
        ranked = index.search(_query(turn, intent, facts))
        ev = Evidence(bundle, text, ranked)
        handler = HANDLERS.get(intent)
        if handler:
            results.append(handler(turn, facts, ev, ranked))
        else:
            results.append(handle_uncovered(turn, intent, ev, ranked))
    return results
