# Valint

Dealbook CRM is a single-file sales CRM that runs as a claude.ai Artifact. Live page: https://claude.ai/artifact/Buiq85woJro8UKJzzXfgsV (only people it's shared with can open it). Everything is in [`dealbook-crm.html`](dealbook-crm.html): markup, styles and script, with no build step.

## What it does

- **Pipeline.** Deals in six stage columns (Lead 10%, Qualified 25%, Proposal 50%, Pilot 75%, Won, Lost). Drag a card to move it. Summary tiles show open pipeline ARR, weighted forecast (ARR × stage probability), signed ARR against the end-of-2027 target, and overdue follow-ups.
- **Per-location pricing.** A deal's ARR is locations × the monthly price for the year its contract starts × 12. The form fills it in and lets you override it. The setup fee is tracked separately and never counted in ARR.
- **Flags.** Open deals with no activity for 14+ days, and deals past their expected close date, get a chip on the card.
- **Contacts and companies.** Sortable tables. Each record opens a drawer with its details, related deals and an activity timeline.
- **Activity log.** Log notes, calls, emails, meetings and tasks from any deal, contact or company. Logging a call, email or meeting updates the contact's "last contact" date.
- **Tasks.** Grouped into Overdue, Today, Next 7 days, Later and No due date, with a "Mine" filter.
- **Owners.** Assign records to teammates from your claude.ai organization.
- **Export.** CSV export of the current view.

## Valint numbers

Valint was called Valient AI in the earlier class docs. The pricing and targets come from *Valient AI — Three-Year Financial Projections* (base case, Oct 30, 2026). They live in the `PRICE_BY_YEAR`, `SETUP_FEE` and `TARGET` constants near the top of the script.

| Figure | Value |
| --- | --- |
| Price per location per month | $399 (2027), $429 (2028), $449 (2029) |
| ARR per location | $4,788 (2027), $5,148 (2028), $5,388 (2029) |
| Setup fee | $750 one-time, not in ARR |
| Pilots | 3 locations, Nov–Dec 2026, paying from Jan 2027 |
| Target | 25 locations by mid-2027; 42 locations and $203,000 ARR by end of 2027 |

The older $500 / $900 / $1,500 tiers from the Phase 1–2 business plan are superseded by the projections and are not used.

## How data is stored

The page uses the Artifact runtime's capabilities instead of a backend:

| Capability | Used for |
| --- | --- |
| `db` | Shared document store. Collections: `companies`, `contacts`, `deals`, `activities` (tasks are activities with `type: "task"`). |
| `user` (scope `profile`) | The viewer's id for record ownership, and teammate names and avatars. Only ids are stored. |
| `downloads` | Saving CSV exports. |

Opened outside claude.ai, the page loads but shows a notice that records can't load, because `window.claude` is not available.

### Record shapes

- **deals:** `name, companyId, contactId, locations, monthlyPrice, value (ARR), setupFee, stage (lead|qualified|proposal|pilot|won|lost), closeDate (YYYY-MM-DD), ownerId, notes, stageChangedAt, lastActivityAt, closedAt, createdAt, updatedAt, createdBy`
- **contacts:** `firstName, lastName, title, companyId, email, phone, tags[], notes, ownerId, lastContactAt, createdAt, updatedAt, createdBy`
- **companies:** `name, industry, size, website, phone, address, notes, ownerId, createdAt, updatedAt, createdBy`
- **activities:** `type (note|call|email|meeting|task|stage), subject, body, dealId, contactId, companyId, ownerId, createdBy, createdAt`, plus `dueAt, done, doneAt` for tasks

Records with `sample: true` are example data. The page's **Clear examples** button removes them.

## Publishing changes

Edit `dealbook-crm.html` and republish it as the same Artifact, declaring these capabilities:

```json
{ "db": {}, "user": { "scopes": ["profile"] }, "downloads": true }
```
