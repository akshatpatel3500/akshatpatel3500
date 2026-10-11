"""Deterministic keyword intent classifier. First matching rule wins."""
import re

INTENT_RULES = [
    ("tax_surcharge", re.compile(r"\btax(es)?\b|surcharge|\bfees? (on|for) the credit", re.I)),
    ("request_deadline", re.compile(r"how long|deadline|time limit|by when|how many days", re.I)),
    ("credit_amount", re.compile(r"refund limit|\blimit\b|how much|credit amount|\$\d+(\.\d\d)? back|what (credit|refund)", re.I)),
    ("dispute_open", re.compile(r"\bdisput", re.I)),
    ("verification", re.compile(r"account (is|number)|card ending|last 4|\bpin\b", re.I)),
]


def classify(text):
    for intent, pattern in INTENT_RULES:
        if pattern.search(text):
            return intent
    return "unknown"
