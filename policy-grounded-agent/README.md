# Policy-Grounded Agent Workflow Prototype

Billing-support agent for the NimbusCare outage-credit dispute. Python 3.10+,
standard library only, no API keys, fully deterministic.

```
./run.sh                          # per-turn reviewer trace + tests
python3 run.py                    # trace only
python3 run.py --explain          # numbered STEP 1..7 workflow view per turn
python3 chat.py                   # live chat: type customer questions, see reply + steps
python3 report.py                 # regenerate report.html (open it in any browser)
python3 run.py --transcript FILE  # run a variant transcript against the bundled policy/KB
python3 run.py --transcript data/variants/large_credit.txt   # see data/variants/README.md
python3 -m unittest discover -s tests -v
```

## What the trace shows for each customer turn

- **intent**, **action** (`answer`, `answer_pending`, `decline_escalate`, `gather_info`, `acknowledge`)
- **governing policy**: the rule the policy engine selected
- **retrieved**: BM25 ranking over KB articles. This is evidence only and never chooses the policy.
- **KB articles cited** and every **claim**, each with the verbatim rule/KB/transcript spans behind it
- **computed** values (credit, days, deadlines) produced in code
- the customer-facing **reply**, which is just the claims joined together

## Seeing the workflow

`python3 run.py --explain` prints each turn as numbered steps:
1. facts found;
2. question type and the words that matched;
3. rule checks in priority order, with ✓/✗/? per condition;
4. search ranking;
5. math;
6. quote check;
7. decision.

`python3 chat.py` keeps Dana's conversation as context and lets you type new
customer messages. Each is processed by the same workflow, and the step view is
printed under the reply. Commands: `/steps` toggles the steps, `/quit` exits.
`--brief` shows replies only, and `--fresh` starts without the earlier turns.

### Browser report

`report.html` comes pre-built in the zip; double-click it to open. To rebuild it, run `python3 report.py`.
It shows:
- an at-a-glance table for each conversation;
- one card per turn, with a coloured decision badge;
- the rule checks as ✓/✗ lists;
- search-score bars, with the articles actually quoted in blue;
- click-to-expand quotes for every claim.

Tabs switch between the original conversation and the four variants.

## How it works

| Module | Role |
|---|---|
| `agent/loader.py` | Splits the policy into `Rule 1..5` and the KB into `KB-1001..1010` sources |
| `agent/transcript.py` | Parses turns; extracts facts (MRC, statement date, NOC ticket window, chat date) with their source spans |
| `agent/intents.py` | Keyword intent rules |
| `agent/policy.py` | Rules-as-code with fixed precedence: Rule 5 > Rule 3 > Rule 2; Rule 4 checked per track; Rule 1 separately. `Decimal` arithmetic |
| `agent/retrieval.py` | Okapi BM25 over KB articles |
| `agent/explain.py` | Builds the step-by-step view from the same facts and policy functions |
| `agent/workflow.py` | Per turn: facts, then policy decision, then evidence spans from ranked articles, then claims. A question whose answer is not stated in the evidence is declined and escalated. |

Guarantees enforced by `tests/test_expected.py` (53 tests): locked answers for the
four open turns, verbatim citation spans, no uncited amounts or dates, policy
boundary cases, edited-transcript variations, standard library only, deterministic output.

## Variant transcripts

`data/variants/` holds four edited transcripts: late request (Rule 2 fallback),
$900 plan ($330 credit, Rule 4(b) escalation), NOC ticket not found (Rule 4(b), no
amount quoted) and an off-topic question (declined). Expected outcomes are in
`data/variants/README.md` and enforced by tests.

## Documented assumptions

- "Full days" means complete 24-hour periods (floor). Counting calendar days instead gives 10 days, which is exactly $75.00.
- The 30-day request window includes its last day (Sept 21 + 30 = Oct 21).
- No NOC ticket goes to the Rule 2 fallback. A ticket mentioned but not verifiable escalates under Rule 4(b).
- Dispute history and fraud flags aren't in the transcript, so credit issuance is left pending a Rule 5 check.

See `SPEC.md` for the full contract.
