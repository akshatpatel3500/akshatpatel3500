"""Deterministic keyword intent classifier. First matching rule wins."""
import re

INTENT_RULES = [
    ("tax_surcharge", re.compile(r"\btax(es)?\b|surcharge|\bfees? (on|for) the credit", re.I)),
    ("request_deadline", re.compile(r"how long|deadline|time limit|by when|how many days", re.I)),
    ("credit_amount", re.compile(
        r"refund limit|\blimit\b|how much|credit amount|\$\d+(\.\d\d)? back|what (credit|refund)"
        r"|\b(get|owe|give|receive|issue)\b.{0,40}\b(refund|credit)|\b(refund|credit)\b.{0,40}\b(get|owe|give|receive)\b",
        re.I)),
    ("dispute_open", re.compile(r"\bdisput", re.I)),
    ("verification", re.compile(r"account (is|number)|card ending|last 4|\bpin\b", re.I)),
]


def classify(text):
    for intent, pattern in INTENT_RULES:
        if pattern.search(text):
            return intent
    return "unknown"


def trigger(text):
    """The text span that decided the intent, or None for unknown."""
    for _, pattern in INTENT_RULES:
        m = pattern.search(text)
        if m:
            return m.group(0)
    return None
