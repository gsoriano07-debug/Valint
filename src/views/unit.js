(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Unit economics: a per-location calculator seeded from the plan, a check of the plan doc's printed
     results, an LTV:CAC sensitivity grid and the same figures observed in the CRM. */

  /* The plan doc's printed unit-economics results (outputs, not inputs). Used only to check that the plan's
     inputs reproduce them. `half` is half a unit of the doc's printed precision. */
  const DOC_CHECK = {
    2027: { gp: 327, ltv: 10900, ratio: 22.8, payback: 1.5 },
    2028: { gp: 360, ltv: 12000, ratio: 12.7, payback: 2.6 },
    2029: { gp: 382, ltv: 12700, ratio: 12.2, payback: 2.7 }
  };
  const DOC_FIRST = Number(Object.keys(DOC_CHECK)[0]);
  const IN_KEYS = ['price', 'gm', 'churn', 'cac', 'setup'];
  const HEALTHY = 3;        // LTV:CAC rule of thumb
  const PRICE_STEP = 50;    // spacing of the sensitivity grid's price columns, in dollars
  const EXTRA_CHURN = [0.02, 0.05]; // grid rows added around the plan's churn cases
  const MAX_SHOWN = 1e12;   // results this large come only from typos (e.g. CAC 1e-300); shown as "Too large to show"

  const st = { year: null, inputs: null };
  const { esc, num, fmtMoney, fmtPrice, fmtPct, fmtNum, ui } = ctx;
  const x1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtX = v => x1.format(v) + 'x';
  const fmtMonths = (v, d) => fmtNum(v, d == null ? 1 : d) + (Math.abs(v - 1) < 0.05 ? ' month' : ' months');
  const pctStr = f => String(Math.round(num(f) * 10000) / 100); // 0.82 -> "82", 0.025 -> "2.5"
  const has = v => v != null && v !== '' && isFinite(Number(v));
  const round2 = v => Math.round(v * 100) / 100;

  /* ---------- plan + inputs ---------- */
  function years() { return ctx.planYears(); }
  function curYear() { const ys = years(); if (!ys.length) return null; return ys.indexOf(st.year) >= 0 ? st.year : ys[0]; }
  function planRaw(y) {
    const P = ctx.plan();
    const pick = o => (o && has(o[y]) ? Number(o[y]) : null);
    const cos = pick(P.costOfService);
    return {
      price: pick(P.prices),
      gm: cos == null ? null : 1 - cos,
      churn: P.churn && has(P.churn.base) ? Number(P.churn.base) : null,
      cac: pick(P.cac),
      setup: has(P.setupFee) ? Number(P.setupFee) : null
    };
  }
  function presetStrings(y) {
    const r = planRaw(y);
    return {
      price: r.price == null ? '' : String(r.price),
      gm: r.gm == null ? '' : pctStr(r.gm),
      churn: r.churn == null ? '' : pctStr(r.churn),
      cac: r.cac == null ? '' : String(r.cac),
      setup: r.setup == null ? '' : String(r.setup)
    };
  }
  function inputs() { return st.inputs || presetStrings(curYear()); }
  function parseIn(s) {
    const t = String(s == null ? '' : s).replace(/[$,%\s]/g, '');
    if (!t) return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  }
  function values() {
    const s = inputs(), v = {};
    IN_KEYS.forEach(k => { v[k] = parseIn(s[k]); });
    if (v.gm != null) v.gm /= 100;
    if (v.churn != null) v.churn /= 100;
    return v;
  }
  function edited() {
    if (!st.inputs) return false;
    const p = presetStrings(curYear());
    return IN_KEYS.some(k => { const a = parseIn(st.inputs[k]), b = parseIn(p[k]); return a == null || b == null ? a !== b : Math.abs(a - b) > 1e-9; });
  }

  /* ---------- math (the doc's formulas) ---------- */
  function retainedMonths(c, n) { let s = 0; for (let m = 0; m < n; m++) s += Math.pow(1 - c, m); return s; }
  function validate(v) {
    const bad = {};
    if (v.price == null || v.price < 0) bad.price = true;
    if (v.gm == null || v.gm > 1) bad.gm = true;
    if (v.churn == null || v.churn <= 0 || v.churn > 1) bad.churn = true;
    if (v.cac == null || v.cac < 0) bad.cac = true;
    if (v.setup == null || v.setup < 0) bad.setup = true;
    return bad;
  }
  /* v: {price, gm (fraction), churn (monthly fraction), cac, setup} */
  function calc(v) {
    const bad = validate(v), ok = k => !bad[k];
    const fin = x => (x != null && Math.abs(x) < MAX_SHOWN ? x : null); // extreme typed values never put Infinity or 300-digit numbers on screen
    const r = { v, bad };
    r.gp = fin(ok('price') && ok('gm') ? v.price * v.gm : null);                  // gross profit / location / month
    r.life = fin(ok('churn') ? 1 / v.churn : null);                               // average lifetime, months
    r.ltv = fin(r.gp != null && ok('churn') ? r.gp / v.churn : null);             // lifetime gross profit (setup fee excluded)
    r.ratio = fin(r.ltv != null && ok('cac') && v.cac > 0 ? r.ltv / v.cac : null); // LTV:CAC
    r.payback = fin(ok('cac') && r.gp != null && r.gp > 0 ? v.cac / r.gp : null); // months to earn back CAC
    r.retained = ok('churn') ? retainedMonths(v.churn, 12) : null;                // paid months in year one per location signed
    r.fy = fin(r.gp != null && r.retained != null ? r.gp * r.retained : null);    // first-year gross profit
    r.cover = fin(ok('setup') && ok('cac') && v.cac > 0 ? v.setup / v.cac : null); // setup fee / CAC
    r.maxCac = r.ltv != null && r.ltv > 0 ? r.ltv / HEALTHY : null;               // highest CAC that keeps 3x
    return r;
  }
  function tone(ratio) {
    if (ratio == null) return null;
    ratio = Math.round(ratio * 10) / 10; // judge the figure as shown (one decimal), so the words match the number
    if (ratio >= HEALTHY) return { t: 'good', word: 'Healthy', rule: HEALTHY + 'x or more' };
    if (ratio >= 1) return { t: 'warn', word: 'Thin', rule: 'between 1x and ' + HEALTHY + 'x' };
    return { t: 'bad', word: 'Losing money', rule: 'under 1x: each location earns back less than it cost' };
  }
  const WHY = {
    price: 'Enter a price of $0 or more',
    gm: 'Enter a gross margin of 100% or less',
    churn: 'Enter a monthly churn above 0% and up to 100%',
    cac: 'Enter a CAC of $0 or more',
    setup: 'Enter a setup fee of $0 or more'
  };
  /* When no listed input is invalid, a null result means it was too large to show (e.g. a CAC of 1e-300). */
  const need = (r, keys, dflt) => { const k = keys.find(x => r.bad[x]); return k ? WHY[k] : (dflt == null ? 'Too large to show' : dflt); };

  /* ---------- live outputs ---------- */
  function outputs(r) {
    const v = r.v, t = tone(r.ratio);
    const o = {};
    o.gp = ui.kpi({
      label: 'Gross profit / location / month',
      value: r.gp == null ? '—' : fmtMoney(r.gp),
      sub: r.gp == null ? need(r, ['price', 'gm']) : `${fmtPrice(v.price)} price × ${fmtPct(v.gm)} gross margin`
    });
    o.ltv = ui.kpi({
      label: 'Lifetime gross profit (LTV)',
      value: r.ltv == null ? '—' : fmtMoney(r.ltv),
      sub: r.ltv == null ? need(r, ['price', 'gm', 'churn'])
        : `Gross profit ÷ ${fmtPct(v.churn)} monthly churn · excludes the ${r.bad.setup ? '' : fmtMoney(v.setup) + ' '}setup fee, as the doc does`
    });
    let ratioSub;
    if (r.ratio != null) ratioSub = `${ui.chip(t.word, t.t)} ${esc(t.rule)}`;
    else if (!r.bad.cac && v.cac === 0 && r.ltv != null) ratioSub = 'CAC is $0, so there is no ratio to show';
    else ratioSub = need(r, ['price', 'gm', 'churn', 'cac']);
    o.ratio = ui.kpi({ label: 'LTV : CAC', value: r.ratio == null ? '—' : fmtX(r.ratio), tone: t ? t.t : '', sub: ratioSub });
    let pb, pbSub;
    if (r.payback != null) { pb = fmtMonths(r.payback); pbSub = `${fmtMoney(v.cac)} CAC ÷ ${fmtMoney(r.gp)} gross profit a month`; }
    else if (r.gp != null && r.gp <= 0 && !r.bad.cac && v.cac === 0) { pb = fmtMonths(0); pbSub = 'CAC is $0, so there is nothing to earn back'; }
    else if (r.gp != null && r.gp <= 0 && !r.bad.cac) { pb = 'Never'; pbSub = 'Gross profit is $0 or less a month, so CAC never pays back'; }
    else { pb = '—'; pbSub = need(r, ['price', 'gm', 'cac']); }
    o.payback = ui.kpi({ label: 'CAC payback', value: pb, sub: pbSub });

    o.life = r.life == null ? `<span class="muted">${WHY.churn}</span>` : fmtMonths(r.life);
    o.fy = r.fy == null ? `<span class="muted">${need(r, ['price', 'gm', 'churn'])}</span>` : fmtMoney(r.fy);
    o.setup = r.bad.setup ? `<span class="muted">${WHY.setup}</span>` : fmtMoney(v.setup);
    o.cover = r.cover == null ? `<span class="muted">${r.bad.setup ? WHY.setup : 'Needs a CAC above $0'}</span>`
      : `${fmtPct(r.cover, 0)}${r.cover >= 1 ? ' ' + ui.chip('Covers CAC up front', 'good') : ''}`;
    o.maxcac = r.maxCac == null ? `<span class="muted">${need(r, ['price', 'gm', 'churn'], r.ltv != null ? 'Needs gross profit above $0' : null)}</span>` : fmtMoney(r.maxCac);
    return o;
  }
  function editedHTML() {
    const y = curYear();
    if (!edited()) return `<span class="source">Matches the ${esc(y)} plan</span>`;
    return `${ui.chip('What-if', 'accent')} <button class="btn btn-sm btn-ghost" type="button" data-act="mod" data-mod="unit" data-a="reset">Reset to ${esc(y)} plan</button>`;
  }
  function refresh(el, key) {
    const r = calc(values()), o = outputs(r);
    Object.keys(o).forEach(k => { const n = document.getElementById('unit-out-' + k); if (n) n.innerHTML = o[k]; });
    const s = document.getElementById('unit-sens'); if (s) s.innerHTML = sensHTML(r);
    const e = document.getElementById('unit-edited'); if (e) e.innerHTML = editedHTML();
    if (el && key && el.setAttribute) { if (r.bad[key]) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
  }

  /* ---------- sensitivity grid ---------- */
  function sensAxes() {
    const P = ctx.plan(), y = curYear();
    const planPrice = planRaw(y).price;
    const center = planPrice != null && planPrice > 0 ? planPrice : (values().price || 0);
    const prices = center > 0 ? [center - PRICE_STEP, center, center + PRICE_STEP, center + 2 * PRICE_STEP].filter(p => p > 0) : [];
    const byKey = {};
    const add = (c, name) => { const k = Math.round(c * 100000); if (!byKey[k]) byKey[k] = { c, names: [] }; if (name) byKey[k].names.push(name); };
    EXTRA_CHURN.forEach(c => add(c));
    if (P.churn && typeof P.churn === 'object') Object.keys(P.churn).forEach(k => { const c = Number(P.churn[k]); if (isFinite(c) && c > 0 && c < 1) add(c, k); });
    const churns = Object.keys(byKey).map(k => byKey[k]).sort((a, b) => a.c - b.c);
    return { prices, churns, planPrice, year: y };
  }
  const sensVal = (p, c, r) => { if (r.bad.gm || r.bad.cac || !(r.v.cac > 0)) return null; const x = (p * r.v.gm / c) / r.v.cac; return Math.abs(x) < MAX_SHOWN ? x : null; };
  function sensChip(v) {
    if (v == null) return '<span class="muted">—</span>';
    const t = tone(v);
    return ui.chip(fmtX(v) + (t.t === 'good' ? '' : ' · ' + t.word.toLowerCase()), t.t);
  }
  function sensHTML(r) {
    const ax = sensAxes();
    if (r.bad.gm || r.bad.cac || !(r.v.cac > 0)) return `<p class="note">${r.bad.gm ? WHY.gm : 'Enter a CAC above $0'} to fill this grid.</p>`;
    if (!ax.prices.length) return '<p class="note">Enter a price above $0 to fill this grid.</p>';
    const head = `<tr><th>Monthly churn</th>${ax.prices.map(p => `<th class="num">${fmtPrice(p)}${p === ax.planPrice ? ' · plan' : ''}</th>`).join('')}</tr>`;
    const rows = ax.churns.map(row => `<tr><td><span class="cell-main">${fmtPct(row.c)}</span>${row.names.length ? ` <span class="source">${esc(row.names.join(', '))}</span>` : ''}</td>${ax.prices.map(p => `<td class="num">${sensChip(sensVal(p, row.c, r))}</td>`).join('')}</tr>`).join('');
    let mine = '';
    if (r.ratio != null) {
      const t = tone(r.ratio);
      mine = `<p class="note">Your inputs: ${fmtPrice(r.v.price)} at ${fmtPct(r.v.churn)} monthly churn gives ${fmtX(r.ratio)} LTV:CAC (${esc(t.word.toLowerCase())}).</p>`;
    }
    return `<div class="table-wrap flat"><table class="compact"><caption class="source" style="text-align:left;padding:8px 12px">LTV:CAC at ${fmtPct(r.v.gm)} gross margin and ${fmtMoney(r.v.cac)} CAC. Columns: price per location per month. Rows: monthly churn.</caption><thead>${head}</thead><tbody>${rows}</tbody></table></div>${mine}`;
  }

  /* ---------- plan check ---------- */
  const METRICS = [
    { k: 'gp', label: 'Gross profit / location / month', half: 0.5, doc: v => fmtMoney(v), calc: v => fmtPrice(round2(v)) },
    { k: 'ltv', label: 'Lifetime gross profit (LTV)', half: 50, doc: v => fmtMoney(v), calc: v => fmtMoney(v) },
    { k: 'ratio', label: 'LTV : CAC', half: 0.05, doc: v => fmtX(v), calc: v => fmtNum(v, 2) + 'x' },
    { k: 'payback', label: 'CAC payback', half: 0.05, doc: v => fmtMonths(v), calc: v => fmtMonths(v, 2) }
  ];
  function check(doc, val, half) {
    if (doc == null || val == null) return { html: '<span class="muted">—</span>', agree: false, counted: false };
    const diff = Math.abs(val - doc), rel = doc ? diff / Math.abs(doc) : (diff ? 1 : 0);
    const apart = ` <span class="source">${fmtPct(rel, 1)} apart</span>`;
    if (rel <= 0.01) return { html: ui.chip('Match', 'good') + apart, agree: true, counted: true };
    if (diff <= half + 1e-9) return { html: ui.chip('Matches when rounded', 'accent') + apart, agree: true, counted: true };
    return { html: ui.chip('Off by ' + fmtPct(rel), 'warn'), agree: false, counted: true };
  }
  function planCheck() {
    const ys = years();
    let agree = 0, counted = 0;
    const rows = ys.map(y => {
      const pr = planRaw(y), r = calc(pr), doc = DOC_CHECK[y] || null;
      const yearCell = `<td rowspan="${METRICS.length}" style="vertical-align:top"><div class="cell-main">${esc(y)}</div>
        <div class="source">${pr.price != null ? fmtPrice(pr.price) + ' price' : 'No price'} · ${pr.cac != null ? fmtMoney(pr.cac) + ' CAC' : 'no CAC'}</div>
        <div class="source">${pr.churn != null ? fmtPct(pr.churn) + ' monthly churn' : 'no churn'}</div>
        ${y === DOC_FIRST ? `<div style="margin-top:6px">${ui.chip('CAC understated', 'warn')}</div>` : ''}</td>`;
      return METRICS.map((m, i) => {
        const val = r[m.k], d = doc ? doc[m.k] : null, c = check(d, val, m.half);
        if (c.counted) { counted++; if (c.agree) agree++; }
        return `<tr>${i === 0 ? yearCell : ''}<td>${m.label}</td><td class="num">${d == null ? '<span class="muted">—</span>' : m.doc(d)}</td><td class="num">${val == null ? '<span class="muted">—</span>' : m.calc(val)}</td><td>${c.html}</td></tr>`;
      }).join('');
    }).join('');
    const table = `<div class="table-wrap flat"><table class="compact"><thead><tr><th>Year</th><th>Figure</th><th class="num">Plan doc</th><th class="num">Computed from plan</th><th>Check</th></tr></thead><tbody>${rows}</tbody></table></div>`;

    const ratios = ys.map(y => calc(planRaw(y)).ratio);
    const chartOk = ratios.some(v => v != null);
    const fmtAxis = v => (Number.isInteger(v) ? fmtNum(v) : x1.format(v)) + 'x';
    const chart = chartOk ? ctx.chart.bars({
      labels: ys.map(String), height: 180, format: fmtAxis,
      series: [{ name: 'LTV:CAC computed from plan', values: ratios, color: 'var(--viz-1)' }],
      refLine: { value: HEALTHY, label: HEALTHY + 'x healthy floor' },
      ariaLabel: 'LTV to CAC by plan year: ' + ys.map((y, i) => y + ' ' + (ratios[i] == null ? 'no figure' : fmtX(ratios[i]))).join(', ')
    }) : '';
    const caption = chartOk ? `<p class="note">LTV:CAC computed from the plan: ${ys.map((y, i) => `${esc(y)} ${ratios[i] == null ? 'no figure' : fmtX(ratios[i])}`).join(', ')}. The line marks ${HEALTHY}x, the usual healthy floor. It falls as paid sales raise CAC.</p>` : '';

    const first = calc(planRaw(DOC_FIRST));
    const flag = ys.indexOf(DOC_FIRST) >= 0
      ? `<p class="note">The plan doc flags its ${DOC_FIRST} CAC as understated because it leaves out the founder’s selling time.${first.maxCac != null ? ` There is room: ${DOC_FIRST} LTV:CAC stays at ${HEALTHY}x or better up to a CAC of ${fmtMoney(first.maxCac)} per location. Raise CAC in the calculator above to test it.` : ''}</p>`
      : '';
    const how = `<p class="note">Computed with this tab’s formulas: gross profit = price × (1 − cost of service); LTV = gross profit ÷ base monthly churn; LTV:CAC = LTV ÷ CAC; payback = CAC ÷ gross profit. Match means within 1%. “Matches when rounded” means the gap is only the doc’s rounding (it prints payback to one decimal).</p>`;
    const sub = counted ? `${agree} of ${counted} figures agree with the doc` : 'No doc figures for these years';
    return ui.panel({ title: 'Plan check', sub, body: chart + caption + table + flag + how, cls: 'section' });
  }

  /* ---------- CRM observations ---------- */
  function crm() {
    const deals = ctx.all('deals');
    const won = deals.filter(d => d.stage === 'won'), lost = deals.filter(d => d.stage === 'lost');
    if (!won.length && !lost.length) {
      return `<p class="note">Once you mark deals won or lost, this tab adds your real win rate, deal size and churn next to the plan’s. <button class="link" type="button" data-act="go" data-view="pipeline">Open the pipeline</button></p>`;
    }
    const rows = [];
    const row = (label, src, value) => `<div class="stat-row"><dt>${label}${src ? `<div class="source">${src}</div>` : ''}</dt><dd>${value}</dd></div>`;
    rows.push(row('Win rate', `won ÷ (won + lost): ${won.length} won, ${lost.length} lost`, fmtPct(won.length / (won.length + lost.length), 0)));
    const priced = won.filter(ctx.priced), locsSum = ctx.sum(priced, ctx.pricedLocs);
    rows.push(row('Average locations per won deal', priced.length ? `${locsSum} location${locsSum === 1 ? '' : 's'} across ${priced.length} won deal${priced.length === 1 ? '' : 's'}` : 'No won deal has a location count yet',
      priced.length ? fmtNum(locsSum / priced.length, 1) : '<span class="muted">—</span>'));
    if (won.length) rows.push(row('Average ARR per won deal', `${won.length} won deal${won.length === 1 ? '' : 's'}`, fmtMoney(ctx.sum(won, d => num(d.value)) / won.length)));
    if (locsSum > 0) {
      const p = round2(ctx.sum(priced, d => num(d.value)) / 12 / locsSum);
      const cur = values().price;
      const use = !(p > 0) || (cur != null && Math.abs(cur - p) < 0.005) ? '' : ` <button class="btn btn-sm btn-ghost" type="button" data-act="mod" data-mod="unit" data-a="use-price" data-v="${p}">Use in calculator</button>`;
      rows.push(row('Average price per location per month', 'ARR ÷ 12 ÷ locations, won deals', fmtPrice(p) + use));
    }
    const subs = ctx.subscriptions(), churned = subs.filter(s => ctx.isChurned(s.deal)).length;
    if (subs.length) rows.push(row('Observed churn', `${churned} of ${subs.length} subscription${subs.length === 1 ? '' : 's'} ended`, `${fmtPct(churned / subs.length, 0)} ${ui.chip('Small sample', 'warn')}`));
    const base = ctx.plan().churn && has(ctx.plan().churn.base) ? Number(ctx.plan().churn.base) : null;
    const note = subs.length
      ? `<p class="note">Observed churn is the share of all subscriptions that have ended so far, not a monthly rate. With ${subs.length} subscription${subs.length === 1 ? '' : 's'} it is a small-sample figure: keep using the plan’s ${base != null ? fmtPct(base) + ' ' : ''}monthly churn until you have many more customers.</p>`
      : '';
    return ui.panel({ title: 'From your CRM', sub: 'All closed deals to date', body: `<dl class="stat-list">${rows.join('')}</dl>${note}`, cls: 'section' });
  }

  /* ---------- page ---------- */
  function seg() {
    const y = curYear();
    return `<div class="seg" role="group" aria-label="Load a plan year">${years().map(v => `<button type="button" data-act="mod" data-mod="unit" data-a="year" data-year="${esc(v)}" aria-pressed="${v === y}">${esc(v)}</button>`).join('')}</div>`;
  }
  function field(k, label, s, hint, bad) {
    return `<div class="field"><label for="unit-in-${k}">${label}</label><input class="input mono" id="unit-in-${k}" inputmode="decimal" autocomplete="off" data-mod-input="unit" data-key="${k}" value="${esc(s)}" aria-describedby="unit-hint-${k}"${bad ? ' aria-invalid="true"' : ''}><span class="hint" id="unit-hint-${k}">${hint}</span></div>`;
  }
  function inputsPanel(r) {
    const y = curYear(), pr = planRaw(y), s = inputs(), P = ctx.plan();
    const ch = P.churn && typeof P.churn === 'object' ? P.churn : {};
    const others = Object.keys(ch).filter(k => k !== 'base' && has(ch[k])).map(k => `${esc(k)} ${fmtPct(Number(ch[k]))}`).join(', ');
    const body = `<div class="calc-grid">
      ${field('price', 'Price / location / month ($)', s.price, pr.price != null ? `${esc(y)} plan: ${fmtPrice(pr.price)}` : 'Not in the plan', r.bad.price)}
      ${field('gm', 'Gross margin (%)', s.gm, pr.gm != null ? `${esc(y)} plan: ${fmtPct(pr.gm)} (cost of service ${fmtPct(1 - pr.gm)})` : 'Not in the plan', r.bad.gm)}
      ${field('churn', 'Monthly churn (%)', s.churn, pr.churn != null ? `Plan base: ${fmtPct(pr.churn)}${others ? ` (${others})` : ''}` : 'Not in the plan', r.bad.churn)}
      ${field('cac', 'CAC per new location ($)', s.cac, pr.cac != null ? `${esc(y)} plan: ${fmtMoney(pr.cac)}` : 'Not in the plan', r.bad.cac)}
      ${field('setup', 'Setup fee, one-time ($)', s.setup, pr.setup != null ? `Plan: ${fmtMoney(pr.setup)}` : 'Not in the plan', r.bad.setup)}
    </div>
    <p class="note">Pick a year above to load its plan numbers, then change any of them to test a what-if. What-ifs stay on this page; edit the plan itself on the <button class="link" type="button" data-act="go" data-view="assumptions">Assumptions tab</button>.</p>`;
    return ui.panel({ title: 'Inputs', sub: `Loaded from the ${y} plan`, actions: `<span id="unit-edited">${editedHTML()}</span>`, body });
  }
  function morePanel(o) {
    const row = (k, label, src) => `<div class="stat-row"><dt>${label}<div class="source">${src}</div></dt><dd id="unit-out-${k}">${o[k]}</dd></div>`;
    const body = `<dl class="stat-list">
      ${row('life', 'Average customer lifetime', '1 ÷ monthly churn')}
      ${row('fy', 'First-year gross profit per location', '12 months of gross profit, less expected churn')}
      ${row('setup', 'Setup fee, one-time', 'Shown apart: not added to LTV, as in the doc')}
      ${row('cover', 'Setup fee coverage of CAC', 'Setup fee ÷ CAC')}
      ${row('maxcac', `Highest CAC that keeps ${HEALTHY}x`, `LTV ÷ ${HEALTHY}`)}
    </dl>`;
    return ui.panel({ title: 'Per location', sub: 'Updates as you type', body });
  }

  return {
    id: 'unit',
    label: 'Unit economics',
    group: 'Planning',
    order: 20,
    collections: [],
    render() {
      const loading = ctx.isLoading();
      if (loading) return ui.toolbar({ title: 'Unit economics' }) + '<div class="empty"><p>Loading your plan and deals…</p></div>';
      const ys = years();
      if (!ys.length) {
        return ui.toolbar({ title: 'Unit economics' }) + ui.empty({
          title: 'No plan prices yet',
          text: 'Unit economics start from a price per location. Add the plan’s prices on the Assumptions tab and this calculator fills in from them.',
          action: '<button class="btn btn-primary" type="button" data-act="go" data-view="assumptions">Open Assumptions</button>'
        });
      }
      const r = calc(values()), o = outputs(r);
      const wrap = k => `<div id="unit-out-${k}" style="display:contents">${o[k]}</div>`;
      const kp = `<section class="kpis" aria-label="Unit economics per location" aria-live="polite">${wrap('gp')}${wrap('ltv')}${wrap('ratio')}${wrap('payback')}</section>`;
      const top = `<div class="grid grid-2 section">${inputsPanel(r)}${morePanel(o)}</div>`;
      const sens = ui.panel({
        title: 'Sensitivity',
        sub: `LTV:CAC by price and churn · ${HEALTHY}x or more is healthy; weaker cells say thin or losing money`,
        body: `<div id="unit-sens">${sensHTML(r)}</div>`,
        cls: 'section'
      });
      return ui.toolbar({ title: 'Unit economics', filters: seg(), exportable: true }) + kp + top + sens + planCheck() + crm();
    },
    onAction(a, data) {
      if (a === 'year') {
        const y = Number(data.year);
        if (years().indexOf(y) >= 0) { st.year = y; st.inputs = null; ctx.render(); }
      } else if (a === 'reset') {
        st.inputs = null; ctx.render();
      } else if (a === 'use-price') {
        const p = Number(data.v);
        if (isFinite(p) && p > 0) { st.inputs = Object.assign({}, inputs(), { price: String(p) }); ctx.render(); }
      }
    },
    onInput(key, el) {
      if (IN_KEYS.indexOf(key) < 0 || !el) return;
      const s = Object.assign({}, inputs());
      s[key] = String(el.value == null ? '' : el.value);
      st.inputs = s;
      refresh(el, key);
    },
    csv() {
      const r = calc(values()), ax = sensAxes();
      const rows = [['Monthly churn (%)'].concat(ax.prices.map(p => `LTV:CAC at $${round2(p)} per location per month`))];
      ax.churns.forEach(row => {
        rows.push([round2(row.c * 100)].concat(ax.prices.map(p => { const v = sensVal(p, row.c, r); return v == null ? '' : Math.round(v * 10) / 10; })));
      });
      const basis = r.bad.gm || r.bad.cac || !(r.v.cac > 0) ? 'The grid is blank: it needs a gross margin and a CAC above $0'
        : `Assumes ${pctStr(r.v.gm)}% gross margin and $${round2(r.v.cac)} CAC per location (${ax.year} plan${edited() ? ', edited' : ''})`;
      rows.push([basis].concat(ax.prices.map(() => '')));
      return { name: 'unit-economics-sensitivity', rows };
    }
  };
});
