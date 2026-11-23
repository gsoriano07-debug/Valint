/* Overview: the company at a glance. Read-only: it reads deals, tasks, invoices, expenses, milestones,
   settings and the plan, and never writes. Every figure comes from the shared finance helpers or ctx.plan(). */
(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  const ID = 'overview';
  const ui = ctx.ui, esc = ctx.esc, num = ctx.num, sum = ctx.sum;
  const OPEN_STAGES = ctx.STAGES.filter(s => s.id !== 'won' && s.id !== 'lost');
  const STALE_DAYS = 14;
  const METRIC_LABEL = { locations: 'locations', arr: 'ARR', mrr: 'MRR', cash: 'cash' };
  const STATUS_CHIP = {
    'done': ['Done', 'good'], 'in-progress': ['In progress', 'accent'], 'not-started': ['Not started', ''],
    'at-risk': ['At risk', 'warn'], 'blocked': ['Blocked', 'bad'], 'missed': ['Missed', 'bad']
  };

  /* ---------- small formatting helpers ---------- */
  const cents = n => Math.round(num(n) * 100) / 100 || 0; /* `|| 0` turns -0 into 0, so float noise never shows "-$0" */
  const MAX_RUNWAY = 1200; /* months (100 years): past this, a run-out month is meaningless and Date math overflows */
  const lcFirst = s => String(s || '').replace(/^./, ch => ch.toLowerCase()); /* "End of 2028" reads "by end of 2028" mid-sentence */
  const tDate = m => (m && ctx.parseYmd(m.targetDate) ? m.targetDate : ''); /* a malformed or non-string date counts as no date */
  /* Small balances show cents (cash is often a few hundred dollars here); large ones round to dollars. */
  const money = n => { const v = cents(n); return Math.abs(v) >= 10000 ? ctx.fmtMoney(v) : ctx.fmtPrice(v); };
  const plural = (n, one, many) => (n === 1 ? one : (many || one + 's'));
  const longMonth = ym => { const p = String(ym || '').split('-').map(Number); return p.length === 2 && p[0] && p[1] ? new Date(p[0], p[1] - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''; };
  const daysBetween = (a, b) => { const x = ctx.parseYmd(a), y = ctx.parseYmd(b); return x && y ? Math.round((y - x) / 864e5) : null; };
  const goBtn = (view, label) => `<button class="btn btn-sm" type="button" data-act="go" data-view="${esc(view)}">${esc(label)}</button>`;
  const lastTouch = d => d.lastActivityAt || d.stageChangedAt || d.updatedAt || d.createdAt;
  const isDone = m => m.status === 'done';
  const coName = id => { const c = ctx.company(id); return c && c.name ? c.name : ''; };

  function nextTarget(today) {
    const ts = (ctx.plan().targets || []).filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') && t.date > today && t.locations != null && t.locations !== '');
    ts.sort((a, b) => a.date.localeCompare(b.date));
    return ts[0] || null;
  }
  function metricNow(metric, today) {
    if (metric === 'locations') return ctx.locationsOn(today);
    if (metric === 'arr') return ctx.mrrOn(today) * 12;
    if (metric === 'mrr') return ctx.mrrOn(today);
    if (metric === 'cash') return ctx.cashOn(today);
    return null;
  }
  const metricFmt = (metric, v) => (metric === 'locations' ? ctx.fmtNum(v) : ctx.fmtCompact(v));

  /* ---------- the numbers (shared by render and csv) ---------- */
  function compute() {
    const today = ctx.todayStr(), cur = ctx.ymOf(today), F = ctx.finance();
    const subs = ctx.subscriptions().filter(s => s.start <= today && (!s.end || s.end > today));
    const mrr = ctx.mrrOn(today);
    const locations = ctx.locationsOn(today);
    const target = nextTarget(today);
    const cash = ctx.cashOn(today);
    const burn = ctx.burnRate();
    /* A burn that rounds to $0.00 is float noise (cash in matching cash out to the cent): treat it as not burning,
       or runway would show something like 46236956174337097728.0 months. */
    const runway = cents(burn.monthly) > 0 ? ctx.runwayMonths() : Infinity;
    let runsOut = null;
    if (isFinite(runway) && runway <= MAX_RUNWAY) {
      /* Months counted from the start of this month: the part of this month already gone plus the runway. */
      const p = ctx.parseYmd(today), dim = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate();
      runsOut = ctx.addMonths(cur, Math.floor((p.getDate() - 1) / dim + runway));
    }
    const open = ctx.all('deals').filter(ctx.isOpen);
    const openArr = sum(open, d => num(d.value));
    const weighted = sum(open, d => num(d.value) * ctx.stageOf(d).p);
    const overdueInv = ctx.all('invoices').filter(i => ctx.invoiceStatus(i) === 'overdue')
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
    const overdueAmt = sum(overdueInv, i => ctx.invoiceTotal(i));
    const overdueTasks = ctx.tasks().filter(a => !a.done && a.dueAt && a.dueAt < today)
      .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
    const stale = open.map(d => ({ d, days: ctx.daysSince(lastTouch(d)) }))
      .filter(x => x.days != null && x.days >= STALE_DAYS).sort((a, b) => b.days - a.days);
    return { today, cur, F, subs, mrr, arr: mrr * 12, locations, target, cash, burn, runway, runsOut,
      open, openArr, weighted, overdueInv, overdueAmt, overdueTasks, stale };
  }

  /* ---------- KPI tiles ---------- */
  function kpiRow(c) {
    const T = ctx.planTarget();
    const tiles = [];
    tiles.push(ui.kpi({ label: 'MRR now', value: ctx.fmtMoney(c.mrr),
      sub: `${c.subs.length} active ${plural(c.subs.length, 'subscription')}` }));
    tiles.push(ui.kpi({ label: 'ARR', value: ctx.fmtMoney(c.arr),
      bar: T.arr > 0 ? ui.progress(c.arr / T.arr) : '',
      sub: T.arr > 0 ? `MRR × 12 · goal ${ctx.fmtCompact(T.arr)} by ${esc(T.label || ctx.fmtDate(T.end))}` : 'MRR × 12, setup fees excluded' }));
    const tg = c.target, goal = tg ? num(tg.locations) : 0;
    tiles.push(ui.kpi({ label: 'Paying locations', value: ctx.fmtNum(c.locations),
      bar: goal > 0 ? ui.progress(c.locations / goal) : '',
      sub: tg ? `goal ${ctx.fmtNum(goal)} by ${esc(lcFirst(tg.label) || ctx.fmtDate(tg.date))}` : 'no later location target in the plan' }));
    tiles.push(ui.kpi({ label: 'Cash on hand', value: money(c.cash), tone: c.cash < 0 ? 'bad' : '',
      sub: `as of today, from ${money(c.F.openingCash)} on ${esc(ctx.fmtDate(c.F.openingDate))}` }));
    const b = cents(c.burn.monthly); /* same rounding as the runway test in compute(), so the two tiles agree */
    tiles.push(b > 0
      ? ui.kpi({ label: 'Net burn / month', value: b < 1 ? ctx.fmtPrice(b) : ctx.fmtMoney(b), sub: esc(c.burn.basis) })
      : ui.kpi({ label: 'Net burn / month', value: 'Cash-flow positive', tone: b < 0 ? 'good' : '',
        sub: `${b < 0 ? ctx.fmtMoney(-b) + ' a month net in' : 'no net cash out'} · ${esc(c.burn.basis)}` }));
    if (!isFinite(c.runway)) {
      tiles.push(ui.kpi({ label: 'Runway', value: 'Not burning cash', tone: 'good', sub: 'cash in covers cash out' }));
    } else {
      const r = c.runway;
      tiles.push(ui.kpi({ label: 'Runway', value: `${r.toFixed(1)}<span class="kpi-unit"> ${r.toFixed(1) === '1.0' ? 'month' : 'months'}</span>`,
        tone: r < 6 ? 'bad' : r < 12 ? 'warn' : '',
        sub: r <= 0 ? 'cash on hand is used up' : c.runsOut ? `cash runs out around ${esc(longMonth(c.runsOut))}` : 'more than 100 years at this burn' }));
    }
    tiles.push(ui.kpi({ label: 'Open pipeline ARR', value: ctx.fmtMoney(c.openArr),
      sub: `${ctx.fmtMoney(c.weighted)} weighted · ${c.open.length} open ${plural(c.open.length, 'deal')}` }));
    const ni = c.overdueInv.length, nt = c.overdueTasks.length;
    tiles.push(ui.kpi({ label: 'Overdue', value: `${money(c.overdueAmt)}<span class="kpi-unit"> in ${ni} ${plural(ni, 'invoice')}</span>`,
      tone: ni || nt ? 'bad' : '',
      sub: `${nt} ${plural(nt, 'task')} overdue` }));
    return `<section class="kpis" aria-label="Company summary">${tiles.join('')}</section>`;
  }

  /* ---------- MRR chart: actual vs plan ---------- */
  function chartData(c) {
    const openYm = ctx.ymOf(c.F.openingDate), endYm = ctx.ymOf(ctx.planTarget().end) || c.cur;
    const from = openYm && openYm < c.cur ? openYm : c.cur;
    const to = endYm > c.cur ? endYm : c.cur;
    const months = ctx.monthRange(from, to);
    const model = {};
    ctx.planModel('base').forEach(r => { model[r.ym] = r; });
    /* Past months use the month's last day; this month uses today, so the last point equals "MRR now". */
    const actual = months.map(ym => (ym > c.cur ? null : ctx.mrrOn(ym === c.cur ? c.today : ctx.monthEnd(ym))));
    const planned = months.map(ym => (model[ym] ? model[ym].mrr : null));
    return { months, actual, planned, model };
  }
  function chartPanel(c, cd) {
    const P = ctx.plan();
    const chart = ctx.chart.line({
      labels: cd.months.map(ctx.monthLabel),
      series: [
        { name: 'Actual MRR', values: cd.actual, color: 'var(--viz-1)' },
        { name: 'Plan MRR (model, base case)', values: cd.planned, color: 'var(--viz-plan)', dashed: true }
      ],
      height: 240, format: ctx.fmtCompact,
      ariaLabel: `MRR by month from ${longMonth(cd.months[0])} to ${longMonth(cd.months[cd.months.length - 1])}, actual against the base-case plan`
    });
    const lastA = cd.actual.reduce((acc, v, i) => (v == null ? acc : i), -1);
    const planIdx = cd.planned.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0);
    const bits = [];
    if (lastA >= 0) bits.push(`Actual MRR is ${ctx.fmtMoney(cd.actual[lastA])} in ${esc(longMonth(cd.months[lastA]))}.`);
    if (planIdx.length) {
      const f = planIdx[0], l = planIdx[planIdx.length - 1];
      bits.push(`The plan model starts at ${ctx.fmtMoney(cd.planned[f])} in ${esc(longMonth(cd.months[f]))}` +
        (l !== f ? ` and reaches ${ctx.fmtMoney(cd.planned[l])} (${ctx.fmtNum(cd.model[cd.months[l]].locations, 1)} locations) in ${esc(longMonth(cd.months[l]))}.` : '.'));
    }
    const rows = cd.months.map((ym, i) => `<tr><td>${esc(longMonth(ym))}</td><td class="num">${cd.actual[i] == null ? '—' : ctx.fmtMoney(cd.actual[i])}</td><td class="num">${cd.planned[i] == null ? '—' : ctx.fmtMoney(cd.planned[i])}</td></tr>`).join('');
    const body = chart +
      `<p class="note">${bits.join(' ')}</p>` +
      `<p class="source">Plan line: the monthly plan model built from ${esc(P.source || 'the plan')}. Change its inputs on the Assumptions tab.</p>` +
      `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:13px">Monthly numbers</summary>` +
      `<div class="table-wrap flat" style="margin-top:8px"><table class="compact" style="min-width:0"><thead><tr><th>Month</th><th class="num">Actual MRR</th><th class="num">Plan MRR (model)</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    return `<div class="section">${ui.panel({ title: 'MRR by month', sub: 'Actual vs plan', body })}</div>`;
  }

  /* ---------- panels ---------- */
  function milestonesPanel(c) {
    const list = ctx.all('milestones').filter(m => !isDone(m))
      .sort((a, b) => (tDate(a) || '9999').localeCompare(tDate(b) || '9999') || num(a.order) - num(b.order)).slice(0, 3);
    const link = goBtn('milestones', 'All milestones');
    if (!list.length) {
      const any = ctx.all('milestones').length;
      return ui.panel({ title: 'Next milestones', actions: link,
        body: `<p class="note" style="margin:0">${any ? 'Every milestone is done. Add the next one on the Milestones tab.' : 'No milestones yet. Set dated goals, such as 25 paying locations, on the Milestones tab and the next three show here.'}</p>` });
    }
    const items = list.map((m, i) => {
      const st = STATUS_CHIP[m.status] || [String(m.status || 'Not started').replace(/-/g, ' ').replace(/^./, x => x.toUpperCase()), ''];
      const td = tDate(m), d = td ? daysBetween(c.today, td) : null;
      const late = d != null && d < 0;
      const when = !td ? 'No target date' : `Target ${esc(ctx.fmtDate(td))} · ${d === 0 ? 'today' : late ? `${-d} ${plural(-d, 'day')} past` : `in ${d} ${plural(d, 'day')}`}`;
      let prog = '';
      const tv = num(m.targetValue), now = metricNow(m.metric, c.today);
      if (now != null && tv > 0) {
        const frac = now / tv;
        prog = `<div class="muted" style="font-size:13px">${metricFmt(m.metric, now)} of ${metricFmt(m.metric, tv)} ${METRIC_LABEL[m.metric]} · ${ctx.fmtPct(Math.max(0, frac), 0)}</div>${ui.progress(frac, frac >= 1 ? 'good' : '')}`;
      }
      return `<div style="display:grid;gap:6px;padding:10px 0;${i ? 'border-top:1px solid var(--line)' : 'padding-top:0'}">
        <div style="display:flex;gap:8px;align-items:baseline;justify-content:space-between"><strong style="overflow-wrap:anywhere">${esc(m.title || 'Untitled milestone')}</strong><span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${late ? ui.chip('Past target', 'bad') : ''}${ui.chip(st[0], st[1])}</span></div>
        <div class="muted" style="font-size:13px">${when}</div>${prog}</div>`;
    }).join('');
    return ui.panel({ title: 'Next milestones', sub: 'by target date', actions: link, body: items });
  }

  function attentionPanel(c) {
    const items = [];
    const add = (tone, label, text, action) => items.push({ tone, label, text, action });
    if (isFinite(c.runway) && c.runway < 6) {
      add('bad', 'Runway', `${c.runway.toFixed(1)} months of cash left at ${ctx.fmtMoney(c.burn.monthly)} a month net burn${c.runway > 0 ? `; it runs out around ${esc(longMonth(c.runsOut))}` : ''}.`, goBtn('cash', 'Cash'));
    }
    c.overdueInv.slice(0, 4).forEach(inv => {
      const late = inv.dueDate ? daysBetween(inv.dueDate, c.today) : null;
      const who = coName(inv.companyId);
      add('bad', 'Invoice', `${esc(inv.number || 'Invoice')}${who ? ' · ' + esc(who) : ''}: ${money(ctx.invoiceTotal(inv))} was due ${esc(ctx.fmtDate(inv.dueDate))}${late ? ` (${late} ${plural(late, 'day')} late)` : ''}.`, goBtn('invoices', 'Invoices'));
    });
    if (c.overdueInv.length > 4) add('bad', 'Invoice', `${c.overdueInv.length - 4} more overdue ${plural(c.overdueInv.length - 4, 'invoice')}.`, goBtn('invoices', 'Invoices'));
    if (c.overdueTasks.length) {
      const n = c.overdueTasks.length;
      const names = c.overdueTasks.slice(0, 3).map(a => `${esc(a.subject || 'Untitled task')} (due ${esc(ctx.fmtDate(a.dueAt))})`).join(', ');
      add('bad', 'Tasks', `${n} overdue ${plural(n, 'task')}: ${names}${n > 3 ? `, and ${n - 3} more` : ''}.`, goBtn('tasks', 'Tasks'));
    }
    ctx.all('milestones').filter(m => !isDone(m) && tDate(m) && tDate(m) < c.today).forEach(m => {
      add('warn', 'Milestone', `${esc(m.title || 'Untitled milestone')} was due ${esc(ctx.fmtDate(m.targetDate))}.`, goBtn('milestones', 'Milestones'));
    });
    c.stale.slice(0, 4).forEach(x => {
      const who = coName(x.d.companyId);
      add('warn', 'Deal', `${esc(x.d.name || 'Untitled deal')}${who ? ' · ' + esc(who) : ''}: no activity for ${x.days} days.`,
        `<button class="btn btn-sm" type="button" data-act="mod" data-mod="${ID}" data-a="open-deal" data-id="${esc(x.d.id)}">Open</button>`);
    });
    if (c.stale.length > 4) add('warn', 'Deal', `${c.stale.length - 4} more open ${plural(c.stale.length - 4, 'deal')} with no activity for ${STALE_DAYS}+ days.`, goBtn('pipeline', 'Pipeline'));
    const li = (x, i) => `<li style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;${i ? 'border-top:1px solid var(--line)' : 'padding-top:0'}"><span style="min-width:0">${ui.chip(x.label, x.tone)} <span style="overflow-wrap:anywhere">${x.text}</span></span>${x.action || ''}</li>`;
    const body = items.length
      ? `<ul style="list-style:none;margin:0;padding:0">${items.map(li).join('')}</ul>`
      : `<p class="note" style="margin:0">Nothing needs attention. No overdue invoices or tasks, no open deal has gone ${STALE_DAYS} days without activity, and runway is ${isFinite(c.runway) ? c.runway.toFixed(1) + ' months' : 'not a concern while cash in covers cash out'}.</p>`;
    return ui.panel({ title: 'Needs attention', sub: items.length ? `${items.length} ${plural(items.length, 'item')}` : '', body });
  }

  function monthPanel(c, cd) {
    const row = ctx.cashByMonth(c.cur, c.cur)[0] || { cashIn: 0, cashOut: 0, net: 0 };
    const P = ctx.plan(), year = Number(c.cur.slice(0, 4)), years = ctx.planYears(), inPlan = years.indexOf(year) >= 0;
    const mrow = cd.model[c.cur];
    const ex = ctx.all('expenses').filter(x => ctx.ymOf(x.date) === c.cur);
    const cats = ctx.EXPENSE_CATEGORIES.map(k => ({
      label: k.label,
      spent: sum(ex.filter(x => x.category === k.id), x => num(x.amount)),
      /* Opex lines: the plan's annual budget / 12. Cost of service has no opex line: use the model's cost of service for the month. */
      budget: !inPlan ? 0 : k.id === 'cos' ? (mrow ? num(mrow.cos) : 0) : num(((P.opex || {})[k.id] || {})[year]) / 12
    }));
    const known = ctx.EXPENSE_CATEGORIES.map(k => k.id);
    const other = ex.filter(x => known.indexOf(x.category) < 0);
    if (other.length) cats.push({ label: 'Other', spent: sum(other, x => num(x.amount)), budget: 0 });
    const tSpent = sum(cats, x => x.spent), tBudget = sum(cats, x => x.budget);
    const left = x => (x.budget > 0 ? `<span class="${x.budget - x.spent < 0 ? 'neg' : ''}">${money(x.budget - x.spent)}</span>` : '—');
    const trs = cats.map(x => `<tr><td>${esc(x.label)}</td><td class="num">${money(x.spent)}</td><td class="num">${money(x.budget)}</td><td class="num">${left(x)}</td></tr>`).join('') +
      `<tr><td><strong>Total</strong></td><td class="num"><strong>${money(tSpent)}</strong></td><td class="num"><strong>${money(tBudget)}</strong></td><td class="num"><strong>${left({ spent: tSpent, budget: tBudget })}</strong></td></tr>`;
    const budgetNote = inPlan
      ? `Budget: the plan’s ${year} operating expenses ÷ 12; cost of service is the plan model’s ${ctx.fmtPct(num((P.costOfService || {})[year]), 0)} of revenue for the month.`
      : years.length
        ? (year < years[0]
          ? `The plan’s monthly budgets start in ${esc(longMonth(years[0] + '-01'))}, so ${esc(longMonth(c.cur))} has a $0 budget.`
          : `The plan’s monthly budgets end in ${esc(longMonth(years[years.length - 1] + '-12'))}, so ${esc(longMonth(c.cur))} has a $0 budget.`)
        : 'The plan has no budget years set.';
    /* Expenses dated before the cash opening date are in Spent but not in cash out (opening cash already reflects them). */
    const preOpen = ex.filter(x => String(x.date || '') < c.F.openingDate);
    const preNote = preOpen.length
      ? ` ${money(sum(preOpen, x => num(x.amount)))} of this month’s spending is dated before the cash opening date (${esc(ctx.fmtDate(c.F.openingDate))}), so it is in Spent but not in cash out.`
      : '';
    const net = cents(row.net);
    const body = `<dl class="stat-list">
        <div class="stat-row"><dt>Cash in</dt><dd>${money(row.cashIn)}</dd></div>
        <div class="stat-row"><dt>Cash out</dt><dd>${money(row.cashOut)}</dd></div>
        <div class="stat-row total"><dt>Net</dt><dd class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${money(net)}</dd></div>
      </dl>
      <div class="table-wrap flat" style="margin-top:14px"><table class="compact" style="min-width:0"><thead><tr><th>Expenses</th><th class="num">Spent</th><th class="num">Plan budget</th><th class="num">Left</th></tr></thead><tbody>${trs}</tbody></table></div>
      <p class="note">${ex.length ? '' : 'No expenses logged this month yet. '}Cash in counts invoices marked paid this month; cash out counts expenses dated this month.${preNote} ${budgetNote}</p>`;
    return ui.panel({ title: 'This month', sub: longMonth(c.cur), actions: goBtn('expenses', 'Expenses'), body });
  }

  function pipelinePanel(c) {
    const link = goBtn('pipeline', 'Open pipeline');
    if (!c.open.length) {
      return ui.panel({ title: 'Pipeline', actions: link,
        body: `<p class="note" style="margin:0">No open deals. Deals in Lead through Pilot show here by stage with their ARR and weighted ARR.</p>` });
    }
    const stageId = d => ctx.stageOf(d).id;
    const rows = OPEN_STAGES.map(s => {
      const ds = c.open.filter(d => stageId(d) === s.id);
      return { s, n: ds.length, locs: sum(ds, ctx.pricedLocs), arr: sum(ds, d => num(d.value)), w: sum(ds, d => num(d.value)) * s.p };
    });
    const tr = r => `<tr><td>${esc(r.s.name)} <span class="muted">${Math.round(r.s.p * 100)}%</span></td><td class="num">${r.n}</td><td class="num">${ctx.fmtNum(r.locs)}</td><td class="num">${ctx.fmtMoney(r.arr)}</td><td class="num">${ctx.fmtMoney(r.w)}</td></tr>`;
    const tot = `<tr><td><strong>Total</strong></td><td class="num"><strong>${c.open.length}</strong></td><td class="num"><strong>${ctx.fmtNum(sum(rows, r => r.locs))}</strong></td><td class="num"><strong>${ctx.fmtMoney(c.openArr)}</strong></td><td class="num"><strong>${ctx.fmtMoney(c.weighted)}</strong></td></tr>`;
    const unpriced = c.open.filter(d => !ctx.priced(d)).length;
    const body = `<div class="table-wrap flat"><table class="compact" style="min-width:0"><thead><tr><th>Stage</th><th class="num">Deals</th><th class="num">Locations</th><th class="num">ARR</th><th class="num">Weighted</th></tr></thead><tbody>${rows.map(tr).join('')}${tot}</tbody></table></div>
      <p class="note">Weighted = each deal’s ARR × its stage probability.${unpriced ? ` ${unpriced} ${plural(unpriced, 'deal has', 'deals have')} no location count and ${unpriced === 1 ? 'adds' : 'add'} 0 locations.` : ''}</p>`;
    return ui.panel({ title: 'Pipeline', sub: 'open ARR by stage', actions: link, body });
  }

  function gettingStarted() {
    const anything = ['deals', 'invoices', 'expenses', 'milestones'].some(k => ctx.all(k).length);
    if (anything || ctx.S.status !== 'ok') return '';
    const text = ctx.canWrite()
      ? 'Revenue, cash, runway and the pipeline fill in from your records. Add a deal on the Pipeline tab, log what you spend on Expenses, and record payments on Invoices.'
      : 'Revenue, cash, runway and the pipeline fill in once someone with edit access adds deals, expenses and invoices.';
    return `<div class="section">${ui.empty({ title: 'Your company overview fills in as you work', text,
      action: `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${goBtn('pipeline', 'Pipeline')}${goBtn('expenses', 'Expenses')}${goBtn('invoices', 'Invoices')}</div>` })}</div>`;
  }

  function todayLine() {
    const d = ctx.parseYmd(ctx.todayStr());
    return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  }

  return {
    id: ID,
    label: 'Overview',
    group: 'Company',
    order: 10,
    collections: ['invoices', 'expenses', 'milestones'],
    render() {
      const head = ui.toolbar({ title: 'Overview', count: todayLine(), exportable: !ctx.isLoading() });
      if (ctx.isLoading()) return head + '<div class="empty"><p>Loading your company overview…</p></div>';
      const c = compute(), cd = chartData(c);
      return head + kpiRow(c) + gettingStarted() + chartPanel(c, cd) +
        `<div class="grid grid-2 section">${milestonesPanel(c)}${attentionPanel(c)}${monthPanel(c, cd)}${pipelinePanel(c)}</div>`;
    },
    onAction(a, data) {
      if (a === 'open-deal' && data && data.id && ctx.deal(data.id)) ctx.openDrawer('deal', data.id);
    },
    csv() {
      const c = compute(), T = ctx.planTarget(), tg = c.target;
      const rows = [['Metric', 'Value']];
      rows.push(['As of', c.today]);
      rows.push(['MRR', cents(c.mrr)]);
      rows.push(['ARR', cents(c.arr)]);
      rows.push(['ARR goal (' + T.label + ')', num(T.arr)]);
      rows.push(['Paying locations', c.locations]);
      rows.push(['Next location goal', tg ? `${num(tg.locations)} by ${tg.label || tg.date} (${tg.date})` : 'none']);
      rows.push(['Cash on hand', cents(c.cash)]);
      rows.push(['Opening cash (' + c.F.openingDate + ')', cents(c.F.openingCash)]);
      rows.push(['Net burn per month', cents(c.burn.monthly)]);
      rows.push(['Net burn basis', c.burn.basis]);
      rows.push(['Runway (months)', isFinite(c.runway) ? Math.round(c.runway * 10) / 10 : 'Not burning cash']);
      rows.push(['Cash runs out (month)', c.runsOut || (isFinite(c.runway) ? 'More than 100 years' : 'Not burning cash')]);
      rows.push(['Open pipeline ARR', cents(c.openArr)]);
      rows.push(['Weighted pipeline ARR', cents(c.weighted)]);
      rows.push(['Open deals', c.open.length]);
      rows.push(['Overdue invoices', c.overdueInv.length]);
      rows.push(['Overdue invoice amount', cents(c.overdueAmt)]);
      rows.push(['Overdue tasks', c.overdueTasks.length]);
      rows.push([`Open deals with no activity for ${STALE_DAYS}+ days`, c.stale.length]);
      return { name: 'overview', rows };
    }
  };
});
