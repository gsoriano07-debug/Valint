(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Expenses: log spending by income-statement line and compare each month with the plan budget.
     Budget for a plan year = opex[line][year] / 12 for each operating line, plus the plan model's cost of
     service for that month. Before the first plan year the plan's startup costs are spread evenly from the
     cash opening month through December of the prior year. After the last plan year the last year's values apply. */
  const ID = 'expenses';
  const CATS = ctx.EXPENSE_CATEGORIES;
  const CAT_LABEL = Object.create(null); // no prototype, so a stored category like 'constructor' reads as unknown
  CATS.forEach(c => { CAT_LABEL[c.id] = c.label; });
  const st = { ym: null, all: false, lastCat: 'ga' };

  /* ---------- small helpers ---------- */
  const curYm = () => ctx.ymOf(ctx.todayStr());
  const selYm = () => st.ym || curYm();
  const round2 = n => (Math.round(ctx.num(n) * 100) / 100) || 0;
  const money = n => ctx.fmtPrice(round2(n));
  const catLabel = id => CAT_LABEL[id] || 'Uncategorized';
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  function longMonth(ym) {
    const p = String(ym || '').split('-').map(Number);
    if (!p[0] || !p[1]) return String(ym || '');
    return new Date(p[0], p[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const btn = (a, text, extra, cls) => `<button class="btn btn-sm ${cls || ''}" type="button" data-act="mod" data-mod="${ID}" data-a="${a}" ${extra || ''}>${text}</button>`;
  const expenses = () => ctx.all('expenses');
  const inMonth = (x, ym) => ctx.ymOf(x.date) === ym;
  const newer = (a, b) => {
    const da = String(a.date || ''), db = String(b.date || '');
    if (da !== db) return da > db;
    return String(a.createdAt || '') > String(b.createdAt || '');
  };
  const newestFirst = (a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0);

  function modelIndex() {
    const by = {};
    ctx.planModel('base').forEach(r => { by[r.ym] = r; });
    return by;
  }

  /* ---------- budget ---------- */
  function budgetFor(ym, modelByYm) {
    const P = ctx.plan(), years = ctx.planYears();
    if (!years.length) return { kind: 'none', total: 0 };
    const y = Number(String(ym).slice(0, 4)), first = years[0], last = years[years.length - 1];
    if (y < first) {
      const openYm = ctx.ymOf(ctx.finance().openingDate), endYm = `${first - 1}-12`;
      const months = openYm <= endYm ? ctx.monthRange(openYm, endYm) : [];
      const startup = ctx.num(P.startupCosts);
      const inRange = months.indexOf(ym) >= 0;
      return {
        kind: 'startup', total: inRange && months.length ? startup / months.length : 0,
        startup, months, inRange, openYm, endYm, beforeOpen: ym < openYm, firstYear: first
      };
    }
    const yy = years.filter(v => v <= y).pop();
    const row = modelByYm[`${yy}-${String(ym).slice(5, 7)}`];
    const by = {};
    CATS.forEach(c => {
      by[c.id] = c.id === 'cos' ? (row ? ctx.num(row.cos) : 0) : ctx.num(((P.opex || {})[c.id] || {})[yy]) / 12;
    });
    return { kind: 'plan', total: ctx.sum(Object.keys(by), k => by[k]), by, year: yy, clamped: y > last, last };
  }

  /* ---------- recurring costs ---------- */
  const recKey = x => norm(x.vendor) + '|' + norm(x.description);
  /* Latest entry of each recurring expense (by vendor + description) dated on or before `endDay`. */
  function recurringLatest(list, endDay) {
    const by = new Map();
    list.forEach(x => {
      if (!x.recurring || !x.date || x.date > endDay) return;
      const k = recKey(x), cur = by.get(k);
      if (!cur || newer(x, cur)) by.set(k, x);
    });
    return [...by.values()].sort((a, b) => ctx.num(b.amount) - ctx.num(a.amount));
  }
  /* Recurring costs last logged before `ym` that have no entry in `ym` yet. */
  function recurringDue(list, ym) {
    const start = ym + '-01';
    const prior = recurringLatest(list, ctx.addDays(start, -1));
    const logged = new Set(list.filter(x => inMonth(x, ym)).map(recKey));
    return prior.filter(x => !logged.has(recKey(x)));
  }
  function sameDayIn(ym, dateStr) {
    const day = Math.max(1, Number(String(dateStr || '').slice(8, 10)) || 1);
    const end = ctx.monthEnd(ym);
    return `${ym}-${ctx.pad(Math.min(day, Number(end.slice(8, 10))))}`;
  }

  /* ---------- per-month figures ---------- */
  function monthFigures(list, ym, modelByYm) {
    const rows = list.filter(x => inMonth(x, ym));
    const byCat = Object.create(null);
    CATS.forEach(c => { byCat[c.id] = 0; });
    let other = 0;
    rows.forEach(x => { if (byCat[x.category] != null) byCat[x.category] += ctx.num(x.amount); else other += ctx.num(x.amount); });
    const spent = ctx.sum(rows, x => ctx.num(x.amount));
    return { ym, rows, byCat, other, spent, budget: budgetFor(ym, modelByYm) };
  }

  /* ---------- pieces of the page ---------- */
  function monthPicker() {
    const ym = selYm();
    const here = ym === curYm();
    return `<div class="seg" role="group" aria-label="Month">
      <button type="button" data-act="mod" data-mod="${ID}" data-a="prev" aria-label="Previous month" title="Previous month">&lsaquo;</button>
      <button type="button" data-act="mod" data-mod="${ID}" data-a="month" aria-pressed="${!st.all}" title="${st.all ? 'Show this month only' : here ? 'This month' : 'Back to this month'}">${ctx.esc(longMonth(ym))}</button>
      <button type="button" data-act="mod" data-mod="${ID}" data-a="next" aria-label="Next month" title="Next month">&rsaquo;</button>
      <button type="button" data-act="mod" data-mod="${ID}" data-a="all" aria-pressed="${st.all}" title="List every expense">All</button>
    </div>`;
  }

  function kpiRow(f, list) {
    const b = f.budget, spent = f.spent, budget = b.total;
    const used = budget > 0 ? spent / budget : null;
    const diff = round2(spent - budget);
    const tone = used == null ? '' : spent > budget ? 'bad' : used >= 0.9 ? 'warn' : 'good';
    let budgetSub;
    if (b.kind === 'none') budgetSub = 'No plan years set. Add them on Assumptions.';
    else if (b.kind === 'startup') {
      budgetSub = b.beforeOpen ? `Before cash opens in ${ctx.esc(longMonth(b.openYm))}`
        : `Startup costs of ${money(b.startup)} over ${plural(b.months.length, 'month')}`;
    } else budgetSub = b.clamped ? `Plan ends in ${b.last}, so ${b.year} values apply` : `${b.year} plan; cost of service from the model`;
    const diffVal = diff > 0 ? `${money(diff)}<span class="kpi-unit"> over</span>`
      : diff < 0 ? `${money(-diff)}<span class="kpi-unit"> under</span>` : '$0';
    const rec = recurringLatest(list, ctx.monthEnd(f.ym));
    const recTotal = ctx.sum(rec, x => ctx.num(x.amount));
    return `<section class="kpis">
      ${ctx.ui.kpi({ label: 'Spent', value: money(spent), sub: `${plural(f.rows.length, 'expense')} in ${ctx.esc(longMonth(f.ym))}`, bar: used != null ? ctx.ui.progress(used, tone) : '' })}
      ${ctx.ui.kpi({ label: b.kind === 'startup' ? 'Startup budget' : 'Plan budget', value: b.kind === 'none' ? '—' : money(budget), sub: budgetSub })}
      ${ctx.ui.kpi({ label: 'Over / under budget', value: diffVal, tone: diff > 0 ? 'bad' : (budget > 0 ? 'good' : ''), sub: used != null ? `${ctx.fmtPct(used, 0)} of the budget used` : (spent > 0 ? 'No budget for this month' : 'Nothing spent or budgeted') })}
      ${ctx.ui.kpi({ label: 'Recurring monthly', value: money(recTotal), sub: rec.length ? `${plural(rec.length, 'recurring cost')}, latest amount of each` : list.some(x => x.recurring) ? `None logged by the end of ${ctx.esc(longMonth(f.ym))}` : 'Mark an expense as recurring to track this' })}
    </section>`;
  }

  function diffCell(actual, budget) {
    const d = round2(actual - budget);
    if (d > 0) return `<td class="num neg">${money(d)} over</td>`;
    if (d < 0) return `<td class="num">${money(-d)} under</td>`;
    return '<td class="num muted">On budget</td>';
  }

  function vsBudgetPanel(f) {
    const b = f.budget;
    const labels = CATS.map(c => c.label), actual = CATS.map(c => round2(f.byCat[c.id]));
    if (f.other > 0) { labels.push('Uncategorized'); actual.push(round2(f.other)); }
    let chart, detail;
    if (b.kind === 'plan') {
      const budget = CATS.map(c => round2(b.by[c.id]));
      if (f.other > 0) budget.push(null);
      chart = ctx.chart.bars({
        labels, height: 220, ariaLabel: `Actual spending and plan budget by category, ${longMonth(f.ym)}`,
        series: [{ name: 'Actual', values: actual, color: 'var(--viz-1)' }, { name: 'Plan budget', values: budget, color: 'var(--viz-plan)' }]
      });
      const rows = CATS.map(c => `<tr><td>${ctx.esc(c.label)}${c.id === 'cos' ? ' <span class="muted">(model)</span>' : ''}</td><td class="num">${money(f.byCat[c.id])}</td><td class="num">${money(b.by[c.id])}</td>${diffCell(f.byCat[c.id], b.by[c.id])}</tr>`).join('')
        + (f.other > 0 ? `<tr><td>Uncategorized</td><td class="num">${money(f.other)}</td><td class="num muted">—</td>${diffCell(f.other, 0)}</tr>` : '');
      detail = `<div class="table-wrap flat" style="margin-top:12px"><table class="compact" style="min-width:0"><thead><tr><th>Category</th><th class="num">Actual</th><th class="num">Budget</th><th class="num">Difference</th></tr></thead>
        <tbody>${rows}<tr><td><strong>Total</strong></td><td class="num"><strong>${money(f.spent)}</strong></td><td class="num"><strong>${money(b.total)}</strong></td>${diffCell(f.spent, b.total)}</tr></tbody></table></div>`;
    } else {
      chart = ctx.chart.bars({
        labels, height: 220, ariaLabel: `Spending by category, ${longMonth(f.ym)}`,
        series: [{ name: 'Spent', values: actual, color: 'var(--viz-1)' }]
      });
      const d = round2(f.spent - b.total);
      const lines = labels.map((l, i) => `<div class="stat-row"><dt>${ctx.esc(l)}</dt><dd>${money(actual[i])}</dd></div>`).join('');
      let note = '';
      if (b.kind === 'startup') {
        note = b.inRange
          ? `Before the ${b.firstYear} plan year, the plan budgets ${money(b.startup)} of startup costs with no category split, spread evenly over ${ctx.esc(longMonth(b.months[0]))} to ${ctx.esc(longMonth(b.months[b.months.length - 1]))} (${plural(b.months.length, 'month')}): ${money(b.total)} a month.`
          : `This month is before the cash opening month (${ctx.esc(longMonth(b.openYm))}), so it has no startup budget.`;
      } else note = 'Add plan years on the Assumptions tab to get a budget.';
      detail = `<dl class="stat-list" style="margin-top:12px">${lines}
          <div class="stat-row total"><dt>Total spent</dt><dd>${money(f.spent)}</dd></div>
          <div class="stat-row"><dt>Startup budget</dt><dd>${money(b.total)}</dd></div>
          <div class="stat-row"><dt>${d > 0 ? 'Over budget' : 'Under budget'}</dt><dd class="${d > 0 ? 'neg' : ''}">${money(Math.abs(d))}</dd></div>
        </dl><p class="note">${note}</p>`;
    }
    return ctx.ui.panel({ title: 'Spend vs budget', sub: longMonth(f.ym), body: chart + detail });
  }

  function trendPanel(list, modelByYm) {
    const cur = curYm(), openYm = ctx.ymOf(ctx.finance().openingDate);
    let from = ctx.addMonths(cur, -11);
    if (openYm > from) from = openYm;
    if (from > cur) from = cur;
    const months = ctx.monthRange(from, cur).map(ym => monthFigures(list, ym, modelByYm));
    const chart = ctx.chart.bars({
      labels: months.map(m => ctx.monthLabel(m.ym)), height: 220, ariaLabel: 'Total spending per month',
      series: [{ name: 'Spent', values: months.map(m => round2(m.spent)), color: 'var(--viz-1)' }]
    });
    const sel = selYm();
    const rows = months.slice().reverse().map(m => `<tr><td><button class="link" type="button" data-act="mod" data-mod="${ID}" data-a="pick" data-ym="${ctx.esc(m.ym)}"${m.ym === sel && !st.all ? ' aria-current="true"' : ''}>${ctx.esc(longMonth(m.ym))}</button></td><td class="num">${money(m.spent)}</td><td class="num">${m.budget.kind === 'none' ? '—' : money(m.budget.total)}</td>${diffCell(m.spent, m.budget.total)}</tr>`).join('');
    const total = ctx.sum(months, m => m.spent);
    const body = chart + `<div class="table-wrap flat" style="margin-top:12px"><table class="compact" style="min-width:0"><thead><tr><th>Month</th><th class="num">Spent</th><th class="num">Budget</th><th class="num">Difference</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">${plural(months.length, 'month')} since ${ctx.esc(longMonth(from))}: ${money(total)} spent, ${money(total / Math.max(1, months.length))} a month on average. Pick a month to see its breakdown.</p>`;
    return ctx.ui.panel({ title: 'Monthly spend', sub: months.length >= 12 ? 'Last 12 months' : from === openYm ? `Since the ${longMonth(openYm)} cash opening` : `Cash opens in ${longMonth(openYm)}`, body });
  }

  function tablePanel(list) {
    const ym = selYm(), w = ctx.canWrite();
    const base = st.all ? list : list.filter(x => inMonth(x, ym));
    const rows = base.filter(x => ctx.matches(x.vendor, x.description, catLabel(x.category))).sort(newestFirst);
    const q = String(ctx.S.q || '').trim();
    const openDate = ctx.finance().openingDate;
    const title = st.all ? 'All expenses' : `Expenses in ${longMonth(ym)}`;
    const add = w ? btn('new', 'Add expense', '', 'btn-primary') : '';
    if (!rows.length) {
      const msg = q && base.length ? `No expenses match “${ctx.esc(q)}”${st.all ? '' : ' this month'}. Try another search.`
        : st.all ? 'No expenses logged yet.' : `Nothing logged for ${ctx.esc(longMonth(ym))} yet.`;
      return ctx.ui.panel({ title, body: `<p class="muted" style="margin:0">${msg}</p>`, actions: add });
    }
    const total = ctx.sum(rows, x => ctx.num(x.amount));
    const body = rows.map(x => {
      const early = x.date && x.date < openDate ? ' <span class="chip chip-warn" title="Dated before the cash opening date, so cash does not count it">Before opening</span>' : '';
      return `<tr>
        <td style="white-space:nowrap">${ctx.esc(ctx.fmtDate(x.date) || '—')}${early}</td>
        <td><div class="trunc">${ctx.esc(x.vendor || '—')}</div></td>
        <td><div class="trunc">${ctx.esc(x.description || '')}</div>${x.notes ? `<div class="trunc muted" style="font-size:12.5px">${ctx.esc(x.notes)}</div>` : ''}</td>
        <td style="white-space:nowrap">${ctx.esc(catLabel(x.category))}</td>
        <td class="num">${money(x.amount)}</td>
        <td>${x.recurring ? ctx.ui.chip('Monthly', 'accent') : '<span class="muted">—</span>'}</td>
        ${w ? `<td><div class="row-actions">${btn('edit', 'Edit', `data-id="${ctx.esc(x.id)}" aria-label="Edit ${ctx.esc(x.vendor || x.description || 'expense')}"`, 'btn-ghost')}${btn('delete', 'Delete', `data-id="${ctx.esc(x.id)}" aria-label="Delete ${ctx.esc(x.vendor || x.description || 'expense')}"`, 'btn-ghost btn-danger')}</div></td>` : ''}
      </tr>`;
    }).join('');
    const head = `<tr><th>Date</th><th>Vendor</th><th>Description</th><th>Category</th><th class="num">Amount</th><th>Recurring</th>${w ? '<th aria-label="Actions"></th>' : ''}</tr>`;
    const foot = `<tr><td colspan="4"><strong>Total</strong> <span class="muted">${plural(rows.length, 'expense')}</span></td><td class="num"><strong>${money(total)}</strong></td><td colspan="${w ? 2 : 1}"></td></tr>`;
    return ctx.ui.panel({
      title, sub: `${plural(rows.length, 'expense')}, ${money(total)}${q ? ` matching “${q}”` : ''}`, actions: add,
      body: `<div class="table-wrap flat"><table class="compact"><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div>`
    });
  }

  function recurringPanel(list) {
    const ym = selYm();
    const rec = recurringLatest(list, ctx.monthEnd(ym));
    const due = recurringDue(list, ym);
    const total = ctx.sum(rec, x => ctx.num(x.amount));
    const dueTotal = ctx.sum(due, x => ctx.num(x.amount));
    const action = ctx.canWrite() && due.length ? btn('log-recurring', `Log ${plural(due.length, 'cost')} for ${ctx.esc(longMonth(ym))}`) : '';
    let body;
    if (!rec.length && list.some(x => x.recurring)) body = `<p class="muted" style="margin:0">No recurring costs were logged by the end of ${ctx.esc(longMonth(ym))}. Pick a later month to see your run-rate.</p>`;
    else if (!rec.length) body = '<p class="muted" style="margin:0">No recurring costs yet. Tick “Recurring every month” on an expense, such as hosting or a software seat, to track your monthly run-rate here.</p>';
    else {
      const dueKeys = new Set(due.map(recKey));
      body = `<dl class="stat-list">${rec.map(x => `<div class="stat-row"><dt>${ctx.esc(x.vendor || x.description || 'Expense')}${x.vendor && x.description ? ` <span class="source">${ctx.esc(x.description)}</span>` : ''}<br><span class="source">${ctx.esc(catLabel(x.category))} · last ${ctx.esc(ctx.fmtDate(x.date))}${dueKeys.has(recKey(x)) ? ' · not logged this month' : ''}</span></dt><dd>${money(x.amount)}</dd></div>`).join('')}
        <div class="stat-row total"><dt>Per month</dt><dd>${money(total)}</dd></div><div class="stat-row"><dt>Per year</dt><dd>${money(total * 12)}</dd></div></dl>
        <p class="note">Each recurring cost counts once, at its latest amount up to the end of ${ctx.esc(longMonth(ym))}.${due.length ? ` ${plural(due.length, 'cost')} (${money(dueTotal)}) not logged for ${ctx.esc(longMonth(ym))} yet.` : ''}</p>`;
    }
    return ctx.ui.panel({ title: 'Recurring costs', sub: `As of ${longMonth(ym)}`, actions: action, body });
  }

  function planPanel(modelByYm) {
    const P = ctx.plan(), years = ctx.planYears();
    if (!years.length) return ctx.ui.panel({ title: 'Monthly budget by plan year', body: '<p class="muted" style="margin:0">No plan years are set. Add them on the Assumptions tab.</p>' });
    const summary = ctx.planYearSummary(Object.keys(modelByYm).map(k => modelByYm[k]));
    const sumBy = {};
    summary.forEach(s => { sumBy[s.year] = s; });
    const cell = (c, y) => c.id === 'cos' ? ctx.num((sumBy[y] || {}).cos) / 12 : ctx.num(((P.opex || {})[c.id] || {})[y]) / 12;
    const rows = CATS.map(c => `<tr><td>${ctx.esc(c.label)}${c.id === 'cos' ? ' <span class="muted">(model avg.)</span>' : ''}</td>${years.map(y => `<td class="num">${money(cell(c, y))}</td>`).join('')}</tr>`).join('');
    const totals = years.map(y => `<td class="num"><strong>${money(ctx.sum(CATS, c => cell(c, y)))}</strong></td>`).join('');
    const first = budgetFor(`${years[0] - 1}-12`, modelByYm);
    const note = first.kind === 'startup' && first.months.length
      ? `Before ${years[0]}: ${money(first.startup)} of startup costs over ${plural(first.months.length, 'month')} (${ctx.esc(longMonth(first.months[0]))} to ${ctx.esc(longMonth(first.endYm))}) = ${money(first.total)} a month. `
      : '';
    return ctx.ui.panel({
      title: 'Monthly budget by plan year', sub: 'Operating lines are the annual plan divided by 12',
      body: `<div class="table-wrap flat"><table class="compact" style="min-width:0"><thead><tr><th>Category</th>${years.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead><tbody>${rows}<tr><td><strong>Total per month</strong></td>${totals}</tr></tbody></table></div>
        <p class="note">${note}Cost of service follows the plan model’s revenue, so its monthly budget grows as locations grow. <button class="link" type="button" data-act="go" data-view="assumptions">Change the plan on Assumptions</button></p>`
    });
  }

  /* ---------- form + actions ---------- */
  function moveTo(date) {
    if (!st.all && ctx.ymOf(date) !== selYm()) { st.ym = ctx.ymOf(date); ctx.render(); }
  }

  function openForm(x) {
    const editing = !!(x && x.id);
    const r = x || {};
    const body = `<div class="row2">${ctx.F.date('expenses-f-date', 'Date paid', r.date || ctx.todayStr())}${ctx.F.text('expenses-f-vendor', 'Vendor', r.vendor || '', 'maxlength="120" autocomplete="off" placeholder="Who you paid"')}</div>`
      + ctx.F.text('expenses-f-desc', 'Description', r.description || '', 'maxlength="200" placeholder="What it was for"')
      + `<div class="row2">${ctx.F.select('expenses-f-cat', 'Category', CATS.map(c => [c.id, c.label]), CAT_LABEL[r.category] ? r.category : st.lastCat)}${ctx.F.money('expenses-f-amount', 'Amount ($)', r.amount != null && r.amount !== '' ? r.amount : '', 'placeholder="0.00"')}</div>`
      + ctx.F.check('expenses-f-recurring', 'Recurring every month', !!r.recurring)
      + ctx.F.area('expenses-f-notes', 'Notes', r.notes || '', 2);
    ctx.openFormModal({
      title: editing ? 'Edit expense' : 'Add expense',
      submitLabel: editing ? 'Save changes' : 'Add expense',
      body,
      deleteLabel: editing ? 'Delete' : undefined,
      onDelete: editing ? () => confirmDelete(r.id) : undefined,
      onSubmit: async () => {
        const date = ctx.val('expenses-f-date');
        if (!ctx.parseYmd(date)) return ctx.formErr('Pick the date you paid.', 'expenses-f-date');
        const vendor = ctx.val('expenses-f-vendor'), description = ctx.val('expenses-f-desc');
        if (!vendor && !description) return ctx.formErr('Add who you paid or what it was for.', 'expenses-f-vendor');
        const category = ctx.val('expenses-f-cat');
        if (!CAT_LABEL[category]) return ctx.formErr('Pick a category.', 'expenses-f-cat');
        const amount = ctx.parseMoney(ctx.val('expenses-f-amount'));
        if (amount == null || !(amount > 0)) return ctx.formErr('Enter an amount above $0, like 49 or 240.50.', 'expenses-f-amount');
        const recEl = document.getElementById('expenses-f-recurring');
        const fields = { date, vendor, description, category, amount, recurring: !!(recEl && recEl.checked), notes: ctx.val('expenses-f-notes') };
        st.lastCat = category;
        if (editing) {
          const ok = await ctx.patch('expenses', r.id, Object.assign(fields, { updatedAt: ctx.iso() }));
          if (!ok) return false;
          moveTo(date); ctx.toast('Expense updated');
          return true;
        }
        const id = await ctx.create('expenses', Object.assign(fields, { createdAt: ctx.iso(), createdBy: ctx.me() }));
        if (!id) return false;
        moveTo(date); ctx.toast(`Added ${money(amount)} to ${longMonth(ctx.ymOf(date))}`);
        return true;
      }
    });
  }

  function confirmDelete(id) {
    const x = ctx.get('expenses', id);
    if (!x) return;
    const what = [x.vendor, x.description].filter(Boolean).join(', ') || 'This expense';
    ctx.openConfirm('Delete this expense?', `${what}: ${money(x.amount)} on ${ctx.fmtDate(x.date) || 'no date'}. This can’t be undone.`, 'Delete expense', async () => {
      if (await ctx.remove('expenses', id)) ctx.toast('Expense deleted');
    });
  }

  function confirmLogRecurring() {
    const ym = selYm(), due = recurringDue(expenses(), ym);
    if (!due.length) { ctx.toast(`Every recurring cost is already logged for ${longMonth(ym)}.`); return; }
    const total = ctx.sum(due, x => ctx.num(x.amount));
    ctx.openConfirm(`Log recurring costs for ${longMonth(ym)}?`,
      `Adds ${plural(due.length, 'expense')} totaling ${money(total)} (${due.map(x => x.vendor || x.description || 'Expense').join(', ')}), each on the same day of the month as last time at its latest amount. Edit any of them afterwards if the amount changed.`,
      `Log ${plural(due.length, 'expense')}`, async () => {
        let made = 0;
        for (const x of due) {
          const id = await ctx.create('expenses', {
            date: sameDayIn(ym, x.date), vendor: x.vendor || '', description: x.description || '', category: CAT_LABEL[x.category] ? x.category : 'ga',
            amount: round2(x.amount), recurring: true, notes: '', createdAt: ctx.iso(), createdBy: ctx.me()
          });
          if (!id) break;
          made++;
        }
        if (made) ctx.toast(`Logged ${plural(made, 'recurring cost')} for ${longMonth(ym)}`);
      });
  }

  /* ---------- module ---------- */
  return {
    id: ID,
    label: 'Expenses',
    group: 'Finance',
    order: 20,
    collections: ['expenses'],
    newItems: [{ label: 'Expense', a: 'new' }],
    badge() {
      const list = expenses();
      if (!list.length) return null;
      const f = monthFigures(list, curYm(), modelIndex());
      if (!(f.budget.total > 0) || f.spent <= f.budget.total) return null;
      return { text: 'Over', hot: true, title: `${longMonth(f.ym)} spending is ${money(f.spent - f.budget.total)} over the plan budget` };
    },
    render() {
      const loading = ctx.isLoading(), w = ctx.canWrite();
      const list = loading ? [] : expenses();
      const add = w ? btn('new', 'Add expense', '', 'btn-primary') : '';
      if (loading) {
        return ctx.ui.toolbar({ title: 'Expenses', actions: add }) + '<div class="empty"><p>Loading expenses…</p></div>';
      }
      const modelByYm = modelIndex();
      if (!list.length) {
        const b = budgetFor(selYm(), modelByYm);
        const lines = CATS.map(c => c.label.toLowerCase());
        const budgetText = b.total > 0 ? ` Your plan budget for ${longMonth(selYm())} is ${money(b.total)}.` : '';
        return ctx.ui.toolbar({ title: 'Expenses', count: '0 logged', actions: add, exportable: true }) + ctx.ui.empty({
          title: 'No expenses logged yet',
          text: `Log each payment to see spending against the plan budget, month by month.${budgetText} Categories match the plan’s income statement lines: ${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}. Mark hosting, seats and other monthly bills as recurring to track your run-rate.`,
          action: w ? `<button class="btn btn-primary" type="button" data-act="mod" data-mod="${ID}" data-a="new">Add your first expense</button>` : ''
        });
      }
      const f = monthFigures(list, selYm(), modelByYm);
      return ctx.ui.toolbar({ title: 'Expenses', count: `${list.length} logged`, filters: monthPicker(), actions: add, exportable: true })
        + kpiRow(f, list)
        + `<div class="grid grid-2 section">${vsBudgetPanel(f)}${trendPanel(list, modelByYm)}</div>`
        + `<div class="section">${tablePanel(list)}</div>`
        + `<div class="grid grid-2 section">${recurringPanel(list)}${planPanel(modelByYm)}</div>`;
    },
    onAction(a, d) {
      if (a === 'prev' || a === 'next') { st.ym = ctx.addMonths(selYm(), a === 'prev' ? -1 : 1); st.all = false; ctx.render(); }
      else if (a === 'month') { if (st.all) st.all = false; else st.ym = curYm(); ctx.render(); }
      else if (a === 'all') { st.all = !st.all; ctx.render(); }
      else if (a === 'pick') { if (/^\d{4}-\d{2}$/.test(d.ym || '')) { st.ym = d.ym; st.all = false; ctx.render(); } }
      else if (a === 'new') openForm(null);
      else if (a === 'edit') { const x = ctx.get('expenses', d.id); if (x) openForm(x); else ctx.toast('That expense no longer exists.', 'bad'); }
      else if (a === 'delete') confirmDelete(d.id);
      else if (a === 'log-recurring') confirmLogRecurring();
    },
    csv() {
      const rows = [['Date', 'Vendor', 'Description', 'Category', 'Amount', 'Recurring monthly', 'Notes', 'Created']];
      expenses().slice().sort((a, b) => -newestFirst(a, b)).forEach(x => {
        rows.push([x.date || '', x.vendor || '', x.description || '', catLabel(x.category), round2(x.amount), x.recurring ? 'Yes' : 'No', x.notes || '', ctx.isoToYmd(x.createdAt)]);
      });
      return { name: 'expenses', rows };
    }
  };
});
