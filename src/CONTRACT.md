# Tab module contract — Dealbook CRM (Valint)

The CRM is one HTML page published as a claude.ai Artifact. `src/core.html` holds the shell, the sales tabs
(Pipeline, Contacts, Companies, Tasks), shared finance math, charts and UI helpers. Each new tab is a **module**:
one plain-JavaScript file `src/views/<id>.js` that registers itself. `python3 build.py` inlines every module into
`dealbook-crm.html` as its own `<script>` before the core script.

Valint (called Valient AI in the class docs) is a pre-revenue, solo-founder startup selling a private AI assistant
to New York cannabis dispensaries and independent retail stores at **$399 per location per month in 2027**
($429 in 2028, $449 in 2029), plus a **$750 one-time setup fee** (not in ARR) and a **$250 30-day paid pilot**.
3 pilot locations run Nov–Dec 2026 and convert to paid in Jan 2027. Every number a tab shows must come from the
user's data (ctx.all / finance helpers) or from `ctx.plan()` (the plan, editable on the Assumptions tab) —
never hard-code plan numbers in a module.

## File shape

```js
(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  // private module state lives in this closure (selected month, scenario, drafts...)
  return {
    id: 'expenses',            // also the URL hash (#expenses); ASCII letters/digits/hyphens
    label: 'Expenses',         // nav text
    group: 'Finance',          // 'Company' | 'Sales' | 'Finance' | 'Planning'
    order: 20,                 // position inside the group
    collections: ['expenses'], // EVERY db collection this tab reads or writes (core subscribes to them)
    newItems: [{ label: 'Expense', a: 'new' }], // optional: entries in the top-bar "New" menu
    badge() { return null || { text: '2', hot: true, title: '2 overdue' }; }, // optional nav badge
    render() { return '<html string>'; },      // required; called on every data change — keep it pure
    afterRender(root) {},                       // optional; root = <main>; bind nothing global here
    onAction(a, data, el, ev) {},               // clicks on data-act="mod" data-mod="<id>" data-a="<a>" (+ any data-*)
    onInput(key, el, ev) {},                    // 'input' AND 'change' events from data-mod-input="<id>" data-key="<key>"
    csv() { return { name: 'expenses', rows: [[header...], [cells...]] }; } // optional; Export CSV button
  };
});
```

Rules:
- No build tools, no imports, no globals besides the push above. Plain ES2020 in the browser. **The string
  `</script` must never appear in the file.**
- `render()` returns an HTML string. **Escape every piece of user or stored text with `ctx.esc()`** (names, notes,
  numbers you format yourself are fine). No inline `on*=` handlers, no `<script>`, no `<style>` blocks — use the
  CSS classes below and short `style=""` attributes only.
- Clicks: put `data-act="mod" data-mod="<id>" data-a="<action>"` (+ `data-id="..."` etc.) on a `<button type="button">`.
  `onAction(a, data, el, ev)` receives `data` = the element's dataset. Navigation: `data-act="go" data-view="<tabId>"`.
  Open a CRM record: call `ctx.openDrawer('deal'|'contact'|'company', id)`.
- Inputs that recompute numbers live (calculators): `data-mod-input="<id>" data-key="<key>"` on the input; in
  `onInput` update result nodes in place with `document.getElementById(...)` (null-check every lookup) — do NOT call
  `ctx.render()` on each keystroke (it would rebuild the page and drop focus). Keep the typed values in closure
  state so the next `render()` shows them.
- Element ids must be unique on the page: prefix every id with your module id (`ex-amount`, `inv-line-2-qty`).
- Every tab works in four states: loading (`ctx.isLoading()` → a light loading state, no zeros pretending to be
  data), empty (a designed empty state that says what will appear and how to add the first record), read-only
  (`ctx.canWrite()` false → hide add/edit/delete), and full.
- Records you create: include `createdAt: ctx.iso()`, `createdBy: ctx.me()`; never set `sample: true`.
- Dates are `'YYYY-MM-DD'` strings, months `'YYYY-MM'`. Money is a plain number of dollars.
- Write copy for a founder: plain words, active voice, specific numbers. No exclamation marks, no emoji.

## ctx — what the core gives you (frozen object)

Formatting: `esc(s)`, `num(v)` (finite number or 0), `sum(arr, fn)`, `pad(n)`, `fmtMoney(n)` ("$4,788"),
`fmtCompact(n)` ("$76.6K"), `fmtPrice(n)` (cents when needed), `fmtPct(0.034, digits=1)` ("3.4%"),
`fmtNum(n, digits=0)`, `fmtDate('2027-01-08')` ("Jan 8, 2027" / "Jan 8" this year), `fmtShort(ymd)` ("Jan 8 ’27"),
`relTime(iso)`, `daysSince(iso)`, `initials(name)`, `matches(...fields)` (header search box filter).
Dates: `todayStr()`, `ymd(Date)`, `parseYmd(s)`, `addDays(s, n)`, `isoToYmd(iso)`, `iso()`, `ymOf(s)`,
`monthEnd(ym)` ('2027-02' → '2027-02-28'), `addMonths(ym, n)`, `monthRange(fromYm, toYm)` (inclusive list),
`monthLabel(ym)` ("Jan 27").

Records: `all(collection)` → array of `{id, ...fields}` ([] if not loaded), `get(collection, id)`,
`company(id)`, `contact(id)`, `deal(id)`, `contactName(c)`, `isOpen(deal)`, `stageOf(deal)` → `{id,name,p}`,
`tasks()`, `me()` (viewer id or null), `personName(id)`, `avatar(id)`, `person(id)`, `STAGES`.
Deals: `{name, companyId, contactId, locations, monthlyPrice, listPrice, value (= ARR), setupFee, stage
(lead|qualified|proposal|pilot|won|lost), closeDate, churnedAt?, closedAt, ownerId, notes, ...}`.
`locs(d)`, `priced(d)` (has a locations field), `pricedLocs(d)`, `isChurned(d)`.

Plan (from the projections doc; overridable on the Assumptions tab): `plan()` returns
```
{ source, prices:{2027:399,2028:429,2029:449}, setupFee:750, pilotFee:250, pilots:3,
  newPerMonth:{2027:[2,6],2028:[8,14],2029:[18,30]},            // new locations per month (low, high)
  churn:{base:.03,conservative:.04,upside:.025},                  // monthly churn
  newMultiplier:{base:1,conservative:.5,upside:1.5},
  costOfService:{2027:.18,2028:.16,2029:.15},                     // share of revenue
  opex:{payroll:{2027:36000,2028:160000,2029:480000}, sales:{...22000,70000,180000},
        software:{...8000,18000,40000}, ga:{...10500,25400,70000}}, // annual $
  team:{2027:1,2028:3,2029:6}, cac:{2027:478,2028:947,2029:1042}, hireSalesAtArr:250000, startupCosts:3500,
  targets:[{date:'2027-06-30',label:'Mid-2027',locations:25},
           {date:'2027-12-31',label:'End of 2027',locations:42,arr:203000,revenue:103000,opIncome:8000},
           {date:'2028-12-31',...,locations:144,arr:742000,revenue:479000,opIncome:129000},
           {date:'2029-12-31',...,locations:350,arr:1883000,revenue:1327000,opIncome:358000}],
  scenarios2029:{conservative:{locations:161,arr:865000,revenue:615000}, base:{...350,1883000,1327000},
                 upside:{locations:548,arr:2952000,revenue:2072000}} }
```
`PLAN_DEFAULTS` (the doc's values), `OPEX_LABELS` ({payroll:'Payroll', sales:'Sales & marketing',
software:'Software & tools', ga:'General & admin'}), `EXPENSE_CATEGORIES` ([{id:'cos',label:'Cost of service'},
...the four opex ids]), `planYears()` ([2027,2028,2029]), `priceFor(dateStr)` (price for that year, clamped to
plan years), `setupFee()`, `planTarget()` (end-2027 target `{end,label,locations,arr}`).
Doc unit economics (for checks): GP/location/month $327/$360/$382, LTV $10,900/$12,000/$12,700,
LTV:CAC 22.8x/12.7x/12.2x, CAC payback 1.5/2.6/2.7 months (= price × (1−cos%) ; LTV = GP / churn).

`planModel(scenario='base')` → 36 rows (Jan 2027–Dec 2029):
`{ym, year, month, startLocations, newLocations, churned, locations (end of month), price, mrr, arr, revenue,
cos, grossProfit, opex:{payroll,sales,software,ga} (monthly), opexTotal, opIncome}`. Locations at the start of a
month pay that month's price; then churn leaves and the year's average new locations arrive. It reproduces the
doc within a few percent (e.g. ~42.9 locations / ~$205K ARR at Dec 2027 vs the doc's 42 / $203K; 2027 revenue
~$108K vs $103K). When you show model numbers next to doc numbers, label them "Model" and "Plan doc".
`planYearSummary(model)` → per year `{year, revenue, cos, grossProfit, opex:{...}, opexTotal, opIncome,
newLocations, churned, endLocations, endMrr, endArr, grossMargin, opMargin}`.

Revenue (actuals): `subscriptions()` → won deals as `{id, deal, companyId, name, locations, mrr, arr, start,
end}` (start = close date, end = churnedAt or null). `mrrOn(ymd)`, `locationsOn(ymd)` (active on that date).
To churn a customer: `ctx.patch('deals', id, {churnedAt: 'YYYY-MM-DD'})`; to undo: `{churnedAt: null}`.

Cash: `finance()` → `{openingCash, openingDate, budgets, note}` (settings/finance; defaults $3,500 on
2026-11-01 = the plan's founder-funded startup costs). `cashFlows(toDay)` → `{ins:[{date,amount,ref}],
outs:[...]}` (paid invoices in, expenses out, from the opening date). `cashOn(ymd)`, `cashByMonth(fromYm,toYm)`
→ `[{ym, cashIn, cashOut, net, end}]`, `burnRate(n=3)` → `{monthly, basis}` (monthly net burn; positive =
cash going out), `runwayMonths()` (Infinity when not burning). `invoiceTotal(inv)`, `invoiceStatus(inv)`
('draft'|'sent'|'overdue'|'paid'|'void').

Writes (all return Promise<boolean|id>; they toast their own errors): `create(coll, data)` → new id or null,
`patch(coll, id, fields)` (merge into an existing doc), `remove(coll, id)`, `setDoc(coll, id, data)` (full
replace; for settings docs — read the current doc with `get('settings','finance')` and spread it first so you
keep fields you don't own).

UI: `toast(msg, 'bad'?)`, `openConfirm(title, body, confirmLabel, async onYes)`, `openFormModal({title, body,
submitLabel, onSubmit: async () => true|false, deleteLabel?, onDelete?, afterOpen?(modalEl)})`,
`closeModal()`, `formErr(msg, focusId)` (shows the error, returns null), `val(id)` (trimmed string value),
`parseMoney(s)` (number, 0 for empty, null if invalid). Field builders `F.text(id,label,value,attrs)`,
`F.area(id,label,value,rows)`, `F.select(id,label,[[value,text],...],selected)`, `F.date(id,label,value)`,
`F.money(id,label,value)`, `F.number(id,label,value,attrs)`, `F.check(id,label,checked)`. Wrap two fields side by
side in `<div class="row2">…</div>`. Inside a modal, read values with `ctx.val(id)` (checkbox:
`document.getElementById(id).checked`).
`ui.toolbar({title, count?, filters?: html, actions?: html, exportable?: true})`, `ui.kpi({label, value: html,
sub?: html, tone?: 'bad'|'good'|'warn', bar?: html})` — put kpis in `<section class="kpis">`,
`ui.panel({title, sub?, actions?: html, body: html, cls?})`, `ui.empty({title, text, action?: html})`,
`ui.progress(fraction, tone?)`, `ui.chip(text, tone?: 'good'|'warn'|'bad'|'accent')`.
`render()` asks the core to re-render (only after state changes that are not data writes; writes re-render on
their own). `go(tabId)`. `isLoading()`, `canWrite()`, `S` (read-only: `S.q` search text, `S.status`,
`S.downloads`).

Charts (SVG, drawn after render at the slot's real width, with hover tooltips):
`chart.bars({labels:[...], series:[{name, values:[...], color}], height:220, format: fn, refLine:{value,label},
ariaLabel})`, `chart.line({labels, series:[{name, values (null = gap), color, dashed}], ...})`. Colors by role:
actuals/main series `var(--viz-1)`, second category `var(--viz-2)`, third `var(--viz-3)`, plan/projection
`var(--viz-plan)` with `dashed: true`. Never use status colors (--good/--bad) for a series. ≤3 series per chart.
A chart ≥2 series gets a legend automatically. Always put the same numbers in a table or text nearby. One y-axis only.

CSS classes available: `toolbar`, `view-title`, `view-count`, `spacer`, `seg` (button group; set
`aria-pressed`), `btn btn-sm btn-primary btn-ghost btn-danger`, `kpis` (4-up grid of `kpi`), `grid grid-2 grid-3
grid-4`, `section` (bottom margin), `panel`, `panel-h`, `stat-list` with `<div class="stat-row"><dt>..</dt><dd>..</dd></div>`
(`stat-row total` for a sum row), `table-wrap` + `<table class="compact">` (`th.num`/`td.num` right-aligned
mono), `chip chip-good chip-warn chip-bad chip-accent`, `progress` (+`good`/`warn`/`bad`), `num`, `pos`, `neg`,
`note`, `source`, `calc-grid` (auto-fill grid of fields), `field`, `input`, `row2`, `empty`, `muted`, `mono`,
`row-actions`, `link`, `icon-btn`.

## Testing (required before you finish)

```bash
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
python3 build.py --only <id> --out "$TMPDIR/<id>.html"
$JSC src/harness/run.js -- "$TMPDIR/<id>.html" <id>
```
Run from the project root. The harness boots the whole page with fake data (`src/harness/fixture.json`: 4 companies,
deals incl. a won + a churned subscription and a legacy deal, tasks, 6 expenses (one before the cash opening
date), 3 invoices (paid / overdue / draft), 3 milestones, 2 hires, 3 market segments, settings/finance), renders
your tab, calls badge/csv/newItems and submits each new-item form once with its defaults. The last line must be
`RESULT: PASS`. Also check the printed text: numbers must be plausible for the fixture (e.g. cash on 2026-11-22 =
3500 + 250 paid − (20+180+240.5+300+15) = $2,994.50). Never edit core.html, build.py or the harness.
