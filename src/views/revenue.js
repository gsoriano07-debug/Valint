(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Revenue: subscription MRR from won deals. A subscription starts on the deal's close date and stops
     counting on churnedAt (the same rule ctx.mrrOn uses), so every figure here matches the other tabs. */
  const ID = 'revenue';
  const esc = ctx.esc, money = ctx.fmtMoney, compact = ctx.fmtCompact;
  const plural = (n, one, many) => `${ctx.fmtNum(n, 1)} ${Math.abs(n - 1) < 1e-9 ? one : (many || one + 's')}`;
  const signed = n => (n > 0.004 ? '+' : n < -0.004 ? '−' : '') + money(Math.abs(n));
  const round2 = n => Math.round(ctx.num(n) * 100) / 100;
  /* "Nov 2026" for prose and labels: monthLabel's "Nov 26" reads like a day next to dates such as "Nov 22". */
  const monthLong = ym => { const d = ctx.parseYmd(String(ym || '') + '-01'); return d ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''; };

  /* ---------- data ---------- */
  const activeOn = (s, day) => s.start <= day && (!s.end || s.end > day);
  /* A churn date before the start date means the subscription never ran: core never counts it, neither do we. */
  const ran = s => !s.end || s.end >= s.start;
  const mrrAt = (list, day) => ctx.sum(list.filter(s => activeOn(s, day)), s => s.mrr);
  const locsAt = (list, day) => ctx.sum(list.filter(s => activeOn(s, day)), s => s.locations);

  function statusOf(s, t) {
    if (s.end && s.end <= t) return { rank: 3, text: 'Churned ' + ctx.fmtDate(s.end), tone: 'bad', csv: 'Churned' };
    if (s.start > t) return { rank: 2, text: 'Starts ' + ctx.fmtDate(s.start), tone: 'accent', csv: 'Starts later' };
    if (s.end) return { rank: 1, text: 'Ends ' + ctx.fmtDate(s.end), tone: 'warn', csv: 'Ending' };
    return { rank: 0, text: 'Active', tone: 'good', csv: 'Active' };
  }
  function sortedSubs(t) {
    return ctx.subscriptions().map(s => Object.assign({}, s, { st: statusOf(s, t) }))
      .sort((a, b) => (a.st.rank - b.st.rank) || (b.mrr - a.mrr) || String(a.name).localeCompare(String(b.name)));
  }
  const dealName = s => (s.deal && s.deal.name) || '';

  /* Months the chart covers: from the first subscription start (or the cash opening month) to December of the
     first plan year (or of this year, once the plan's first year has passed), capped to the last 24 months. */
  function monthWindow(subs, t) {
    const cur = ctx.ymOf(t);
    const years = ctx.planYears();
    const thisYear = Number(cur.slice(0, 4));
    const endYear = Math.max(thisYear, years.length ? years[0] : thisYear);
    const end = endYear + '-12';
    let start = cur;
    subs.forEach(s => { const m = ctx.ymOf(s.start); if (/^\d{4}-\d{2}$/.test(m) && m < start) start = m; });
    const open = ctx.ymOf(ctx.finance().openingDate);
    if (/^\d{4}-\d{2}$/.test(open) && open < start) start = open;
    let months = ctx.monthRange(start, end);
    if (months.length > 24) months = months.slice(-24);
    return { cur, end, months };
  }

  /* MRR movement: Ending = Starting + New − Churned, chained month to month. The current month runs to today,
     so its ending MRR equals the MRR tile. */
  function movement(subs, months, t) {
    const cur = ctx.ymOf(t);
    const list = subs.filter(ran);
    let shown = months.filter(m => m <= cur);
    if (!shown.length) shown = [cur];
    let starting = mrrAt(list, ctx.addDays(shown[0] + '-01', -1));
    return shown.map(m => {
      const periodEnd = m === cur ? t : ctx.monthEnd(m);
      const added = list.filter(s => ctx.ymOf(s.start) === m && s.start <= periodEnd);
      const lost = list.filter(s => s.end && ctx.ymOf(s.end) === m && s.end <= periodEnd);
      const newMrr = ctx.sum(added, s => s.mrr), churnMrr = ctx.sum(lost, s => s.mrr);
      const row = { ym: m, toDate: m === cur, periodEnd, starting, newMrr, newCount: added.length, churnMrr, churnCount: lost.length,
        ending: starting + newMrr - churnMrr, locations: locsAt(list, periodEnd) };
      starting = row.ending;
      return row;
    });
  }

  function planRows() { return ctx.planModel('base'); }
  function firstYearPath(model) {
    const years = ctx.planYears();
    const y = years.length ? years[0] : null;
    const rows = model.filter(r => r.year === y);
    if (!rows.length) return null;
    const P = ctx.plan();
    const targets = (P.targets || []).filter(x => String(x.date || '').slice(0, 4) === String(y));
    return { year: y, jan: rows[0], dec: rows[rows.length - 1], rows, targets, pilots: ctx.num(P.pilots) };
  }

  function invoicePayments(t) {
    const y = t.slice(0, 4);
    const paid = ctx.all('invoices').filter(i => ctx.invoiceStatus(i) === 'paid' && /^\d{4}-\d{2}-\d{2}$/.test(i.paidDate || '') && i.paidDate.slice(0, 4) === y && i.paidDate <= t);
    return { year: y, count: paid.length, total: ctx.sum(paid, i => ctx.invoiceTotal(i)) };
  }

  /* ---------- pieces ---------- */
  function chartBlock(months, rows, model, cur, t) {
    const byYm = {}; rows.forEach(r => { byYm[r.ym] = r; });
    const planBy = {}; model.forEach(r => { planBy[r.ym] = r; });
    const actual = months.map(m => (m <= cur && byYm[m] ? round2(byYm[m].ending) : null));
    const planned = months.map(m => (planBy[m] ? round2(planBy[m].mrr) : null));
    const hasPlan = planned.some(v => v != null);
    const series = [{ name: 'Actual MRR', values: actual, color: 'var(--viz-1)' }];
    if (hasPlan) series.push({ name: 'Plan MRR · Model, base case', values: planned, color: 'var(--viz-plan)', dashed: true });
    const chart = ctx.chart.line({
      labels: months.map(ctx.monthLabel), series, height: 240, format: compact,
      ariaLabel: `MRR by month, ${monthLong(months[0])} to ${monthLong(months[months.length - 1])}: actual through ${monthLong(cur)}${hasPlan ? ', plan from the model' : ''}`
    });
    const body = months.map(m => {
      const a = m <= cur && byYm[m] ? byYm[m] : null, p = planBy[m];
      return `<tr><td>${esc(ctx.monthLabel(m))}${a && a.toDate ? ' <span class="muted">to date</span>' : ''}</td>
        <td class="num">${a ? money(a.ending) : '<span class="muted">—</span>'}</td>
        <td class="num">${p ? money(p.mrr) : '<span class="muted">—</span>'}</td>
        <td class="num">${p ? ctx.fmtNum(p.locations, 1) : '<span class="muted">—</span>'}</td></tr>`;
    }).join('');
    const note = `<p class="note">Actual MRR is measured at each month end; ${esc(monthLong(cur))} is as of today, ${esc(ctx.fmtDate(t))}.${hasPlan ? ' The dashed line is the plan model (base case), which starts when the pilots convert to paid.' : ''}</p>`;
    const table = `<details style="margin-top:10px"><summary class="link" style="font-size:13px;font-weight:600">Show the numbers</summary>
      <div class="table-wrap flat" style="margin-top:8px"><table class="compact"><thead><tr><th>Month</th><th class="num">Actual MRR</th><th class="num">Plan MRR · Model</th><th class="num">Plan locations · Model</th></tr></thead><tbody>${body}</tbody></table></div></details>`;
    return chart + note + table;
  }

  function movementTable(rows) {
    const body = rows.map(r => `<tr>
      <td style="white-space:nowrap">${esc(ctx.monthLabel(r.ym))}${r.toDate ? ' <span class="muted">to date</span>' : ''}</td>
      <td class="num">${money(r.starting)}</td>
      <td class="num">${r.newCount ? `<span class="pos">+${money(r.newMrr)}</span> <span class="muted">(${r.newCount})</span>` : '<span class="muted">$0</span>'}</td>
      <td class="num">${r.churnCount ? `<span class="neg">−${money(r.churnMrr)}</span> <span class="muted">(${r.churnCount})</span>` : '<span class="muted">$0</span>'}</td>
      <td class="num"><strong>${money(r.ending)}</strong></td>
      <td class="num">${ctx.fmtNum(r.locations)}</td></tr>`).join('');
    const first = rows[0], last = rows[rows.length - 1];
    const totNew = ctx.sum(rows, r => r.newMrr), totChurn = ctx.sum(rows, r => r.churnMrr);
    const total = rows.length > 1 ? `<tr style="font-weight:600"><td>All ${rows.length} months</td><td class="num">${money(first.starting)}</td>
      <td class="num">+${money(totNew)}</td><td class="num">−${money(totChurn)}</td><td class="num">${money(last.ending)}</td><td class="num">${ctx.fmtNum(last.locations)}</td></tr>` : '';
    return `<div class="table-wrap flat"><table class="compact"><thead><tr><th>Month</th><th class="num">Starting MRR</th><th class="num">New</th><th class="num">Churned</th><th class="num">Ending MRR</th><th class="num">Locations</th></tr></thead><tbody>${body}${total}</tbody></table></div>
      <p class="note">Ending MRR = Starting + New − Churned. New counts subscriptions that started that month; Churned counts those whose churn date fell in it. Counts in brackets.</p>`;
  }

  function pathPanel(path, nowMrr, nowLocs, t, pre) {
    if (!path) return ctx.ui.panel({ title: 'Plan path', body: '<p class="note">The plan has no years set. Add them on the Assumptions tab.</p>' });
    const tg = ctx.planTarget();
    const rows = [
      `<div class="stat-row"><dt>Jan ${path.year} MRR · Model</dt><dd>${money(path.jan.mrr)}</dd></div>`,
      `<div class="stat-row"><dt>Jan ${path.year} locations · Model</dt><dd>${ctx.fmtNum(path.jan.locations, 1)}</dd></div>`,
      `<div class="stat-row"><dt>Dec ${path.year} MRR · Model</dt><dd>${money(path.dec.mrr)}</dd></div>`,
      `<div class="stat-row"><dt>Dec ${path.year} locations · Model</dt><dd>${ctx.fmtNum(path.dec.locations, 1)}</dd></div>`,
      `<div class="stat-row total"><dt>Dec ${path.year} ARR · Model</dt><dd>${money(path.dec.arr)}</dd></div>`
    ];
    path.targets.forEach(x => {
      const bits = [];
      if (x.locations) bits.push(plural(ctx.num(x.locations), 'location'));
      if (x.arr) bits.push(compact(x.arr) + ' ARR');
      if (bits.length) rows.push(`<div class="stat-row"><dt>${esc(x.label || ctx.fmtDate(x.date))} · Plan doc</dt><dd>${esc(bits.join(' · '))}</dd></div>`);
    });
    let lead;
    if (pre) {
      lead = `<p class="note" style="margin:0 0 12px">The plan starts in Jan ${path.year} with ${plural(path.pilots, 'pilot location')} converting to paid, then adds about ${ctx.fmtNum(path.jan.newLocations, 1)} new locations a month while ${ctx.fmtPct(ctx.num((ctx.plan().churn || {}).base), 1)} churn each month.</p>`;
    } else {
      const curYm = ctx.ymOf(t);
      const ref = path.rows.find(r => r.ym === curYm) || (curYm < path.jan.ym ? path.jan : null);
      const tgtYm = ctx.ymOf(tg.end);
      const left = tgtYm > curYm ? ctx.monthRange(ctx.addMonths(curYm, 1), tgtYm).length : 0;
      const need = Math.max(0, tg.locations - nowLocs);
      lead = (ref ? `<div style="margin-bottom:6px;font-size:14px">${money(nowMrr)} today vs ${money(ref.mrr)} planned for ${esc(monthLong(ref.ym))} · Model</div>${ctx.ui.progress(ref.mrr ? nowMrr / ref.mrr : 0, nowMrr >= ref.mrr ? 'good' : '')}` : '') +
        (left && need > 0 ? `<p class="note" style="margin:8px 0 12px">To reach ${plural(tg.locations, 'location')} by ${esc(tg.label)}, add about ${ctx.fmtNum(need / left, 1)} net new locations a month for the next ${left} months.</p>` : '<div style="height:12px"></div>');
    }
    return ctx.ui.panel({ title: `Plan path · ${path.year}`, sub: 'Model = month-by-month rebuild · Plan doc = the projections', body: lead + `<dl class="stat-list">${rows.join('')}</dl>` });
  }

  function subsTable(list, t, canWrite) {
    const shown = list.filter(s => ctx.matches(s.name, dealName(s)));
    const q = String(ctx.S.q || '').trim();
    const cols = canWrite ? 7 : 6;
    const body = shown.length ? shown.map(s => {
      const dn = dealName(s);
      const act = !canWrite ? '' : `<td><div class="row-actions">${s.end
        ? `<button class="btn btn-sm btn-ghost" type="button" data-act="mod" data-mod="${ID}" data-a="unchurn" data-id="${esc(s.id)}">Undo churn</button>`
        : `<button class="btn btn-sm" type="button" data-act="mod" data-mod="${ID}" data-a="churn" data-id="${esc(s.id)}">Mark churned</button>`}</div></td>`;
      return `<tr id="revenue-row-${esc(s.id)}">
        <td><button class="link cell-main" type="button" data-act="mod" data-mod="${ID}" data-a="open" data-id="${esc(s.id)}">${esc(s.name)}</button>${dn && dn !== s.name ? `<div class="cell-sub trunc">${esc(dn)}</div>` : ''}</td>
        <td class="num">${ctx.fmtNum(s.locations)}</td>
        <td class="num">${money(s.mrr)}</td>
        <td class="num">${money(s.arr)}</td>
        <td style="white-space:nowrap">${esc(ctx.fmtDate(s.start))}</td>
        <td>${ctx.ui.chip(s.st.text, s.st.tone)}</td>${act}</tr>`;
    }).join('') : `<tr><td colspan="${cols}" class="muted" style="text-align:center;padding:18px">No subscriptions match “${esc(q)}”.</td></tr>`;
    return `<div class="table-wrap flat"><table class="compact"><thead><tr><th>Customer</th><th class="num">Locations</th><th class="num">MRR</th><th class="num">ARR</th><th>Start</th><th>Status</th>${canWrite ? '<th><span class="muted" style="font-weight:400">Actions</span></th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  /* ---------- views ---------- */
  function renderEmpty(t) {
    const model = planRows(), path = firstYearPath(model);
    const pay = invoicePayments(t);
    let planChart = '';
    if (path) {
      planChart = ctx.ui.panel({
        title: `Plan MRR · ${path.year}`, sub: 'Model, base case',
        body: ctx.chart.line({ labels: path.rows.map(r => ctx.monthLabel(r.ym)), series: [{ name: 'Plan MRR · Model', values: path.rows.map(r => round2(r.mrr)), color: 'var(--viz-plan)', dashed: true }], height: 220, format: compact, ariaLabel: `Plan MRR for ${path.year}, from ${money(path.jan.mrr)} in January to ${money(path.dec.mrr)} in December` }) +
          `<p class="note">From ${money(path.jan.mrr)} MRR in Jan ${path.year} to ${money(path.dec.mrr)} in Dec ${path.year} (${compact(path.dec.arr)} ARR).</p>` +
          `<details style="margin-top:10px"><summary class="link" style="font-size:13px;font-weight:600">Show the numbers</summary><div class="table-wrap flat" style="margin-top:8px"><table class="compact"><thead><tr><th>Month</th><th class="num">Plan MRR · Model</th><th class="num">Plan locations · Model</th></tr></thead><tbody>${path.rows.map(r => `<tr><td>${esc(ctx.monthLabel(r.ym))}</td><td class="num">${money(r.mrr)}</td><td class="num">${ctx.fmtNum(r.locations, 1)}</td></tr>`).join('')}</tbody></table></div></details>`
      });
    }
    const payNote = `<p class="note">Invoice payments in ${esc(pay.year)} so far: ${money(pay.total)} from ${pay.count} paid invoice${pay.count === 1 ? '' : 's'}. Pilot and setup fees count there, not in MRR.</p>`;
    return ctx.ui.empty({
      title: 'No subscriptions yet',
      text: 'When you move a deal to Won in the Pipeline, it becomes a subscription here. Its MRR starts on the close date and counts until you mark it churned.',
      action: '<button class="btn btn-primary" type="button" data-act="go" data-view="pipeline">Go to Pipeline</button>'
    }) + `<div class="grid grid-2 section">${planChart}${pathPanel(path, 0, 0, t, true)}</div>` + payNote;
  }

  function renderFull(t) {
    const subs = sortedSubs(t);
    const canWrite = ctx.canWrite();
    const win = monthWindow(subs, t);
    const rows = movement(subs, win.months, t);
    const model = planRows();
    const path = firstYearPath(model);
    const active = subs.filter(s => activeOn(s, t));
    const mrr = ctx.mrrOn(t), arr = mrr * 12, locs = ctx.locationsOn(t);
    const since = ctx.addDays(t, -90);
    const churned90 = subs.filter(s => s.end && s.end >= since && s.end <= t && ran(s));
    const churnMrr = ctx.sum(churned90, s => s.mrr);
    const later = subs.filter(s => s.start > t && ran(s));
    const pay = invoicePayments(t);
    const thisMonth = rows[rows.length - 1];
    const tg = ctx.planTarget();
    const curPlan = model.find(r => r.ym === win.cur) || (model.length && win.cur < model[0].ym ? model[0] : null);

    const k1 = [
      ctx.ui.kpi({ label: 'MRR · today', value: money(mrr), sub: curPlan ? `Plan ${esc(monthLong(curPlan.ym))}: ${money(curPlan.mrr)} · Model` : `${plural(locs, 'location')} paying` }),
      ctx.ui.kpi({ label: 'ARR', value: money(arr), bar: tg.arr ? `<div style="margin:9px 0 2px">${ctx.ui.progress(arr / tg.arr, arr >= tg.arr ? 'good' : '')}</div>` : '', sub: tg.arr ? `${ctx.fmtPct(arr / tg.arr, 1)} of the ${compact(tg.arr)} goal for ${esc(tg.label)}` : 'MRR × 12' }),
      ctx.ui.kpi({ label: 'Active customers', value: `${active.length}`, sub: `${plural(locs, 'location')} active today` }),
      ctx.ui.kpi({ label: 'ARPA', value: active.length ? money(mrr / active.length) : '—', sub: active.length ? 'MRR per active customer' : 'No active customers yet' })
    ].join('');
    const k2 = [
      ctx.ui.kpi({ label: 'Churned MRR · 90 days', value: money(churnMrr), tone: churnMrr > 0 ? 'bad' : '', sub: churned90.length ? `${churned90.length} customer${churned90.length === 1 ? '' : 's'}, ${plural(ctx.sum(churned90, s => s.locations), 'location')} since ${esc(ctx.fmtDate(since))}` : `None since ${esc(ctx.fmtDate(since))}` }),
      ctx.ui.kpi({ label: `Net new MRR · ${monthLong(win.cur)}`, value: signed(thisMonth.newMrr - thisMonth.churnMrr), tone: thisMonth.newMrr - thisMonth.churnMrr < -0.004 ? 'bad' : thisMonth.newMrr - thisMonth.churnMrr > 0.004 ? 'good' : '', sub: `+${money(thisMonth.newMrr)} new · −${money(thisMonth.churnMrr)} churned, to date` }),
      ctx.ui.kpi({ label: 'Starts later', value: money(ctx.sum(later, s => s.mrr)), sub: later.length ? `${later.length} won deal${later.length === 1 ? '' : 's'} with a future start date` : 'No won deals start after today' }),
      ctx.ui.kpi({ label: `Invoice payments · ${pay.year}`, value: money(pay.total), sub: `${pay.count} paid invoice${pay.count === 1 ? '' : 's'}; setup, pilot and subscription lines all count` })
    ].join('');

    const chartPanel = ctx.ui.panel({ title: 'MRR by month', sub: `${monthLong(win.months[0])} – ${monthLong(win.months[win.months.length - 1])}`, body: chartBlock(win.months, rows, model, win.cur, t) });
    const movePanel = ctx.ui.panel({ title: 'MRR movement', sub: 'By month, through today', body: movementTable(rows) });
    const subsPanel = ctx.ui.panel({
      title: 'Subscriptions', sub: `${active.length} active · ${subs.length} total · from won deals`,
      actions: '<button class="btn btn-sm btn-ghost" type="button" data-act="go" data-view="pipeline">Open Pipeline</button>',
      body: subsTable(subs, t, canWrite) + (canWrite ? '<p class="note">Mark a customer churned on the day they stop paying; their MRR stops counting from that date. Undo it if they come back on the same terms.</p>' : '')
    });

    return `<section class="kpis" aria-label="Revenue summary">${k1}</section><section class="kpis" aria-label="Revenue changes">${k2}</section>
      <div class="section">${chartPanel}</div>
      <div class="grid grid-2 section">${movePanel}${pathPanel(path, mrr, locs, t, false)}</div>
      <div class="section" id="revenue-subscriptions">${subsPanel}</div>`;
  }

  /* ---------- actions ---------- */
  function subById(id) { return ctx.subscriptions().find(s => s.id === id) || null; }
  function markChurned(s) {
    const t = ctx.todayStr();
    const def = s.start > t ? s.start : t;
    ctx.openFormModal({
      title: `Mark ${s.name} churned`,
      body: ctx.F.date('revenue-churn-date', 'Churn date', def) +
        `<p class="note">From this date ${esc(s.name)} stops counting toward MRR: ${money(s.mrr)} MRR, ${money(s.arr)} ARR, ${plural(s.locations, 'location')}. It can’t be before the start date, ${esc(ctx.fmtDate(s.start))}.</p>`,
      submitLabel: 'Mark churned',
      onSubmit: async () => {
        const v = ctx.val('revenue-churn-date');
        if (!ctx.parseYmd(v)) return ctx.formErr('Enter the churn date.', 'revenue-churn-date');
        if (v < s.start) return ctx.formErr(`The churn date can’t be before the start date, ${ctx.fmtDate(s.start)}.`, 'revenue-churn-date');
        const ok = await ctx.patch('deals', s.id, { churnedAt: v, updatedAt: ctx.iso() });
        if (ok) ctx.toast(`${s.name} marked churned on ${ctx.fmtDate(v)}`);
        return ok;
      }
    });
  }
  function undoChurn(s) {
    const t = ctx.todayStr();
    ctx.openConfirm(`Undo churn for ${s.name}?`,
      s.end > t
        ? `This removes the churn date of ${ctx.fmtDate(s.end)}, so ${s.name}’s ${money(s.mrr)} MRR keeps counting after it.`
        : `${s.name} becomes an active subscription again, and its ${money(s.mrr)} MRR counts from ${ctx.fmtDate(s.start)} onward.`,
      'Undo churn',
      async () => { if (await ctx.patch('deals', s.id, { churnedAt: null, updatedAt: ctx.iso() })) ctx.toast(`Churn undone for ${s.name}`); });
  }

  return {
    id: ID,
    label: 'Revenue',
    group: 'Finance',
    order: 10,
    collections: ['invoices'],
    render() {
      const loading = ctx.isLoading();
      const t = ctx.todayStr();
      const count = loading ? null : ctx.subscriptions().length;
      const head = ctx.ui.toolbar({ title: 'Revenue', count: count == null ? null : `${count} subscription${count === 1 ? '' : 's'}`, exportable: !loading });
      if (loading) return head + '<div class="empty"><p>Loading revenue…</p></div>';
      if (!count) return head + renderEmpty(t);
      return head + renderFull(t);
    },
    onAction(a, data) {
      if (a === 'open') { if (data.id) ctx.openDrawer('deal', data.id); return; }
      if (!ctx.canWrite()) { ctx.toast('You can view this CRM but not change it.', 'bad'); return; }
      const s = subById(data.id);
      if (!s) { ctx.toast('That subscription is no longer here.', 'bad'); return; }
      if (a === 'churn') markChurned(s);
      else if (a === 'unchurn') undoChurn(s);
    },
    csv() {
      const t = ctx.todayStr();
      const rows = [['Customer', 'Deal', 'Locations', 'MRR', 'ARR', 'Start', 'Churn date', 'Status']];
      sortedSubs(t).forEach(s => rows.push([s.name || '', dealName(s), s.locations, round2(s.mrr), round2(s.arr), s.start || '', s.end || '', s.st.csv]));
      return { name: 'subscriptions', rows };
    }
  };
});
