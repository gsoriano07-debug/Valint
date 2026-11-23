(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Forecast: the 3-year plan model by scenario, model vs plan doc, and plan targets vs actuals.
     Every plan number comes from ctx.plan() / ctx.planModel(); actuals come from signed subscriptions. */
  const SCEN = [['conservative', 'Conservative'], ['base', 'Base'], ['upside', 'Upside']];
  const SCEN_COLOR = { conservative: 'var(--viz-2)', base: 'var(--viz-1)', upside: 'var(--viz-3)' };
  let scenario = 'base';
  let showMonths = false;

  const scenLabel = s => (SCEN.find(x => x[0] === s) || [s, s])[1];
  const numOrNull = v => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
  const money = v => (v == null ? '—' : ctx.fmtMoney(v));
  /* Two decimals in millions so $1.85M (model) and $1.88M (plan doc) stay distinguishable. */
  const compact = v => (v == null ? '—' : Math.abs(v) >= 1e6 ? `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}M` : ctx.fmtCompact(v));
  const locs = (v, d) => (v == null ? '—' : ctx.fmtNum(v, d || 0));
  const plural = (n, word) => `${word}${Math.round(n) === 1 ? '' : 's'}`;
  const tone = v => (v < 0 ? ' neg' : '');
  const monthLong = ym => { const [y, m] = String(ym).split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
  const pctDiff = (model, doc) => (model == null || doc == null || !doc ? null : (model - doc) / Math.abs(doc));
  function signedPct(x) {
    if (x == null) return '—';
    const r = Math.round(Math.abs(x) * 1000) / 1000;
    if (!r) return '0%';
    return (x > 0 ? '+' : '−') + ctx.fmtPct(r);
  }

  /* Plan doc figures for a scenario's year end: base uses the dated targets; 2029 also has a figure per scenario. */
  function docFor(scen, year) {
    const P = ctx.plan(), out = {};
    const keys = ['locations', 'arr', 'revenue', 'opIncome'];
    if (scen === 'base') {
      const t = (Array.isArray(P.targets) ? P.targets : []).find(x => x && String(x.date || '').slice(0, 7) === `${year}-12`);
      if (t) keys.forEach(k => { const v = numOrNull(t[k]); if (v != null) out[k] = v; });
    }
    if (year === 2029) {
      const s = (P.scenarios2029 || {})[scen];
      if (s) keys.forEach(k => { const v = numOrNull(s[k]); if (v != null && out[k] == null) out[k] = v; });
    }
    return Object.keys(out).length ? out : null;
  }

  function targets() {
    const P = ctx.plan();
    return (Array.isArray(P.targets) ? P.targets : [])
      .filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || '')))
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  const live = () => ctx.S.status === 'ok';
  function actualOn(day) { return { locations: ctx.locationsOn(day), arr: ctx.mrrOn(day) * 12 }; }

  function segHtml() {
    return `<div class="seg" role="group" aria-label="Scenario">${SCEN.map(([id, l]) =>
      `<button type="button" data-act="mod" data-mod="forecast" data-a="scenario" data-v="${id}" aria-pressed="${scenario === id}">${l}</button>`).join('')}</div>`;
  }
  function assumptionsBtn(primary) {
    return `<button class="btn btn-sm${primary ? ' btn-primary' : ''}" type="button" data-act="go" data-view="assumptions">${ctx.canWrite() ? 'Edit assumptions' : 'View assumptions'}</button>`;
  }

  /* ---------- sections ---------- */
  function kpisHtml(summary) {
    const tiles = summary.map(y => {
      const d = docFor(scenario, y.year);
      const docParts = d ? [d.locations != null ? `${locs(d.locations)} ${plural(d.locations, 'location')}` : '', d.arr != null ? `${compact(d.arr)} ARR` : ''].filter(Boolean) : [];
      return ctx.ui.kpi({
        label: `Dec ${y.year} · ${scenLabel(scenario)} model`,
        value: `${compact(y.endArr)} <span class="kpi-unit">ARR</span>`,
        sub: `${locs(y.endLocations)} ${plural(y.endLocations, 'location')}${docParts.length ? `<br>Plan doc: ${docParts.join(' · ')}` : `<br>No plan doc figure for Dec ${y.year}`}`
      });
    });
    const today = ctx.todayStr();
    /* Same past/future split as the Plan vs actual table: a target dated today is already judged there. */
    const next = targets().find(t => t.date > today && numOrNull(t.locations) != null);
    let nowTile;
    if (live()) {
      const a = actualOn(today);
      const nl = next ? numOrNull(next.locations) : null;
      const nextTxt = next && nl != null ? `<br>Next target: ${locs(nl)} by ${ctx.esc(ctx.fmtDate(next.date))} (${locs(Math.max(0, nl - a.locations))} to go)` : '';
      nowTile = ctx.ui.kpi({ label: 'Today · actual', value: `${ctx.fmtMoney(a.arr)} <span class="kpi-unit">ARR</span>`, sub: `${locs(a.locations)} active ${plural(a.locations, 'location')}${nextTxt}` });
    } else {
      nowTile = ctx.ui.kpi({ label: 'Today · actual', value: '—', sub: 'Actuals appear when your records load.' });
    }
    return `<section class="kpis" id="forecast-kpis" aria-label="${ctx.esc(scenLabel(scenario))} scenario at each year end">${tiles.join('')}${nowTile}</section>`;
  }

  function assumptionsHtml(years) {
    const P = ctx.plan();
    const mRaw = (P.newMultiplier || {})[scenario];
    const mult = mRaw == null ? 1 : ctx.num(mRaw);
    const churn = ctx.num((P.churn || {})[scenario]);
    const prices = years.map(y => `${ctx.fmtMoney(ctx.num(P.prices[y]))} in ${y}`).join(', ');
    const ranges = years.map(y => { const r = (P.newPerMonth || {})[y] || [0, 0]; return `${ctx.fmtNum(ctx.num(r[0]), 1)}–${ctx.fmtNum(ctx.num(r[1]), 1)} in ${y}`; }).join(', ');
    const avgs = years.map(y => { const r = (P.newPerMonth || {})[y] || [0, 0]; return ctx.fmtNum((ctx.num(r[0]) + ctx.num(r[1])) / 2 * mult, 1); }).join(' / ');
    const multTxt = mult === 1 ? `the model adds the midpoint (${avgs} a month)` : `this scenario adds ${ctx.fmtNum(mult, 2)}× the midpoint (${avgs} a month)`;
    const body = `<p class="note" style="margin:0">Price ${prices} per location per month · ${ranges} new locations a month; ${multTxt} · ${ctx.fmtPct(churn)} monthly churn · starts from ${ctx.fmtNum(ctx.num(P.pilots))} pilot ${plural(ctx.num(P.pilots), 'location')} converting in Jan ${years[0]}.</p>`;
    return `<div class="section" id="forecast-assumptions">${ctx.ui.panel({ title: `${scenLabel(scenario)} assumptions`, actions: assumptionsBtn(false), body })}</div>`;
  }

  function locationsChartHtml(years) {
    const models = {};
    SCEN.forEach(([id]) => { models[id] = ctx.planModel(id); });
    const base = models[scenario] || models.base;
    const labels = base.map(r => ctx.monthLabel(r.ym));
    const chart = ctx.chart.line({
      labels,
      series: SCEN.map(([id, l]) => ({ name: l, values: models[id].map(r => r.locations), color: SCEN_COLOR[id] })),
      height: 240,
      format: v => ctx.fmtNum(v),
      ariaLabel: `End-of-month locations for the conservative, base and upside scenarios, ${labels[0]} to ${labels[labels.length - 1]}`
    });
    /* Same numbers as the chart at each half-year checkpoint. */
    const checkpoints = [];
    years.forEach(y => { [6, 12].forEach(m => { const ym = `${y}-${ctx.pad(m)}`; if (base.some(r => r.ym === ym)) checkpoints.push(ym); }); });
    const lastYear = years[years.length - 1];
    const hasDoc = SCEN.some(([id]) => { const d = docFor(id, lastYear); return d && d.locations != null; });
    const head = `<tr><th>Scenario</th>${checkpoints.map(ym => `<th class="num">${ctx.esc(ctx.monthLabel(ym))}</th>`).join('')}${hasDoc ? `<th class="num">Plan doc Dec ${lastYear}</th>` : ''}</tr>`;
    const rows = SCEN.map(([id, l]) => {
      const m = models[id];
      const cells = checkpoints.map(ym => { const r = m.find(x => x.ym === ym); return `<td class="num">${locs(r ? r.locations : null)}</td>`; }).join('');
      let docCell = '';
      if (hasDoc) {
        const d = docFor(id, lastYear), endRow = m[m.length - 1];
        docCell = d && d.locations != null
          ? `<td class="num">${locs(d.locations)}<div class="cell-sub">Model ${signedPct(pctDiff(endRow ? endRow.locations : null, d.locations))}</div></td>`
          : '<td class="num">—</td>';
      }
      const sel = id === scenario;
      return `<tr><td><span class="${sel ? 'cell-main' : ''}">${l}</span>${sel ? ' <span class="cell-sub">selected</span>' : ''}</td>${cells}${docCell}</tr>`;
    }).join('');
    const table = `<div class="table-wrap flat" style="margin-top:12px"><table class="compact"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
    return `<div class="section" id="forecast-locations">${ctx.ui.panel({ title: 'Locations by scenario', sub: 'Model, end of each month', body: chart + table })}</div>`;
  }

  function arrChartHtml(model, summary) {
    const today = ctx.todayStr(), curYm = ctx.ymOf(today);
    const first = model[0].ym, lastYm = model[model.length - 1].ym;
    const subs = live() ? ctx.subscriptions() : [];
    /* Start the axis early enough to show actual history before the model's first month (at most 12 months back). */
    let start = first;
    const earliest = subs.map(s => ctx.ymOf(s.start)).filter(ym => /^\d{4}-\d{2}$/.test(ym)).sort()[0];
    [curYm, earliest].forEach(ym => { if (ym && ym < start) start = ym; });
    const floor = ctx.addMonths(first, -12);
    if (start < floor) start = floor;
    const months = ctx.monthRange(start, lastYm);
    const byYm = {};
    model.forEach(r => { byYm[r.ym] = r; });
    const actual = months.map(ym => {
      if (!live() || ym > curYm) return null;
      const day = ym === curYm ? today : ctx.monthEnd(ym);
      return ctx.mrrOn(day) * 12;
    });
    const name = `${scenLabel(scenario)} model ARR`;
    const chart = ctx.chart.line({
      labels: months.map(ctx.monthLabel),
      series: [
        { name: 'Actual ARR', values: actual, color: 'var(--viz-1)' },
        { name, values: months.map(ym => (byYm[ym] ? byYm[ym].arr : null)), color: 'var(--viz-plan)', dashed: true }
      ],
      height: 240,
      ariaLabel: `Actual ARR against the ${scenLabel(scenario).toLowerCase()} model ARR, ${ctx.monthLabel(start)} to ${ctx.monthLabel(lastYm)}`
    });
    let nowTxt;
    if (live()) {
      const a = actualOn(today);
      nowTxt = `Actual ARR today: ${ctx.fmtMoney(a.arr)} from ${locs(a.locations)} active ${plural(a.locations, 'location')}.`;
    } else {
      nowTxt = 'Actual ARR appears when your records load.';
    }
    const modelTxt = `${scenLabel(scenario)} model ARR: ${summary.map(y => `${compact(y.endArr)} at Dec ${y.year}`).join(', ')}.`;
    const body = chart + `<p class="note">${nowTxt} ${modelTxt} Actual counts won deals active at each month end (today for this month); the model starts in ${ctx.esc(monthLong(first))}.</p>`;
    return `<div class="section" id="forecast-arr">${ctx.ui.panel({ title: 'ARR: model vs actual', sub: `${scenLabel(scenario)} scenario`, body })}</div>`;
  }

  function plHtml(model, summary) {
    const opexKeys = summary.length ? Object.keys(summary[0].opex) : [];
    const docs = summary.map(y => docFor(scenario, y.year));
    const th = summary.map(y => `<th class="num">${y.year}</th>`).join('');
    const row = (label, fn, cls) => `<tr><td${cls ? ` class="${cls}"` : ''}>${label}</td>${summary.map(y => { const v = fn(y); return `<td class="num${cls ? ' ' + cls : ''}${typeof v === 'number' ? tone(v) : ''}">${typeof v === 'number' ? ctx.fmtMoney(v) : v}</td>`; }).join('')}</tr>`;
    let rows = '';
    rows += row('Revenue', y => y.revenue, 'cell-main');
    rows += row('Cost of service', y => y.cos);
    rows += row('Gross profit', y => y.grossProfit, 'cell-main');
    rows += row('Gross margin', y => ctx.fmtPct(y.grossMargin));
    opexKeys.forEach(k => { rows += row(`<span class="muted">${ctx.esc(ctx.OPEX_LABELS[k] || k)}</span>`, y => ctx.num(y.opex[k])); });
    rows += row('Total operating expenses', y => y.opexTotal);
    rows += row('Operating income', y => y.opIncome, 'cell-main');
    rows += row('Operating margin', y => `<span class="${y.opMargin < 0 ? 'neg' : ''}">${ctx.fmtPct(y.opMargin)}</span>`);
    rows += row('End locations', y => locs(y.endLocations));
    rows += row('End ARR', y => ctx.fmtMoney(y.endArr), 'cell-main');

    const checks = [['revenue', 'Revenue', 'revenue', 'money'], ['opIncome', 'Operating income', 'opIncome', 'money'], ['locations', 'End locations', 'endLocations', 'locs'], ['arr', 'End ARR', 'endArr', 'money']];
    const anyDoc = docs.some(Boolean);
    let note = '';
    if (anyDoc) {
      rows += `<tr><th colspan="${summary.length + 1}" style="padding-top:16px">Plan doc check</th></tr>`;
      let maxClose = null, maxOp = null;
      checks.forEach(([dk, label, mk, kind]) => {
        if (!docs.some(d => d && d[dk] != null)) return;
        rows += `<tr><td>${label} · plan doc</td>${summary.map((y, i) => {
          const d = docs[i];
          if (!d || d[dk] == null) return '<td class="num">—</td>';
          const diff = pctDiff(y[mk], d[dk]);
          if (diff != null) {
            if (dk === 'opIncome') maxOp = Math.max(maxOp || 0, Math.abs(diff));
            else maxClose = Math.max(maxClose || 0, Math.abs(diff));
          }
          return `<td class="num${tone(d[dk])}">${kind === 'locs' ? locs(d[dk]) : ctx.fmtMoney(d[dk])}<div class="cell-sub">Model ${signedPct(diff)}</div></td>`;
        }).join('')}</tr>`;
      });
      if (maxClose != null || maxOp != null) {
        const closeTxt = maxClose != null ? ` and lands within ${ctx.fmtPct(maxClose)} of its revenue, end locations and end ARR` : '';
        const opTxt = maxOp != null && (maxClose == null || maxOp > maxClose)
          ? `${closeTxt ? ';' : ' and'} operating income moves more (up to ${ctx.fmtPct(maxOp)}) because it is the small amount left after costs`
          : '';
        /* Past 10% the assumptions no longer match the doc's, so say that instead of "lands within". */
        note = maxClose != null && maxClose > 0.1
          ? `<p class="note">With the current assumptions the model ends up to ${ctx.fmtPct(maxClose)} away from the plan doc’s revenue, end locations and end ARR${maxOp != null && maxOp > maxClose ? `, and up to ${ctx.fmtPct(maxOp)} away on operating income` : ''}.</p>`
          : `<p class="note">The model rebuilds the plan doc month by month${closeTxt}${opTxt}.</p>`;
      }
    } else {
      note = `<p class="note">The plan doc has no year-end figures for the ${scenLabel(scenario).toLowerCase()} scenario, so there is nothing to compare against here.</p>`;
    }
    const table = `<div class="table-wrap flat"><table class="compact"><thead><tr><th>${scenLabel(scenario)} model</th>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const toggle = `<button class="btn btn-sm btn-ghost" type="button" data-act="mod" data-mod="forecast" data-a="months" aria-expanded="${showMonths}"${showMonths ? ' aria-controls="forecast-months"' : ''}>${showMonths ? 'Hide months' : `Show all ${model.length} months`}</button>`;
    let monthly = '';
    if (showMonths) {
      const mrows = model.map(r => `<tr><td>${ctx.esc(ctx.monthLabel(r.ym))}</td><td class="num">${locs(r.startLocations, 1)}</td><td class="num">${locs(r.newLocations, 1)}</td><td class="num">${locs(r.churned, 1)}</td><td class="num">${locs(r.locations, 1)}</td><td class="num">${ctx.fmtMoney(r.price)}</td><td class="num">${ctx.fmtMoney(r.mrr)}</td><td class="num">${ctx.fmtMoney(r.revenue)}</td><td class="num">${ctx.fmtMoney(r.cos)}</td><td class="num">${ctx.fmtMoney(r.opexTotal)}</td><td class="num${tone(r.opIncome)}">${ctx.fmtMoney(r.opIncome)}</td></tr>`).join('');
      monthly = `<div class="table-wrap flat" id="forecast-months" style="margin-top:12px"><table class="compact"><thead><tr><th>Month</th><th class="num">Start</th><th class="num">New</th><th class="num">Churned</th><th class="num">End locations</th><th class="num">Price</th><th class="num">MRR</th><th class="num">Revenue</th><th class="num">Cost of service</th><th class="num">Opex</th><th class="num">Operating income</th></tr></thead><tbody>${mrows}</tbody></table></div>`;
    }
    return `<div class="section" id="forecast-pl">${ctx.ui.panel({ title: 'Annual P&L', sub: `${scenLabel(scenario)} model by plan year`, actions: toggle, body: table + note + monthly })}</div>`;
  }

  function planVsActualHtml(model) {
    const ts = targets(), today = ctx.todayStr();
    if (!ts.length) {
      const body = ctx.ui.empty({ title: 'No plan targets yet', text: 'Dated targets from the plan show here next to your actual locations and ARR. Add them on the Assumptions tab.', action: assumptionsBtn(true) });
      return `<div class="section" id="forecast-pva">${ctx.ui.panel({ title: 'Plan vs actual', body })}</div>`;
    }
    const ok = live();
    const nowA = ok ? actualOn(today) : null;
    const byYm = {};
    model.forEach(r => { byYm[r.ym] = r; });
    const rows = ts.map(t => {
      const tl = numOrNull(t.locations), ta = numOrNull(t.arr);
      const past = t.date <= today;
      const a = ok ? (past ? actualOn(t.date) : nowA) : null;
      const m = byYm[ctx.ymOf(t.date)];
      let chip;
      if (!past) chip = ctx.ui.chip('Not yet');
      else if (!a || (tl == null && ta == null)) chip = '—';
      else {
        const hit = (tl == null || a.locations >= tl) && (ta == null || a.arr >= ta);
        chip = ctx.ui.chip(hit ? 'Hit' : 'Missed', hit ? 'good' : 'bad');
      }
      const soFar = past ? '' : '<div class="cell-sub">so far</div>';
      const frac = a ? (tl ? a.locations / tl : ta ? a.arr / ta : null) : null;
      const progTone = past && a ? ((tl == null || a.locations >= tl) && (ta == null || a.arr >= ta) ? 'good' : 'bad') : '';
      const prog = frac == null ? '—' : `${ctx.ui.progress(frac, progTone)}<div class="cell-sub">${ctx.fmtPct(frac, frac < 0.1 ? 1 : 0)} of the ${tl ? 'location' : 'ARR'} target</div>`;
      return `<tr>
        <td><div class="cell-main">${ctx.esc(t.label || 'Target')}</div><div class="cell-sub">${ctx.esc(ctx.fmtDate(t.date))}</div></td>
        <td class="num">${locs(tl)}</td>
        <td class="num">${money(ta)}</td>
        <td class="num">${m ? `${locs(m.locations)}<div class="cell-sub">${compact(m.arr)} ARR</div>` : '—'}</td>
        <td class="num">${a ? locs(a.locations) + soFar : '—'}</td>
        <td class="num">${a ? ctx.fmtMoney(a.arr) + soFar : '—'}</td>
        <td style="min-width:140px">${prog}</td>
        <td>${chip}</td></tr>`;
    }).join('');
    const table = `<div class="table-wrap flat"><table class="compact"><thead><tr><th>Target</th><th class="num">Target locations</th><th class="num">Target ARR</th><th class="num">${scenLabel(scenario)} model</th><th class="num">Actual locations</th><th class="num">Actual ARR</th><th>Progress</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    let note;
    if (!ok) note = '<p class="note">Actual locations and ARR appear when your records load.</p>';
    else if (!ctx.subscriptions().length) note = `<p class="note">No signed customers yet. Actuals start counting when you mark a deal Won on the Pipeline. <button class="btn btn-sm" type="button" data-act="go" data-view="pipeline">Open Pipeline</button></p>`;
    else note = '<p class="note">Past targets use the locations and ARR active on that date. Future targets show your current actuals so far. Targets are the plan doc’s base case.</p>';
    return `<div class="section" id="forecast-pva">${ctx.ui.panel({ title: 'Plan vs actual', sub: 'Plan doc targets against signed subscriptions', body: table + note })}</div>`;
  }

  return {
    id: 'forecast',
    label: 'Forecast',
    group: 'Planning',
    order: 10,
    collections: [],
    render() {
      const years = ctx.planYears();
      const loading = ctx.isLoading();
      const range = years.length ? `${years[0]}–${years[years.length - 1]}` : null;
      const tb = ctx.ui.toolbar({ title: 'Forecast', count: loading ? null : range, filters: segHtml(), exportable: true });
      if (loading) return tb + ctx.ui.empty({ text: 'Loading the plan and your actuals…' });
      const model = ctx.planModel(scenario);
      if (!model.length) {
        return tb + ctx.ui.empty({ title: 'No plan years to model', text: 'The forecast needs a price for at least one plan year. Set prices, new locations per month and churn on the Assumptions tab, and the 3-year model appears here.', action: assumptionsBtn(true) });
      }
      const summary = ctx.planYearSummary(model);
      return tb
        + kpisHtml(summary)
        + assumptionsHtml(years)
        + locationsChartHtml(years)
        + arrChartHtml(model, summary)
        + plHtml(model, summary)
        + planVsActualHtml(model);
    },
    onAction(a, data) {
      if (a === 'scenario') {
        const v = data && data.v;
        if (SCEN.some(s => s[0] === v) && v !== scenario) { scenario = v; ctx.render(); }
      } else if (a === 'months') {
        showMonths = !showMonths;
        ctx.render();
      }
    },
    csv() {
      const model = ctx.planModel(scenario);
      const r2 = v => Math.round(ctx.num(v) * 100) / 100;
      return {
        name: `forecast-${scenario}`,
        rows: [['Month', 'Locations (end of month)', 'New locations', 'Churned locations', 'MRR', 'Revenue', 'Cost of service', 'Operating expenses', 'Operating income']]
          .concat(model.map(r => [r.ym, r2(r.locations), r2(r.newLocations), r2(r.churned), r2(r.mrr), r2(r.revenue), r2(r.cos), r2(r.opexTotal), r2(r.opIncome)]))
      };
    }
  };
});
