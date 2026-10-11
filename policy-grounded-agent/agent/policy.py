"""Rules-as-code for BIL-POL-014 v6.2. Fixed precedence, pure functions of case facts.

Precedence: Rule 5 (repeat dispute / fraud) > Rule 3 (outage exception) > Rule 2
(general goodwill). Rule 4 thresholds are checked only after the governing track
is chosen. Rule 1 (dispute eligibility) is evaluated independently.
This module takes no evidence from search results; it reads facts only.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

RULE1_WINDOW_DAYS = 60
RULE2_CAP = Decimal("75.00")
RULE3_MIN_HOURS = 4
RULE3_REQUEST_DAYS = 30
PRORATION_DIVISOR = 30
RULE4B_MAX_CREDIT = Decimal("300.00")
RULE4B_MAX_OUTAGE_DAYS = 30
RULE5_REPEAT_DAYS = 90

CENT = Decimal("0.01")


@dataclass(frozen=True)
class CaseFacts:
    monthly_recurring_charge: Decimal
    outage_start: datetime | None
    outage_end: datetime | None
    noc_ticket: str | None
    noc_status: str  # "verified" | "none" | "unverifiable"
    request_date: date
    prior_resolved_disputes: tuple | None = None  # None = history unknown
    fraud_flags: tuple = ()


@dataclass
class CreditDecision:
    governing_rule: str
    credit: Decimal | None = None
    daily_rate: Decimal | None = None
    full_days: int | None = None
    cap_applies: bool = False
    escalate: bool = False
    escalation_rules: list = field(default_factory=list)
    pending_checks: list = field(default_factory=list)
    frontline_may_issue: bool = False
    fallback_reason: str | None = None
    request_deadline: date | None = None
    rule5_reason: str | None = None


@dataclass
class DisputeEligibility:
    eligible: bool
    window_end: date
    days_since_statement: int
    needs_tier2_signoff: bool


def money(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def full_days(start, end):
    """Complete 24-hour periods without service (floor)."""
    return (end - start) // timedelta(days=1)


def request_deadline(outage_end):
    return outage_end.date() + timedelta(days=RULE3_REQUEST_DAYS)


def dispute_eligibility(statement_date, request_date):
    window_end = statement_date + timedelta(days=RULE1_WINDOW_DAYS)
    eligible = request_date <= window_end
    return DisputeEligibility(
        eligible=eligible,
        window_end=window_end,
        days_since_statement=(request_date - statement_date).days,
        needs_tier2_signoff=not eligible,
    )


def _rule3_failure(f):
    """Return None if every Rule 3 condition holds, else the first failed condition."""
    if f.noc_status == "none" or (f.noc_status == "verified" and f.noc_ticket is None):
        return "no NOC outage ticket exists for the address and dates"
    if f.outage_start is None or f.outage_end is None:
        return None if f.noc_status == "unverifiable" else "the outage window is unknown"
    if f.outage_end - f.outage_start <= timedelta(hours=RULE3_MIN_HOURS):
        return f"the outage did not exceed {RULE3_MIN_HOURS} consecutive hours"
    if f.request_date > request_deadline(f.outage_end):
        return (
            f"the request was made more than {RULE3_REQUEST_DAYS} calendar days "
            "after the outage was resolved"
        )
    return None


def _rule5_reason(f):
    if f.fraud_flags:
        return "fraud indicators present: " + ", ".join(f.fraud_flags)
    for prior in f.prior_resolved_disputes or ():
        if 0 <= (f.request_date - prior).days <= RULE5_REPEAT_DAYS:
            return f"prior dispute resolved {prior.isoformat()}, within {RULE5_REPEAT_DAYS} days"
    return None


def decide_credit(f):
    failure = _rule3_failure(f)
    if failure is None:
        d = CreditDecision(governing_rule="Rule 3")
        if f.outage_start is not None and f.outage_end is not None:
            d.full_days = full_days(f.outage_start, f.outage_end)
            d.daily_rate = money(f.monthly_recurring_charge / PRORATION_DIVISOR)
            d.credit = money(f.monthly_recurring_charge / PRORATION_DIVISOR * d.full_days)
            d.request_deadline = request_deadline(f.outage_end)
            too_long = f.outage_end - f.outage_start > timedelta(days=RULE4B_MAX_OUTAGE_DAYS)
        else:
            too_long = False
        if (
            f.noc_status == "unverifiable"
            or (d.credit is not None and d.credit > RULE4B_MAX_CREDIT)
            or too_long
        ):
            d.escalation_rules.append("Rule 4(b)")
    else:
        d = CreditDecision(governing_rule="Rule 2", cap_applies=True, fallback_reason=failure)
        if f.outage_end is not None:
            d.request_deadline = request_deadline(f.outage_end)
        # Rolling 12-month goodwill total is not part of the case facts.
        d.pending_checks.append("Rule 4(a)")

    d.rule5_reason = _rule5_reason(f)
    if d.rule5_reason:
        d.governing_rule = "Rule 5"
        d.escalation_rules.append("Rule 5")
    elif f.prior_resolved_disputes is None:
        d.pending_checks.insert(0, "Rule 5")

    d.escalate = bool(d.escalation_rules)
    d.frontline_may_issue = not d.escalate and not d.pending_checks
    return d
