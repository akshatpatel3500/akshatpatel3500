"""Parse a chat transcript into turns and extract case facts with their source spans."""
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from agent.policy import CaseFacts

TURN_RE = re.compile(r"^\[(\d{2}:\d{2})\] (Customer|Agent) \(([^)]+)\): (.*)$", re.M)
DATE_RE = re.compile(r"^Date: ([A-Z][a-z]+ \d{1,2}, \d{4})$", re.M)
MRC_RE = re.compile(r"^Plan: .*?\$([\d,]+\.\d{2})/month recurring charge$", re.M)
STATEMENT_RE = re.compile(
    r"(?:invoice|statement|bill) dated ([A-Z][a-z]+ \d{1,2})(?:st|nd|rd|th)?(?:, (\d{4}))?"
)
LINE_ITEM_RE = re.compile(r"disputing (?:the )?(.+?) on the (?:invoice|statement|bill)")
TICKET_RE = re.compile(r"OUT-\d+")
TICKET_WINDOW_RE = re.compile(
    r"(OUT-\d+)[^.]*?covering ([A-Z][a-z]+ \d{1,2}), (\d{1,2}:\d{2} [AP]M) "
    r"through ([A-Z][a-z]+ \d{1,2}), (\d{1,2}:\d{2} [AP]M)"
)


@dataclass(frozen=True)
class Turn:
    turn_id: str
    speaker: str
    name: str
    text: str
    position: int


@dataclass
class Fact:
    value: object
    span: str  # verbatim transcript text supporting the value


def parse_turns(text):
    return [
        Turn(m.group(1), m.group(2), m.group(3), m.group(4).strip(), m.start())
        for m in TURN_RE.finditer(text)
    ]


def _in_year(month_day, year, time=None):
    if time:
        return datetime.strptime(f"{month_day} {year} {time}", "%B %d %Y %I:%M %p")
    return datetime.strptime(f"{month_day} {year}", "%B %d %Y").date()


def header_facts(text):
    facts = {}
    m = DATE_RE.search(text)
    if m:
        facts["chat_date"] = Fact(datetime.strptime(m.group(1), "%B %d, %Y").date(), m.group(0))
    m = MRC_RE.search(text)
    if m:
        facts["mrc"] = Fact(Decimal(m.group(1).replace(",", "")), m.group(0))
    return facts


def case_facts(text, turns_so_far):
    """Facts known after the given turns, each with the span that states it."""
    facts = header_facts(text)
    chat_date = facts.get("chat_date")
    year = chat_date.value.year if chat_date else date.today().year
    for turn in turns_so_far:
        if turn.speaker == "Customer":
            m = STATEMENT_RE.search(turn.text)
            if m:
                stmt = _in_year(m.group(1), m.group(2) or year)
                if chat_date and not m.group(2) and stmt > chat_date.value:
                    stmt = _in_year(m.group(1), year - 1)
                facts["statement_date"] = Fact(stmt, m.group(0))
            m = LINE_ITEM_RE.search(turn.text)
            if m:
                facts["line_item"] = Fact(m.group(1), m.group(0))
        else:
            m = TICKET_WINDOW_RE.search(turn.text)
            if m:
                start = _in_year(m.group(2), year, m.group(3))
                end = _in_year(m.group(4), year, m.group(5))
                facts["noc"] = Fact(
                    {"ticket": m.group(1), "start": start, "end": end, "status": "verified"},
                    m.group(0),
                )
            elif "noc" not in facts:
                m = TICKET_RE.search(turn.text)
                if m:
                    facts["noc"] = Fact(
                        {"ticket": m.group(0), "start": None, "end": None, "status": "unverifiable"},
                        m.group(0),
                    )
    return facts


def case_from(facts):
    """CaseFacts for the policy engine. Dispute history and fraud flags are never in a chat."""
    noc = facts.get("noc")
    n = noc.value if noc else {"ticket": None, "start": None, "end": None, "status": "unverifiable"}
    return CaseFacts(
        monthly_recurring_charge=facts["mrc"].value,
        outage_start=n["start"], outage_end=n["end"], noc_ticket=n["ticket"],
        noc_status=n["status"], request_date=facts["chat_date"].value,
        prior_resolved_disputes=None, fraud_flags=(),
    )
