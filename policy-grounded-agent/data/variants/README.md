# Variant transcripts

Edits of the Dana Whitfield transcript that exercise other policy branches.
Run any of them with `python3 run.py --transcript data/variants/<file>`.

| File | Edit | Expected at 14:09 / other turns |
|---|---|---|
| `late_request.txt` | Chat date moved to Oct 25 (34 days after resolution) | Rule 3 fails the 30-day condition, so the request falls back to **Rule 2** ($75 cap, goodwill history pending). 14:13 says the Oct 21 deadline has passed. |
| `large_credit.txt` | Plan charge $900/month | Rule 3, credit **$330.00** > $300, so **escalate under Rule 4(b)** before issuing |
| `ticket_not_found.txt` | Agent can't pull up the NOC record | Ticket unverifiable, so **escalate under Rule 4(b)** with no amount quoted. 14:13 gives the 30-day rule without a date. |
| `off_topic_question.txt` | Extra 14:15 question about a device activation fee | 14:15 is not covered by policy or KB, so it is **declined and escalated** |
