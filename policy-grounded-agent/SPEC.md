# SPEC — Policy-Grounded Agent Workflow Prototype

Status: **locked before implementation; now implemented.** `tests/test_expected.py` encodes every
"MUST" below (47 tests, all passing).

## 1. Problem

Two production incidents to prevent:

| # | Incident | Guard in this design |
|---|----------|----------------------|
| I-1 | Quoted the general $75 refund limit when the narrower service-outage credit exception governed. | Policy selection is **rules-as-code with fixed precedence**, driven by case facts. Retrieval never picks the rule. |
| I-2 | Answered a billing question the KB never covered. | **Coverage gate.** Every claim must map to a verbatim rule/KB/transcript span; anything else becomes decline + escalate. |

## 2. Constraints

- Python 3, **standard library only**, no network, no API keys.
- **Deterministic**: same inputs → byte-identical output.
- Arithmetic in code (`decimal.Decimal`, `datetime`), never in prose templates.
- Nothing keyed to this transcript (no "if account == NMB-7745213", no literal
  $82.50). Facts are parsed from the transcript; variations must work.

## 3. Inputs (`data/`)

| File | Parsed into |
|------|-------------|
| `Nimbus Wireless — Billing Dispute & Refund Policy.md` | `Rule 1` … `Rule 5` (one source each) |
| `NimbusCare Knowledge Base — Billing & Credits Excerpt.md` | `KB-1001` … `KB-1010` (one source each; header says 9, there are 10) |
| `NimbusCare Chat Transcript — Dana Whitfield, October 5, 2026.txt` | header facts + timestamped turns; source id `TRANSCRIPT` |

Files are located by glob (`*Policy*.md`, `*Knowledge Base*.md`, `*Transcript*.txt`).

## 4. Architecture

```
transcript ─► turn splitter ─► intent classifier (keyword rules)
                                   │
           fact extractor ◄────────┤  (MRC, statement date, chat date,
           (regex over transcript) │   NOC ticket id + window, line item)
                   │               │
                   ▼               ▼
            POLICY ENGINE      BM25 RETRIEVER  (evidence + coverage only)
            agent/policy.py    agent/retrieval.py
            (no import of           │
             retrieval)             │
                   └──────► composer ◄┘
                              │  claims → citations (verbatim spans)
                              ▼
                       grounding gate ──► answer | answer_pending
                              │                 | decline_escalate
                              ▼
                       per-turn trace (run.py)
```

### 4.1 Policy precedence (fixed, in code)

1. **Rule 5** — repeat dispute (prior *resolved* dispute ≤ 90 days before the
   request date) or any fraud flag → Tier 2 decides; front line may not issue.
   If dispute history is **unknown**, the decision is `pending_checks=["Rule 5"]`.
2. **Rule 3** — applies only if *all* hold: NOC ticket present, outage
   **> 4 consecutive hours** (exactly 4 h does not qualify), request date
   ≤ resolution date + **30 calendar days** (inclusive).
3. **Rule 2** — fallback for anything Rule 3 rejects; $75.00 cumulative cap.
4. **Rule 4** — checked **after** the governing rule is chosen, using that
   track's thresholds only:
   - Rule 3 track → 4(b): credit > $300.00, outage > 30 days, or NOC ticket
     unverifiable. 4(a) is **never** evaluated against an outage credit.
   - Rule 2 track → 4(a): rolling 12-month goodwill total would exceed $75.00.
5. **Rule 1** — dispute eligibility (60 calendar days from statement date,
   specific line item named). Independent of the credit track.

NOC states: `verified` (ticket found) · `none` (no ticket → Rule 2, per Rule 3
fallback and KB-1005 step 2) · `unverifiable` (lookup failed → Rule 4(b) escalate).

### 4.2 Arithmetic

- `full_days = floor((outage_end − outage_start) / 24h)` — **24-hour periods**,
  not calendar days. (Calendar-day counting gives 10 days = exactly $75.00; this
  ambiguity is documented in the memo.)
- `daily_rate = MRC / 30`; `credit = (daily_rate × full_days)` quantized to $0.01, ROUND_HALF_UP.
- `request_deadline = resolution_date + 30 days`.
- `dispute_window_end = statement_date + 60 days`.

### 4.3 Grounding contract

Each customer turn yields a `TurnResult`. Each factual statement in the reply is
a `Claim(text, kind, citations)`:

- `kind="fact"` — must cite ≥ 1 span.
- `kind="calc"` — must cite the formula span **and** the input spans.
- `kind="gap"` — states what the evidence does *not* cover; cites the closest
  span it checked. Gap claims force `covered=False`.

A `Citation(source_id, span)` span **must appear verbatim** in that source after
normalisation (strip `**` and backticks, collapse whitespace). Every `$` amount
and every date in the reply text must appear in some claim's text.

Any intent that is unrecognised, or whose question is not answered by a
cited span, → `action="decline_escalate"`, `escalate=True`.

## 5. Public API (what the tests import)

```python
from agent import load_bundle, run_conversation
from agent.policy import CaseFacts, decide_credit

bundle = load_bundle(data_dir)               # .source_text(source_id) -> str
results = run_conversation(bundle, transcript_text=None)  # list[TurnResult]
```

`TurnResult` fields: `turn_id` ("HH:MM"), `customer_text`, `intent`, `action`
(`answer` | `answer_pending` | `decline_escalate` | `gather_info` |
`acknowledge`), `governing_rule` (e.g. `"Rule 3"` or `None`), `reply`,
`claims`, `cited_ids` (set of source ids), `retrieved` (list of
`(kb_id, score)` sorted desc), `computed` (dict), `covered` (bool), `escalate`
(bool), `escalation_rules` (list), `pending_checks` (list).

`CaseFacts` fields: `monthly_recurring_charge: Decimal`, `outage_start`,
`outage_end: datetime | None`, `noc_ticket: str | None`,
`noc_status: "verified" | "none" | "unverifiable"`, `request_date: date`,
`prior_resolved_disputes: tuple[date, ...] | None` (None = unknown),
`fraud_flags: tuple[str, ...]`.

`decide_credit(facts) -> CreditDecision` with `governing_rule`, `credit`,
`full_days`, `cap_applies`, `escalate`, `escalation_rules`, `pending_checks`,
`frontline_may_issue`, `fallback_reason`.

`run.py` at the project root prints a per-turn trace: turn id, intent, governing
rule, top retrieved articles with scores, cited spans, action, reply.

## 6. Locked expectations for the Dana Whitfield transcript

| Turn | Intent | Action | Governing | Must cite | Locked values |
|------|--------|--------|-----------|-----------|---------------|
| 14:06 | dispute_open | `answer` | Rule 1 | Rule 1, KB-1001 | eligible; window ends **2026-11-30** |
| 14:09 | credit_amount | `answer_pending` | Rule 3 | Rule 3, KB-1004, Rule 4 | full_days **11**, daily_rate **7.50**, credit **$82.50**; $75 cap does **not** apply (cite "not capped by"); `escalation_rules=[]` (no 4(b)); `pending_checks=["Rule 5"]` because dispute history is not in evidence |
| 14:11 | tax_surcharge | `decline_escalate` | None | KB-1004 span "This credit applies to the recurring plan charge only" | `covered=False`, `escalate=True`; no non-gap claim about taxes/surcharges (KB-1003 is retrieved but does not answer) |
| 14:13 | request_deadline | `answer` | Rule 3 | Rule 3, KB-1004 or KB-1005 | **30 calendar days** from resolution → **October 21, 2026**; not the 60-day Rule 1 window |

Across all turns: no invented case numbers (`BDC-######`), no promise of a full
$225 refund, no reply saying the credit is limited to $75.

## 7. Variation cases (must pass, proves no hard-coding)

| Case | Expected |
|------|----------|
| Known clean dispute history | Rule 3, `pending_checks=[]`, front line may issue |
| Prior resolved dispute 65 days earlier | Rule 5 governs, escalate, front line may not issue |
| Prior resolved dispute 126 days earlier | not a repeat → Rule 3 |
| Fraud flag present | Rule 5 |
| Outage exactly 4 h | Rule 2 fallback, cap applies |
| No NOC ticket | Rule 2 fallback |
| NOC unverifiable | Rule 3 track, escalate under Rule 4(b) |
| Request on day 30 (Oct 21) / day 31 (Oct 22) | Rule 3 / Rule 2 |
| MRC $900 → credit $330.00 | Rule 4(b) escalate |
| MRC $300, 30-day outage → $300.00 | no escalation (boundary) |
| 31-day outage, $232.50 | Rule 4(b) escalate (duration) |
| Outage ends 18:00 instead of 06:00 | still 11 full days |
| Transcript MRC edited to $450 | 14:09 credit $165.00 |
| Transcript ticket end edited to Sep 15 | 5 days, $37.50, deadline Oct 15 |
| Transcript chat date edited to Oct 25 | 14:09 falls back to Rule 2, no $82.50 |
| Appended unknown question | `decline_escalate` |

## 8. Out of scope

LLM generation, real NOC/CRM lookups, writing case numbers, multi-account fraud
detection. These are stubbed as facts or surfaced as pending checks.

## 9. Run

```
python3 run.py                                   # per-turn trace
python3 -m unittest discover -s tests -v         # locked expectations
```
