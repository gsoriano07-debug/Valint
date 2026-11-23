# Valint

Dealbook is Valint's company workspace: a sales CRM plus finance and planning tabs, in one page that runs as a claude.ai Artifact. Live page: https://claude.ai/artifact/Buiq85woJro8UKJzzXfgsV (only people it's shared with can open it). Valint was called Valient AI in the earlier class docs.

## Tabs

| Group | Tab | What it does |
| --- | --- | --- |
| Company | Overview | MRR, ARR, paying locations, cash, net burn, runway, MRR vs plan, next milestones, what needs attention |
| Sales | Pipeline | Deals by stage (Lead, Qualified, Proposal, Pilot, Won, Lost), drag to move, ARR and weighted forecast, progress to the end-2027 target |
| Sales | Contacts, Companies | Records with deals and an activity timeline |
| Sales | Tasks | Follow-ups grouped by due date |
| Finance | Revenue | Won deals as subscriptions: MRR, ARR, ARPA, churn, MRR movement by month, mark a customer churned. A deal starts billing the day it's marked Won (the deal form lets you change that date) |
| Finance | Expenses | Spending by plan category against the plan's monthly budget |
| Finance | Invoices | Invoice records with line items, receivables aging, payments |
| Finance | Cash & runway | Cash on hand, monthly burn, runway, a cash projection and a what-if |
| Planning | Forecast | The 3-year plan month by month in three scenarios, an annual P&L, plan vs actual |
| Planning | Unit economics | Gross profit per location, LTV, LTV:CAC, CAC payback, a sensitivity grid |
| Planning | Market | TAM / SAM / SOM from market segments and the penetration each target needs |
| Planning | Milestones | Plan milestones with live progress from real numbers |
| Planning | Team & hiring | Headcount and payroll against the plan |
| Planning | Assumptions | Edit the plan every other tab reads, with a live preview |

## Valint numbers

Defaults come from *Valient AI — Three-Year Financial Projections* (base case, Oct 30, 2026). The Assumptions tab saves changes to the `settings/plan` document; the defaults live in `PLAN_DEFAULTS` in `src/core.html`.

| Figure | Value |
| --- | --- |
| Price per location per month | $399 (2027), $429 (2028), $449 (2029) |
| Setup fee / paid pilot | $750 one-time, not in ARR / $250 for 30 days |
| Pilots | 3 locations, Nov–Dec 2026, paying from Jan 2027 |
| New locations per month | 2–6 (2027), 8–14 (2028), 18–30 (2029) |
| Monthly churn | 3% base, 4% conservative, 2.5% upside |
| Targets | 25 locations mid-2027; 42 / $203K ARR end 2027; 144 / $742K end 2028; 350 / $1.88M end 2029 |

The Forecast model rebuilds the plan month by month (start-of-month locations pay that month's price, then churn leaves and the year's average new locations arrive). It lands within a few percent of the doc: 42.9 locations and $205K ARR at Dec 2027 vs the doc's 42 and $203K.

## How it's built

```
src/core.html        shell, sales tabs, shared finance math, charts, UI helpers
src/views/*.js       one module per finance / planning tab
src/CONTRACT.md      the module API every tab is written against
src/harness/         headless test harness (runs the page in JavaScriptCore with fake data)
build.py             inlines the modules into one page
dealbook-crm.html    the built page that is published
```

Build and test:

```bash
python3 build.py
```

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc src/harness/run.js -- dealbook-crm.html all
```

The last line of the test output should be `RESULT: PASS`.

## Data

Records live in the Artifact's `db` capability. Collections: `deals`, `contacts`, `companies`, `activities` (tasks are activities with `type: "task"`), `expenses`, `invoices`, `milestones`, `hires`, `segments` and `settings` (`plan`, `finance`). The page also uses `user` (owner names and avatars; only ids are stored) and `downloads` (CSV export on every tab).

Records with `sample: true` are examples; **Clear examples** removes them. Milestones, the team plan and market segments come from the plan documents and are not examples.

Publish changes by republishing `dealbook-crm.html` as the same Artifact with these capabilities:

```json
{ "db": {}, "user": { "scopes": ["profile"] }, "downloads": true }
```
