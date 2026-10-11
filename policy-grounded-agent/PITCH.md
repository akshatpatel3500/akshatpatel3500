# 2-minute pitch: Policy-Grounded Agent Workflow

## 0:00 — The problem (15s)
"Two incidents reached a customer unreviewed. In the first, the agent quoted the general $75 refund limit when a narrower outage-credit exception applied. In the second, it answered a billing question the knowledge base never covered. The root cause is the same in both: the model decided which policy applied, and it decided what it was allowed to say."

## 0:15 — The design in one sentence (15s)
"I split the three jobs apart.
- **Choosing the policy** is deterministic code with fixed precedence: Rule 5, then Rule 3, then Rule 2, with Rule 4 checked per track.
- **Finding evidence** is BM25 retrieval, which never picks the policy.
- **Speaking** happens only through claims that each carry an exact quote from a rule, KB article or the transcript. A claim without a quote turns the reply into a decline and escalation."

## 0:30 — Demo: `python run.py --explain` (60s)
Tip: in STEP 3 and STEP 4 of 14:09, code picks Rule 3 while search ranks the $75 article first.
1. **14:09, the trap.** "The customer asks 'isn't your refund limit only $75?' Look at the retrieval line: KB-1002, the $75 article, ranks first at 13.1. The outage article ranks third at 5.7. A RAG-only agent quotes $75 here, which is incident #1. Ours shows *Rule 3 governs*: the NOC ticket confirms an outage longer than 4 hours and she's asking within 30 days. Then it computes (225 ÷ 30) × 11 = **$82.50** in code and quotes 'not capped by the $75.00 limit'. There's no escalation under Rule 4(b). Issuance is **pending**, because Rule 5 overrides everything and her dispute history isn't in the evidence. We say so instead of assuming it's clean."
2. **14:11, the gap.** "She asks whether the credit reduces taxes. KB-1003 ranks first because it's *about* taxes, but it never says anything about credits. The agent quotes what *is* covered ('applies to the recurring plan charge only'), marks taxes as not grounded, and escalates. That's incident #2 prevented."
3. **14:13.** "It gives 30 calendar days from resolution, so **October 21**. It explicitly says this is not the 60-day dispute window."
4. **Variants (if time).** `python3 run.py --transcript data/variants/large_credit.txt` gives a $330 credit, which escalates under Rule 4(b). `ticket_not_found.txt` escalates without quoting any amount.

**Live (if judges want):** `python chat.py`, then type their question, e.g. "can you waive my roaming fee?" → declined, or "how much credit do I get?" → $82.50 with steps.

## 1:30 — Proof (15s)
"52 tests; the core 43 were locked *before* any code was written. They cover the four answers, exact citation quotes, no uncited dollar amounts or dates, every policy boundary (4 hours, $300, 30 days, day 30 versus day 31), edited transcripts, standard library only, and byte-identical output on every run."

## 1:45 — What's next (15s)
"The memo has the measurement plan: about 300 perturbed cases, scored on rule-selection accuracy, hallucination rate (claims whose quote doesn't support them), and decline calibration. When an LLM writes the phrasing, this claim-to-quote check stays as the gate."

---

## Likely questions

- **"Isn't hard-coding the rules brittle?"** "The rules are the policy, and versioned policy should be versioned code. Every threshold is a named constant. Every rule citation is pulled from the live policy text by pattern, so if the document changes, the run fails loudly with `PolicyTextDrift` instead of quoting stale numbers."
- **"Why 11 days and not 10?"** "'Full days' means complete 24-hour periods: Sept 10 06:00 to Sept 21 06:00 is exactly 264 hours. Counting calendar days gives 10, which is exactly $75. That's a nasty coincidence, so it's documented as an assumption in the memo."
- **"Doesn't 'plan charge only' answer the tax question?"** "It says what the credit is *calculated on*. Taxes are pass-through and computed on the billed amount, and nothing says whether a credit adjusts them. Turning that into 'no' is precisely the over-reach behind incident #2."
- **"What breaks it?"** "A turn with two questions only gets one intent. A transcript worded differently can miss facts. New question types need a coverage pattern. All of these fail safe: unknown means decline and escalate."
- **"Where does an LLM fit?"** "It would handle intent and fact extraction on the way in, and phrasing on the way out. Policy selection and arithmetic stay in code, and every sentence it produces still has to pass the claim-to-quote check."
