"""Locked expectations for the policy-grounded agent prototype (see SPEC.md).

Written before implementation. Standard library only.
Run from the project root:  python3 -m unittest discover -s tests -v
"""
import ast
import re
import subprocess
import sys
import unittest
from dataclasses import replace
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
sys.path.insert(0, str(ROOT))

from agent import load_bundle, run_conversation  # noqa: E402
from agent.policy import CaseFacts, decide_credit  # noqa: E402

BUNDLE = load_bundle(DATA_DIR)
TRANSCRIPT = next(DATA_DIR.glob("*Transcript*.txt")).read_text(encoding="utf-8")

ALLOWED_ACTIONS = {"answer", "answer_pending", "decline_escalate", "gather_info", "acknowledge"}
MONEY_RE = re.compile(r"\$\d[\d,]*\.\d{2}")
DATE_RE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|"
    r"November|December) \d{1,2}, \d{4}\b"
)
TAX_RE = re.compile(r"\b(tax|taxes|surcharge|surcharges)\b", re.I)


def normalize(text):
    text = text.replace("**", "").replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


def by_turn(results):
    return {r.turn_id: r for r in results}


def cites(result, source_id, fragment):
    return any(
        c.source_id == source_id and fragment in normalize(c.span)
        for claim in result.claims
        for c in claim.citations
    )


BASE_TURNS = by_turn(run_conversation(BUNDLE))


# --------------------------------------------------------------------------
# Locked per-turn expectations
# --------------------------------------------------------------------------
class TestTurn1406DisputeEligibility(unittest.TestCase):
    def setUp(self):
        self.r = BASE_TURNS["14:06"]

    def test_rule_1_governs_and_answers(self):
        self.assertEqual(self.r.intent, "dispute_open")
        self.assertEqual(self.r.action, "answer")
        self.assertEqual(self.r.governing_rule, "Rule 1")
        self.assertTrue(self.r.covered)
        self.assertFalse(self.r.escalate)

    def test_cites_rule_1_and_kb_1001(self):
        self.assertIn("Rule 1", self.r.cited_ids)
        self.assertIn("KB-1001", self.r.cited_ids)
        self.assertTrue(cites(self.r, "Rule 1", "60 calendar days of the statement date"))

    def test_eligibility_computed(self):
        self.assertTrue(self.r.computed["dispute_eligible"])
        self.assertEqual(self.r.computed["dispute_window_end"], date(2026, 11, 30))


class TestTurn1409OutageCredit(unittest.TestCase):
    def setUp(self):
        self.r = BASE_TURNS["14:09"]

    def test_rule_3_governs_not_rule_2(self):
        self.assertEqual(self.r.intent, "credit_amount")
        self.assertEqual(self.r.governing_rule, "Rule 3")

    def test_arithmetic(self):
        self.assertEqual(self.r.computed["full_days"], 11)
        self.assertEqual(self.r.computed["daily_rate"], Decimal("7.50"))
        self.assertEqual(self.r.computed["credit"], Decimal("82.50"))
        self.assertIn("$82.50", self.r.reply)

    def test_75_cap_does_not_apply(self):
        self.assertFalse(self.r.computed["cap_applies"])
        self.assertTrue(cites(self.r, "Rule 3", "not capped by"))
        self.assertNotRegex(self.r.reply, r"(?i)(only|limited to|maximum of|capped at) \$75")

    def test_no_rule_4b_escalation(self):
        self.assertFalse(self.r.escalate)
        self.assertEqual(self.r.escalation_rules, [])
        self.assertIn("Rule 4", self.r.cited_ids)

    def test_issuance_pending_rule_5(self):
        self.assertEqual(self.r.action, "answer_pending")
        self.assertEqual(self.r.pending_checks, ["Rule 5"])
        self.assertIn("pending", self.r.reply.lower())

    def test_cites_outage_kb(self):
        self.assertIn("KB-1004", self.r.cited_ids)
        self.assertIn("Rule 3", self.r.cited_ids)

    def test_no_full_refund_promise(self):
        self.assertNotRegex(self.r.reply, r"(?i)refund(ed)? (of |the )?(full )?\$225")


class TestTurn1411TaxesNotCovered(unittest.TestCase):
    def setUp(self):
        self.r = BASE_TURNS["14:11"]

    def test_declines_and_escalates(self):
        self.assertEqual(self.r.intent, "tax_surcharge")
        self.assertEqual(self.r.action, "decline_escalate")
        self.assertIsNone(self.r.governing_rule)
        self.assertFalse(self.r.covered)
        self.assertTrue(self.r.escalate)

    def test_cites_plan_charge_only_fragment(self):
        self.assertTrue(
            cites(self.r, "KB-1004", "This credit applies to the recurring plan charge only")
        )

    def test_no_asserted_tax_answer(self):
        for claim in self.r.claims:
            if TAX_RE.search(claim.text):
                self.assertEqual(claim.kind, "gap", claim.text)


class TestTurn1413RequestDeadline(unittest.TestCase):
    def setUp(self):
        self.r = BASE_TURNS["14:13"]

    def test_rule_3_window(self):
        self.assertEqual(self.r.intent, "request_deadline")
        self.assertEqual(self.r.action, "answer")
        self.assertEqual(self.r.governing_rule, "Rule 3")
        self.assertFalse(self.r.escalate)

    def test_deadline_is_oct_21(self):
        self.assertEqual(self.r.computed["request_deadline"], date(2026, 10, 21))
        self.assertIn("October 21, 2026", self.r.reply)
        self.assertIn("30 calendar days", self.r.reply)

    def test_not_the_60_day_window(self):
        self.assertNotEqual(self.r.computed["request_deadline"], date(2026, 11, 30))
        self.assertTrue(cites(self.r, "Rule 3", "30 calendar days of the outage's resolution date"))
        self.assertTrue({"KB-1004", "KB-1005"} & self.r.cited_ids)


# --------------------------------------------------------------------------
# Grounding contract, all turns
# --------------------------------------------------------------------------
class TestGroundingContract(unittest.TestCase):
    def test_spans_are_verbatim(self):
        for r in BASE_TURNS.values():
            for claim in r.claims:
                for c in claim.citations:
                    source = normalize(BUNDLE.source_text(c.source_id))
                    self.assertIn(normalize(c.span), source, f"{r.turn_id} {c.source_id}")

    def test_non_gap_claims_have_citations(self):
        for r in BASE_TURNS.values():
            for claim in r.claims:
                self.assertIn(claim.kind, {"fact", "calc", "gap"})
                if claim.kind != "gap":
                    self.assertTrue(claim.citations, f"{r.turn_id}: {claim.text}")

    def test_every_amount_and_date_in_reply_is_claimed(self):
        for r in BASE_TURNS.values():
            claim_text = " ".join(c.text for c in r.claims)
            for token in MONEY_RE.findall(r.reply) + [m.group(0) for m in DATE_RE.finditer(r.reply)]:
                self.assertIn(token, claim_text, f"{r.turn_id}: unclaimed {token}")

    def test_actions_and_coverage_consistent(self):
        for r in BASE_TURNS.values():
            self.assertIn(r.action, ALLOWED_ACTIONS)
            if r.action in {"answer", "answer_pending"}:
                self.assertTrue(r.covered, r.turn_id)
            if r.action == "decline_escalate":
                self.assertTrue(r.escalate, r.turn_id)

    def test_trace_has_retrieval_scores(self):
        for tid in ("14:06", "14:09", "14:11", "14:13"):
            r = BASE_TURNS[tid]
            self.assertTrue(r.retrieved, tid)
            scores = [s for _, s in r.retrieved]
            self.assertEqual(scores, sorted(scores, reverse=True))

    def test_no_invented_case_numbers(self):
        for r in BASE_TURNS.values():
            self.assertNotRegex(r.reply, r"BDC-\d{6}")


# --------------------------------------------------------------------------
# Policy engine variations (rules-as-code, no retrieval)
# --------------------------------------------------------------------------
BASE_FACTS = CaseFacts(
    monthly_recurring_charge=Decimal("225.00"),
    outage_start=datetime(2026, 9, 10, 6, 0),
    outage_end=datetime(2026, 9, 21, 6, 0),
    noc_ticket="OUT-58823",
    noc_status="verified",
    request_date=date(2026, 10, 5),
    prior_resolved_disputes=None,
    fraud_flags=(),
)


class TestPolicyEngine(unittest.TestCase):
    def decide(self, **changes):
        return decide_credit(replace(BASE_FACTS, **changes))

    def test_base_case(self):
        d = self.decide()
        self.assertEqual(d.governing_rule, "Rule 3")
        self.assertEqual(d.full_days, 11)
        self.assertEqual(d.credit, Decimal("82.50"))
        self.assertFalse(d.cap_applies)
        self.assertEqual(d.escalation_rules, [])
        self.assertEqual(d.pending_checks, ["Rule 5"])
        self.assertFalse(d.frontline_may_issue)

    def test_known_clean_history_may_issue(self):
        d = self.decide(prior_resolved_disputes=())
        self.assertEqual(d.pending_checks, [])
        self.assertTrue(d.frontline_may_issue)

    def test_repeat_dispute_rule_5_overrides(self):
        d = self.decide(prior_resolved_disputes=(date(2026, 8, 1),))
        self.assertEqual(d.governing_rule, "Rule 5")
        self.assertTrue(d.escalate)
        self.assertFalse(d.frontline_may_issue)

    def test_old_dispute_not_repeat(self):
        d = self.decide(prior_resolved_disputes=(date(2026, 6, 1),))
        self.assertEqual(d.governing_rule, "Rule 3")
        self.assertTrue(d.frontline_may_issue)

    def test_fraud_flag_rule_5(self):
        d = self.decide(prior_resolved_disputes=(), fraud_flags=("unregistered SIM",))
        self.assertEqual(d.governing_rule, "Rule 5")
        self.assertFalse(d.frontline_may_issue)

    def test_exactly_four_hours_falls_back_to_rule_2(self):
        d = self.decide(outage_start=datetime(2026, 9, 10, 6), outage_end=datetime(2026, 9, 10, 10))
        self.assertEqual(d.governing_rule, "Rule 2")
        self.assertTrue(d.cap_applies)
        self.assertTrue(d.fallback_reason)

    def test_no_ticket_falls_back_to_rule_2(self):
        d = self.decide(noc_ticket=None, noc_status="none")
        self.assertEqual(d.governing_rule, "Rule 2")
        self.assertTrue(d.cap_applies)

    def test_unverifiable_ticket_escalates_4b(self):
        d = self.decide(noc_status="unverifiable")
        self.assertEqual(d.governing_rule, "Rule 3")
        self.assertTrue(d.escalate)
        self.assertIn("Rule 4(b)", d.escalation_rules)

    def test_request_window_boundary(self):
        self.assertEqual(self.decide(request_date=date(2026, 10, 21)).governing_rule, "Rule 3")
        self.assertEqual(self.decide(request_date=date(2026, 10, 22)).governing_rule, "Rule 2")

    def test_credit_over_300_escalates(self):
        d = self.decide(monthly_recurring_charge=Decimal("900.00"))
        self.assertEqual(d.credit, Decimal("330.00"))
        self.assertIn("Rule 4(b)", d.escalation_rules)

    def test_credit_exactly_300_no_escalation(self):
        d = self.decide(
            monthly_recurring_charge=Decimal("300.00"),
            outage_start=datetime(2026, 9, 1, 0),
            outage_end=datetime(2026, 10, 1, 0),
        )
        self.assertEqual(d.full_days, 30)
        self.assertEqual(d.credit, Decimal("300.00"))
        self.assertEqual(d.escalation_rules, [])

    def test_outage_over_30_days_escalates(self):
        d = self.decide(outage_start=datetime(2026, 9, 1, 0), outage_end=datetime(2026, 10, 2, 0))
        self.assertEqual(d.credit, Decimal("232.50"))
        self.assertIn("Rule 4(b)", d.escalation_rules)

    def test_partial_day_floors(self):
        self.assertEqual(self.decide(outage_end=datetime(2026, 9, 21, 18)).full_days, 11)

    def test_4a_never_applied_to_outage_credit(self):
        d = self.decide(prior_resolved_disputes=())
        self.assertNotIn("Rule 4(a)", d.escalation_rules)


# --------------------------------------------------------------------------
# End-to-end transcript variations (proves nothing is hard-coded)
# --------------------------------------------------------------------------
class TestTranscriptVariations(unittest.TestCase):
    def run_edit(self, old, new):
        self.assertIn(old, TRANSCRIPT)
        return by_turn(run_conversation(BUNDLE, transcript_text=TRANSCRIPT.replace(old, new)))

    def test_different_plan_charge(self):
        turns = self.run_edit("$225.00/month", "$450.00/month")
        self.assertEqual(turns["14:09"].computed["credit"], Decimal("165.00"))
        self.assertIn("$165.00", turns["14:09"].reply)

    def test_shorter_outage(self):
        turns = self.run_edit("through September 21, 6:00 AM", "through September 15, 6:00 AM")
        self.assertEqual(turns["14:09"].computed["full_days"], 5)
        self.assertEqual(turns["14:09"].computed["credit"], Decimal("37.50"))
        self.assertEqual(turns["14:13"].computed["request_deadline"], date(2026, 10, 15))

    def test_late_request_falls_back(self):
        turns = self.run_edit("Date: October 5, 2026", "Date: October 25, 2026")
        self.assertEqual(turns["14:09"].governing_rule, "Rule 2")
        self.assertNotIn("$82.50", turns["14:09"].reply)
        self.assertEqual(turns["14:13"].computed["request_deadline"], date(2026, 10, 21))

    def test_unknown_question_escalates(self):
        extra = TRANSCRIPT.rstrip() + (
            "\n\n[14:15] Customer (Dana Whitfield): Can you also waive the device "
            "activation fee I paid last year?\n"
        )
        r = by_turn(run_conversation(BUNDLE, transcript_text=extra))["14:15"]
        self.assertEqual(r.action, "decline_escalate")
        self.assertFalse(r.covered)


class TestVariantFiles(unittest.TestCase):
    """Shipped data/variants/ transcripts produce the branches their README documents."""

    def run_file(self, name):
        text = (DATA_DIR / "variants" / name).read_text(encoding="utf-8")
        return by_turn(run_conversation(BUNDLE, transcript_text=text))

    def test_late_request(self):
        turns = self.run_file("late_request.txt")
        self.assertEqual(turns["14:09"].governing_rule, "Rule 2")
        self.assertIn("past that deadline", turns["14:13"].reply)

    def test_large_credit(self):
        r = self.run_file("large_credit.txt")["14:09"]
        self.assertEqual(r.computed["credit"], Decimal("330.00"))
        self.assertEqual(r.action, "decline_escalate")
        self.assertIn("Rule 4(b)", r.escalation_rules)

    def test_ticket_not_found(self):
        turns = self.run_file("ticket_not_found.txt")
        r = turns["14:09"]
        self.assertEqual(r.action, "decline_escalate")
        self.assertIn("Rule 4(b)", r.escalation_rules)
        self.assertIsNone(r.computed["credit"])
        self.assertNotRegex(r.reply, r"\$\d+\.\d\d")
        self.assertNotIn("request_deadline", turns["14:13"].computed)

    def test_off_topic_question(self):
        r = self.run_file("off_topic_question.txt")["14:15"]
        self.assertEqual(r.action, "decline_escalate")
        self.assertFalse(r.covered)


# --------------------------------------------------------------------------
# Structural guarantees
# --------------------------------------------------------------------------
class TestStructure(unittest.TestCase):
    def _imports(self, path):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                yield from (a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                yield node.module

    def test_standard_library_only(self):
        files = list((ROOT / "agent").glob("*.py")) + [ROOT / "run.py"]
        for path in files:
            for name in self._imports(path):
                top = name.split(".")[0]
                self.assertTrue(
                    top == "agent" or top in sys.stdlib_module_names, f"{path.name}: {name}"
                )

    def test_policy_engine_does_not_use_retrieval(self):
        source = (ROOT / "agent" / "policy.py").read_text(encoding="utf-8")
        self.assertNotIn("retrieval", source)

    def test_run_script_is_deterministic(self):
        cmd = [sys.executable, str(ROOT / "run.py")]
        a = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
        b = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertEqual(a.stdout, b.stdout)
        for token in ("14:06", "14:09", "14:11", "14:13", "Rule 3", "KB-1004"):
            self.assertIn(token, a.stdout)


if __name__ == "__main__":
    unittest.main()
