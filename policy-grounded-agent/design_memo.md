# Design Memo: Policy-Grounded Agent Workflow

**Context.** Two incidents reached a customer without review. In the first, the agent quoted the $75 general limit when the outage exception applied. In the second, it answered a billing question the KB never covered. This prototype separates three jobs. *Choosing the policy* is deterministic code. *Finding evidence* is BM25. *Stating facts* is allowed only when every claim maps to a verbatim span from a rule, a KB article or the transcript. Anything else is declined and escalated.

## Which replies are fully grounded

| Turn | Reply | Policy / evidence | Grounded? |
|---|---|---|---|
| 14:06 | Dispute eligible; window runs to Nov 30, 2026 | Rule 1 · KB-1001 | **Fully** |
| 14:09 | Rule 3 governs; (225 ÷ 30) × 11 = **$82.50**; the $75 cap doesn't apply; no escalation under Rule 4(b) | Rule 3, Rule 4(b) and its note, Rule 5 · KB-1004/1005/1006/1007 | **Grounded amount; issuance pending.** Rule 5 overrides everything, and the dispute and fraud history it needs is not in the evidence. So the reply says "pending" instead of "issued". |
| 14:11 | Credit applies to the recurring plan charge only; whether taxes/surcharges are reduced is **not covered**, so the question is escalated | KB-1004 fragment; KB-1003 checked | **Not grounded, so declined.** KB-1003 ranks #1 (23.0) because it is about taxes, but it says nothing about credits. KB-1004 says what the credit is *calculated on*, not whether pass-through taxes are adjusted. Answering "no" would repeat incident 2. |
| 14:13 | 30 calendar days from resolution, so **Oct 21, 2026** (day 14 of 30), not the 60-day dispute window | Rule 3 condition 3 · KB-1004/1005 | **Fully** |

Turns 14:02 (gather info) and 14:04 (identity) are grounded in KB-1001. A question outside the policy and KB, such as waiving a device fee, is declined and escalated.

## Hardest point to enforce in the policy hierarchy

**Choosing the governing rule before checking any threshold, against both the customer's framing and the retrieval ranking.** For the 14:09 turn, BM25 ranks KB-1002 (general $75 limit, 13.1) far above KB-1004 (outage credit, 5.7), because the customer literally asks about "your refund limit … $75". Any design where retrieval rank or the customer's wording picks the policy repeats incident 1.

The policy itself warns about this: Rule 4's note says checking $75 against an outage credit "is a misapplication". The precedence therefore lives in `policy.py`, which has no access to search results:
1. Rule 5 overrides everything.
2. Rule 3 applies only if all three conditions hold. Otherwise Rule 2 applies.
3. Rule 4 is checked only against the selected track's thresholds.

The residual difficulty is **Rule 5**. It overrides everything, but its inputs (prior disputes in the last 90 days, fraud flags) are never in a chat transcript. The engine treats missing history as *unknown*, not *clean*. That is why issuance is "pending" even though the amount is fully grounded. Two other ambiguities are documented and locked by tests:
- "full days": 24-hour periods give 11 days, but calendar days give 10, which is exactly $75.00;
- a NOC ticket that is missing versus one that can't be verified (Rule 3 fallback versus Rule 4(b)).

## Next step: measuring instruction adherence and hallucination rate

1. **A labelled eval suite built from perturbations.** Generate about 300 transcript variants from the edit functions the tests already use:
   - MRC, outage window, request date and statement date;
   - ticket present, missing or unverifiable;
   - prior disputes and fraud flags;
   - boundary values (4 hours, $300.00, 30 days, day 30 versus 31);
   - about 50 out-of-KB questions (taxes, roaming, device fees).

   Labels come from `decide_credit`, plus a human adjudication pass on 50 real transcripts.
2. **Metrics, tracked in CI on every policy or KB change:**
   - *Instruction adherence*:
     - governing-rule accuracy;
     - action accuracy (answer, pending or escalate);
     - threshold accuracy (Rule 4(a)/(b), Rule 5);
     - a per-rule confusion matrix, with Rule 2 versus Rule 3 broken out.
   - *Hallucination rate*: the share of claims whose cited span does not entail the claim. Score it with a span-entailment check and a 10% human audit. A claim with no citation at all is a hard failure.
   - *Coverage calibration*: answer rate on out-of-KB questions (target 0) and false-decline rate on covered questions.
3. **Gate before generation.** When an LLM replaces the templated phrasing, keep this claim-to-span verifier as a gate after generation. Any sentence that doesn't map to a span drops the turn to decline and escalate. Report hallucination rate with and without the gate.
