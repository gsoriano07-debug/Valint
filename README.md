# Valint

Dealbook CRM is a single-file sales CRM that runs as a claude.ai Artifact. Live page: https://claude.ai/artifact/Buiq85woJro8UKJzzXfgsV (only people it's shared with can open it). Everything is in [`dealbook-crm.html`](dealbook-crm.html): markup, styles and script, with no build step.

## What it does

- **Pipeline.** Deals in six stage columns (Lead 10%, Qualified 25%, Proposal 50%, Negotiation 75%, Won, Lost). Drag a card to move it. Summary tiles show open pipeline, weighted forecast (value × stage probability), won this quarter with the 90-day win rate, and overdue follow-ups.
- **Flags.** Open deals with no activity for 14+ days, and deals past their expected close date, get a chip on the card.
- **Contacts and companies.** Sortable tables. Each record opens a drawer with its details, related deals and an activity timeline.
- **Activity log.** Log notes, calls, emails, meetings and tasks from any deal, contact or company. Logging a call, email or meeting updates the contact's "last contact" date.
- **Tasks.** Grouped into Overdue, Today, Next 7 days, Later and No due date, with a "Mine" filter.
- **Owners.** Assign records to teammates from your claude.ai organization.
- **Export.** CSV export of the current view.

## How data is stored

The page uses the Artifact runtime's capabilities instead of a backend:

| Capability | Used for |
| --- | --- |
| `db` | Shared document store. Collections: `companies`, `contacts`, `deals`, `activities` (tasks are activities with `type: "task"`). |
| `user` (scope `profile`) | The viewer's id for record ownership, and teammate names and avatars. Only ids are stored. |
| `downloads` | Saving CSV exports. |

Opened outside claude.ai, the page loads but shows a notice that records can't load, because `window.claude` is not available.

### Record shapes

- **deals:** `name, companyId, contactId, value, stage, closeDate (YYYY-MM-DD), ownerId, notes, stageChangedAt, lastActivityAt, closedAt, createdAt, updatedAt, createdBy`
- **contacts:** `firstName, lastName, title, companyId, email, phone, tags[], notes, ownerId, lastContactAt, createdAt, updatedAt, createdBy`
- **companies:** `name, industry, size, website, phone, address, notes, ownerId, createdAt, updatedAt, createdBy`
- **activities:** `type (note|call|email|meeting|task|stage), subject, body, dealId, contactId, companyId, ownerId, createdBy, createdAt`, plus `dueAt, done, doneAt` for tasks

Records with `sample: true` are example data. The page's **Clear examples** button removes them.

## Publishing changes

Edit `dealbook-crm.html` and republish it as the same Artifact, declaring these capabilities:

```json
{ "db": {}, "user": { "scopes": ["profile"] }, "downloads": true }
```
