# Blog topic queue

The generator (`scripts/generate-post.mjs`) takes the **first unchecked topic**
in this file, writes the post, and checks it off in the same pull request. To
change what publishes next, reorder the list — the top unchecked line wins.

Format, one topic per line:

```
- [ ] `slug` | Cluster | Angle — what this post argues and who it's for
```

The `slug` becomes the URL (`/blog/<slug>`), so keep it short and permanent.
`Cluster` must be one of the six below exactly, because it becomes the label
pill on the card and `articleSection` in the JSON-LD:

Pricing &amp; estimating · Drainage authority · Lead gen &amp; Meta ads ·
Proposals &amp; closing · Running the operation · Comparisons

Anything after `—` is direction for the writer, not published text. Be specific
there; a vague angle produces a vague post.

When the queue empties the workflow does nothing and says so in its summary,
rather than inventing a topic.

## Queue

- [x] `pricing-a-drainage-job-by-the-foot` | Pricing &amp; estimating | Per-foot pricing as a sanity check, not a quoting method. Where the shortcut is roughly right, where it quietly loses money (depth changes, rock, restoration, access), and how to move from a per-foot instinct to a line-item bid. Should reference the 148-foot job in `how-to-price-a-french-drain-job` rather than re-costing it. (published 2026-09-13)
- [x] `what-to-charge-for-a-site-visit` | Pricing &amp; estimating | Free vs paid estimates for drainage specifically. Why diagnostic work is different from measuring a patio, what a paid diagnostic visit buys the homeowner, how to credit it against the job, and the script for explaining the fee without losing the lead. (published 2026-09-13)
- [x] `catch-basin-vs-dry-well` | Drainage authority | When each is the right fix and when neither is. Soil percolation, outfall availability, freeze depth, maintenance burden. Honest cost ranges as ranges. Written so a homeowner can follow it but a contractor still learns the decision rule. (published 2026-09-13)
- [x] `regrading-vs-drainage-system` | Drainage authority | How to tell whether grading alone solves a wet yard before selling pipe. The tests worth doing on a site visit, the cases where regrading is genuinely enough, and why selling the smaller fix earns the bigger job later. (published 2026-09-13)
- [x] `sump-pump-discharge-done-right` | Drainage authority | Where discharge actually goes, freeze protection, distance from foundation, what codes commonly require, and the failure modes that bring you back in February. Call-backs are the cost centre here. (published 2026-09-13)
- [x] `why-your-leads-go-cold` | Lead gen &amp; Meta ads | What happens after first contact. A follow-up cadence that isn't nagging, how many touches before you stop, and what to say on each. Companion to `speed-to-lead` — do not restate it; link to it and start where it ends. (published 2026-09-13)
- [x] `google-local-services-vs-meta-ads` | Lead gen &amp; Meta ads | Where a contractor's first ad dollars go furthest. Intent vs interruption, lead quality differences, what each channel costs to learn, and why the answer changes with crew count. Cost figures as ranges, dated, labelled as ranges. (published 2026-09-13)
- [x] `proposal-follow-up-sequence` | Proposals &amp; closing | The week after you send it. What to send at day one, day three and day seven, when silence means no, and how to ask for the decision without discounting. Should lean on proposal view/open evidence rather than guessing. (published 2026-09-13)
- [x] `handling-price-objections-drainage` | Proposals &amp; closing | "The other guy is three thousand cheaper." How to find out what the other bid actually includes, how to hold price without arguing, and the three cases where walking away is correct. Scripts, not theory. (published 2026-09-13)
- [x] `hiring-your-first-office-person` | Running the operation | The admin load that justifies the hire, what to hand over first, what must stay with the owner, and the systems that have to exist before a new person can be useful. Honest about the month it costs before it pays. (published 2026-09-13)
- [ ] `job-costing-for-contractors` | Running the operation | Comparing estimated to actual without enterprise software — what to track by hand, the four numbers that matter, and what you learn from the first three jobs. NOTE: job actuals and time tracking are Reserved in ScapesHQ. This post must not imply the product does it; point at the honest gap.
- [ ] `crm-vs-spreadsheet-for-contractors` | Comparisons | The specific breaking points where a spreadsheet stops being the right answer — headcount, lead volume, customer structure, proof requirements. Companion to `running-a-business-on-spreadsheets`; this one is the decision framework, not the diagnosis.

## Published

Checked-off topics stay here as a record. The generator appends the date.
