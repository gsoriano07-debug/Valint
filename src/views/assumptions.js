(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Assumptions: the plan every other tab reads (settings/plan). The founder edits a draft copy here, watches the
     base case move in a live preview, then saves it for everyone. Also sets the cash starting point (settings/finance).
     Every number shown comes from ctx.plan(), ctx.PLAN_DEFAULTS (the projections doc) or ctx.finance(). */
  const ID = 'assumptions';
  const { esc, num, fmtMoney, fmtCompact, fmtPrice, fmtPct, fmtNum, ui } = ctx;
  const SCEN_ORDER = ['conservative', 'base', 'upside'];
  const SCEN_LABEL = { conservative: 'Conservative', base: 'Base', upside: 'Upside' };
  /* [field, column title, kind] for each number a target can carry */
  const TARGET_COLS = [['locations', 'Locations', 'count'], ['arr', 'ARR', 'money'], ['revenue', 'Revenue', 'money'], ['opIncome', 'Operating income', 'smoney']];

  /* draft: deep copy of the saved plan being edited; base: the saved plan it was copied from;
     text: what the founder typed, per key; bad: per-key parse/range message (the draft keeps the last valid number). */
  const st = { draft: null, base: null, fields: [], byKey: {}, text: {}, bad: {}, conflict: false, saving: false };

  /* ---------- small helpers ---------- */
  const clone = o => JSON.parse(JSON.stringify(o == null ? null : o));
  const isNum = v => typeof v === 'number' && isFinite(v);
  const keyOf = path => path.join('.');
  const domId = key => ID + '-f-' + String(key).replace(/[^A-Za-z0-9]/g, '-');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const round2 = v => Math.round(v * 100) / 100;
  const pctStr = f => String(Math.round(num(f) * 1e6) / 1e4); // 0.18 -> "18", 0.025 -> "2.5"
  function getPath(o, path) {
    let c = o;
    for (let i = 0; i < path.length; i++) { if (c == null || typeof c !== 'object') return undefined; c = c[path[i]]; }
    return c;
  }
  function setPath(o, path, v) {
    let c = o;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i];
      if (c[p] == null || typeof c[p] !== 'object') c[p] = typeof path[i + 1] === 'number' ? [] : {};
      c = c[p];
    }
    c[path[path.length - 1]] = v;
  }
  function asNum(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  function same(a, b) {
    const x = asNum(a), y = asNum(b);
    if (x != null && y != null) return Math.abs(x - y) < 1e-9;
    const ae = a == null || a === '', be = b == null || b === '';
    if (ae || be) return ae && be;
    return a === b || JSON.stringify(a) === JSON.stringify(b);
  }
  function longDate(ymd) {
    const d = ctx.parseYmd(ymd);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : String(ymd || '');
  }
  function yearsOf(P) {
    return Object.keys((P && P.prices) || {}).map(Number).filter(n => isFinite(n)).sort((a, b) => a - b);
  }
  function scenariosOf(P) {
    const ks = Object.keys((P && P.churn) || {}).concat(Object.keys((P && P.newMultiplier) || {}));
    const uniq = ks.filter((k, i) => ks.indexOf(k) === i);
    return SCEN_ORDER.filter(k => uniq.indexOf(k) >= 0).concat(uniq.filter(k => SCEN_ORDER.indexOf(k) < 0));
  }
  const scenLabel = k => SCEN_LABEL[k] || (String(k).charAt(0).toUpperCase() + String(k).slice(1));
  function opexKeys(P) {
    const known = Object.keys(ctx.OPEX_LABELS), have = Object.keys((P && P.opex) || {});
    return known.filter(k => have.indexOf(k) >= 0).concat(have.filter(k => known.indexOf(k) < 0));
  }
  const opexLabel = k => ctx.OPEX_LABELS[k] || String(k);

  /* ---------- the editable fields (built from the draft's own shape: its years, scenarios, cost lines, targets) ---------- */
  function buildFields(P) {
    const ys = yearsOf(P), out = [];
    const add = (path, kind, aria, extra) => { out.push(Object.assign({ path, key: keyOf(path), kind, aria }, extra || {})); };
    ys.forEach(y => add(['prices', String(y)], 'price', `Price per location per month, ${y}`));
    add(['setupFee'], 'money', 'Setup fee');
    add(['pilotFee'], 'money', 'Pilot fee');
    add(['pilots'], 'whole', 'Pilot locations');
    ys.forEach(y => [0, 1].forEach(i => add(['newPerMonth', String(y), i], 'count', `New locations a month, ${i ? 'high' : 'low'}, ${y}`,
      { pair: [['newPerMonth', String(y), 0], ['newPerMonth', String(y), 1]], side: i })));
    scenariosOf(P).forEach(k => {
      add(['churn', k], 'pct', `${scenLabel(k)} case monthly churn, percent`);
      add(['newMultiplier', k], 'mult', `${scenLabel(k)} case new-location multiplier`);
    });
    ys.forEach(y => add(['costOfService', String(y)], 'pct', `Cost of service, percent of revenue, ${y}`));
    opexKeys(P).forEach(k => ys.forEach(y => add(['opex', k, String(y)], 'money', `${opexLabel(k)}, annual, ${y}`)));
    ys.forEach(y => add(['team', String(y)], 'count', `Team size, ${y}`));
    ys.forEach(y => add(['cac', String(y)], 'money', `CAC per new location, ${y}`));
    add(['hireSalesAtArr'], 'money', 'Hire a salesperson at ARR of');
    add(['startupCosts'], 'money', 'Startup costs');
    (Array.isArray(P && P.targets) ? P.targets : []).forEach((t, i) => {
      if (!t || typeof t !== 'object') return;
      TARGET_COLS.forEach(([k, title, kind]) => { if (t[k] != null && t[k] !== '') add(['targets', i, k], kind, `${t.label || 'Target'} ${title.toLowerCase()}`); });
    });
    return out;
  }

  /* ---------- parsing and validation ---------- */
  function rangeErr(f, v) {
    if (!isNum(v)) return 'Enter a number';
    switch (f.kind) {
      case 'price': return v > 0 ? '' : 'Enter a price above $0';
      case 'pct': return v >= 0 && v < 1 ? '' : 'Enter 0 to under 100';
      case 'smoney': return '';
      case 'whole': return v >= 0 && Number.isInteger(v) ? '' : 'Enter a whole number, 0 or more';
      case 'mult': return v >= 0 ? '' : 'Enter 0 or more, like 1.5';
      case 'count': return v >= 0 ? '' : 'Enter 0 or more';
      default: return v >= 0 ? '' : 'Enter $0 or more';
    }
  }
  function parseIn(f, raw) {
    const t = String(raw == null ? '' : raw).replace(/[$,\s%×]/g, '').replace(/−/g, '-').replace(/x$/i, '');
    if (!t) return { msg: 'Enter a number' };
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return { msg: 'Enter a number' };
    let v = Number(t);
    if (f.kind === 'pct') v = Math.round(v * 1e6) / 1e8;
    else if (f.kind === 'price' || f.kind === 'money' || f.kind === 'smoney') v = round2(v);
    const e = rangeErr(f, v);
    return e ? { msg: e } : { v };
  }
  function pairErr(f) {
    if (!f.pair || !st.draft) return '';
    const lo = getPath(st.draft, f.pair[0]), hi = getPath(st.draft, f.pair[1]);
    if (!isNum(lo) || !isNum(hi) || lo <= hi) return '';
    return f.side ? 'High is below low' : 'Low is above high';
  }
  function errFor(f) { return st.bad[f.key] || rangeErr(f, getPath(st.draft, f.path)) || pairErr(f); }
  const badFields = () => st.fields.filter(f => errFor(f));
  function changesVs(P) { return P ? st.fields.filter(f => !same(getPath(st.draft, f.path), getPath(P, f.path))).length : 0; }
  function docDiffs(P) { return st.fields.filter(f => !same(getPath(P, f.path), getPath(ctx.PLAN_DEFAULTS, f.path))).length; }

  /* ---------- draft lifecycle ---------- */
  function build(P) {
    const d = clone(P) || {};
    const fields = buildFields(d);
    fields.forEach(f => { const v = getPath(d, f.path); if (typeof v === 'string' && asNum(v) != null) setPath(d, f.path, asNum(v)); });
    st.draft = d; st.base = P; st.fields = fields;
    st.byKey = {}; fields.forEach(f => { st.byKey[f.key] = f; });
    st.text = {}; st.bad = {}; st.conflict = false;
  }
  function dropDraft() { st.draft = null; st.base = null; st.fields = []; st.byKey = {}; st.text = {}; st.bad = {}; st.conflict = false; }
  /* Rebuild the draft when the saved plan changed and nothing is being edited; flag a conflict when something is. */
  function ensureDraft() {
    const P = ctx.plan();
    if (!st.draft) { build(P); return; }
    /* Read-only (including after write access is lost mid-edit): always show the saved plan, never leftover draft edits. */
    if (!ctx.canWrite()) { if (P !== st.base || Object.keys(st.bad).length || changesVs(P)) build(P); return; }
    if (P === st.base) return;
    if (JSON.stringify(P) === JSON.stringify(st.base)) { st.base = P; return; }
    if (st.saving) return; // our own save or reset is landing; the draft is rebuilt once it resolves
    const dirty = Object.keys(st.bad).length > 0 || changesVs(st.base) > 0;
    if (!dirty) { build(P); return; }
    st.base = P; st.conflict = true;
  }

  /* ---------- formatting ---------- */
  function fmtInput(f, v) {
    if (!isNum(v)) return v == null || typeof v === 'object' ? '' : String(v);
    if (f.kind === 'pct') return pctStr(v);
    if (f.kind === 'mult') return String(v);
    return fmtNum(v, 2);
  }
  function fmtText(f, v) {
    if (!isNum(v)) return '—';
    switch (f.kind) {
      case 'price': return fmtPrice(v);
      case 'pct': return fmtPct(v, 2);
      case 'mult': return fmtNum(v, 2) + '×';
      case 'count': case 'whole': return fmtNum(v, 2);
      default: return fmtMoney(v);
    }
  }
  function chgHTML(f) {
    const v = getPath(st.draft, f.path), d = getPath(ctx.PLAN_DEFAULTS, f.path);
    if (same(v, d)) return '';
    return `${ui.chip('Changed from doc', 'accent')} <span>doc ${isNum(d) ? fmtText(f, d) : 'has none'}</span>`;
  }

  /* ---------- controls ---------- */
  function control(f, wide) {
    const v = getPath(st.draft, f.path), id = domId(f.key);
    const note = `<div class="source" id="${id}-note"${wide ? '' : ' style="margin-top:4px"'}>${chgHTML(f)}</div>`;
    if (!ctx.canWrite()) return `<span class="mono">${fmtText(f, v)}</span>${note}`;
    const err = errFor(f), txt = st.text[f.key] != null ? st.text[f.key] : fmtInput(f, v);
    const style = wide ? '' : ' style="width:8em;text-align:right"';
    const mode = f.kind === 'smoney' ? '' : ' inputmode="decimal"'; // the decimal keypad has no minus sign
    const label = wide ? '' : ` aria-label="${esc(f.aria)}"`;
    const hint = wide ? ` ${id}-hint` : '';
    return `<input class="input mono" id="${id}" type="text"${mode} autocomplete="off"${style}${label} data-mod-input="${ID}" data-key="${esc(f.key)}" value="${esc(txt)}" aria-describedby="${id}-note ${id}-err${hint}"${err ? ' aria-invalid="true"' : ''}>`
      + note + `<div id="${id}-err" style="color:var(--bad);font-size:12px;margin-top:2px"${err ? '' : ' hidden'}>${esc(err)}</div>`;
  }
  function cell(key) {
    const f = st.byKey[key];
    if (!f) return '<td class="num" style="vertical-align:top"><span class="muted">—</span></td>';
    return `<td style="text-align:right;vertical-align:top">${control(f, false)}</td>`;
  }
  function scalar(key, label, hint) {
    const f = st.byKey[key];
    if (!f) return '';
    const id = domId(key);
    const hintHTML = `<span class="hint" id="${id}-hint">${esc(hint)}</span>`;
    const lab = ctx.canWrite() ? `<label for="${id}">${esc(label)}</label>` : `<span style="font-size:13px;font-weight:600">${esc(label)}</span>`;
    return `<div class="field">${lab}${control(f, true)}${hintHTML}</div>`;
  }
  function table(head, rows) {
    return `<div class="table-wrap flat"><table class="compact"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }
  const yearHead = (first, ys) => `<tr><th>${esc(first)}</th>${ys.map(y => `<th class="num">${esc(y)}</th>`).join('')}</tr>`;
  function rowHTML(label, sub, cells) {
    return `<tr><td style="vertical-align:top;padding-top:14px"><div class="cell-main">${esc(label)}</div>${sub ? `<div class="cell-sub">${esc(sub)}</div>` : ''}</td>${cells.join('')}</tr>`;
  }

  /* ---------- computed rows inside the sections ---------- */
  function avgText(y) {
    const r = getPath(st.draft, ['newPerMonth', String(y)]) || [];
    return isNum(r[0]) && isNum(r[1]) ? fmtNum((r[0] + r[1]) / 2, 2) : '—';
  }
  function opexText(y) {
    const tot = ctx.sum(opexKeys(st.draft), k => num(getPath(st.draft, ['opex', k, String(y)])));
    return `${fmtMoney(tot)}<div class="cell-sub">${fmtMoney(tot / 12)} a month</div>`;
  }

  /* ---------- the model (same math as ctx.planModel, run on any plan object) ---------- */
  function summaryOf(P) {
    const mRaw = (P.newMultiplier || {}).base, mult = mRaw == null ? 1 : num(mRaw), churn = num((P.churn || {}).base);
    let L = num(P.pilots);
    return yearsOf(P).map(y => {
      const r = (P.newPerMonth || {})[y] || [0, 0], add = (num(r[0]) + num(r[1])) / 2 * mult;
      const price = num((P.prices || {})[y]), cosPct = num((P.costOfService || {})[y]);
      const opexMonth = ctx.sum(Object.keys(P.opex || {}), k => num((P.opex[k] || {})[y]) / 12);
      let revenue = 0, opIncome = 0;
      for (let m = 1; m <= 12; m++) {
        const start = L, rev = start * price;
        L = start - start * churn + add;
        revenue += rev; opIncome += rev - rev * cosPct - opexMonth;
      }
      return { year: y, endLocations: L, endArr: L * price * 12, revenue, opIncome };
    });
  }
  function savedSummary() {
    return ctx.planYearSummary(ctx.planModel('base')).map(r => ({ year: r.year, endLocations: r.endLocations, endArr: r.endArr, revenue: r.revenue, opIncome: r.opIncome }));
  }
  function targetRef(y, k) {
    const ts = Array.isArray(st.draft.targets) ? st.draft.targets : [];
    const t = ts.find(x => x && x.date === `${y}-12-31`);
    if (!t || asNum(t[k]) == null) return null;
    const dt = (ctx.PLAN_DEFAULTS.targets || []).find(x => x && x.date === t.date);
    return { label: dt && same(dt[k], t[k]) ? 'Plan doc' : 'Your target', v: asNum(t[k]) };
  }
  const fmtLoc = v => fmtNum(v, 1);
  function deltaChip(d, fmt) { return ui.chip(`${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}`, 'accent'); }

  function previewHTML() {
    const D = summaryOf(st.draft), SV = savedSummary(), edit = ctx.canWrite();
    if (!D.length) return '<p class="note" style="margin-top:0">Add a price for at least one year to see the model.</p>';
    const d0 = D[0], y = d0.year, s0 = SV.find(r => r.year === y) || null;
    const kpi = (label, k, tKey, fmt) => {
      const dv = d0[k], sv = s0 ? s0[k] : null, lines = [];
      if (!edit) lines.push('Base case');
      else if (sv == null) lines.push('Not in the saved plan');
      else if (fmt(dv) === fmt(sv)) lines.push('Same as the saved plan');
      else lines.push(`${deltaChip(dv - sv, fmt)} vs saved plan ${fmt(sv)}`);
      const t = targetRef(y, tKey);
      if (t) lines.push(`${esc(t.label)}: ${fmt(t.v)}`);
      return ui.kpi({ label, value: fmt(dv), sub: lines.join('<br>'), tone: dv < 0 ? 'bad' : '' });
    };
    const kp = `<section class="kpis" aria-label="Base case for ${esc(y)}">${kpi(`Model locations · Dec ${y}`, 'endLocations', 'locations', fmtLoc)}${kpi(`Model ARR · Dec ${y}`, 'endArr', 'arr', fmtCompact)}${kpi(`Model revenue · ${y}`, 'revenue', 'revenue', fmtCompact)}${kpi(`Model operating income · ${y}`, 'opIncome', 'opIncome', fmtCompact)}</section>`;
    const rows = D.map(r => {
      const s = SV.find(x => x.year === r.year) || null;
      const c = (k, fmt) => `<td class="num">${fmt(r[k])}${edit && s && fmt(r[k]) !== fmt(s[k]) ? `<div class="source">saved ${fmt(s[k])}</div>` : ''}</td>`;
      return `<tr><td><span class="cell-main">${esc(r.year)}</span></td>${c('endLocations', fmtLoc)}${c('endArr', fmtMoney)}${c('revenue', fmtMoney)}${c('opIncome', fmtMoney)}</tr>`;
    }).join('');
    const tbl = table(`<tr><th>Year</th><th class="num">Locations, Dec</th><th class="num">ARR, Dec</th><th class="num">Revenue, year</th><th class="num">Operating income, year</th></tr>`, rows);
    const P = st.draft, churn = num((P.churn || {}).base), mRaw = (P.newMultiplier || {}).base, mult = mRaw == null ? 1 : num(mRaw);
    const r0 = (P.newPerMonth || {})[y] || [0, 0], avg = (num(r0[0]) + num(r0[1])) / 2;
    const how = `<p class="note">${edit ? 'Model of your draft' : 'Model of the saved plan'}, base case: it starts with ${fmtNum(num(P.pilots), 2)} paying pilot location${num(P.pilots) === 1 ? '' : 's'} in Jan ${esc(y)}. Each month the locations at the start of the month pay that year’s price, then ${fmtPct(churn, 2)} churn leaves and the year’s average new locations arrive (${fmtNum(avg * mult, 2)} a month in ${esc(y)}${Math.abs(mult - 1) > 1e-9 ? `, after the ${fmtNum(mult, 2)}× multiplier` : ''}). Every tab uses the same math.${edit ? ' Where your draft changes a figure, the saved plan’s model figure shows under it.' : ''}</p>`;
    return kp + tbl + how;
  }

  /* ---------- status text ---------- */
  function unsavedText() {
    const n = changesVs(ctx.plan()), b = badFields().length;
    const parts = [n ? plural(n, 'unsaved change') : 'No unsaved changes'];
    if (b) parts.push(`${plural(b, 'field needs', 'fields need')} a fix`);
    return parts.join(' · ');
  }
  function barText() {
    const D = summaryOf(st.draft), SV = savedSummary();
    if (!D.length) return esc(unsavedText());
    const d0 = D[0], s0 = SV.find(r => r.year === d0.year);
    return `<strong>${esc(unsavedText())}</strong> · Base case, Dec ${esc(d0.year)}: ${fmtLoc(d0.endLocations)} locations, ${fmtCompact(d0.endArr)} ARR${s0 ? ` <span class="muted">(saved plan: ${fmtLoc(s0.endLocations)}, ${fmtCompact(s0.endArr)})</span>` : ''}`;
  }
  function resetDisabled() { return docDiffs(ctx.plan()) === 0 && changesVs(ctx.plan()) === 0 && badFields().length === 0; }

  /* Update every live part of the page in place (no re-render, so the field being typed in keeps focus). */
  function refresh() {
    if (!st.draft) return;
    const n = changesVs(ctx.plan()), dirty = n > 0 || badFields().length > 0;
    st.fields.forEach(f => {
      const id = domId(f.key), err = errFor(f);
      const inp = document.getElementById(id);
      if (inp && inp.setAttribute) { if (err) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
      const e = document.getElementById(id + '-err'); if (e) { e.textContent = err; e.hidden = !err; }
      const c = document.getElementById(id + '-note'); if (c) c.innerHTML = chgHTML(f);
    });
    yearsOf(st.draft).forEach(y => {
      const a = document.getElementById(`${ID}-avg-${y}`); if (a) a.innerHTML = avgText(y);
      const o = document.getElementById(`${ID}-opex-${y}`); if (o) o.innerHTML = opexText(y);
    });
    const u = document.getElementById(`${ID}-unsaved`); if (u) u.textContent = unsavedText();
    const bt = document.getElementById(`${ID}-bar-text`); if (bt) bt.innerHTML = barText();
    const bar = document.getElementById(`${ID}-bar`); if (bar) bar.hidden = !dirty;
    [`${ID}-save`, `${ID}-bar-save`].forEach(s => { const b = document.getElementById(s); if (b) b.disabled = !n || st.saving; });
    const r = document.getElementById(`${ID}-reset`); if (r) r.disabled = resetDisabled() || st.saving;
    const p = document.getElementById(`${ID}-preview`); if (p) p.innerHTML = previewHTML();
  }

  /* ---------- sections ---------- */
  function pricingPanel(ys) {
    const body = table(yearHead('Price', ys), rowHTML('Price per location per month', 'ARR = locations × price × 12', ys.map(y => cell('prices.' + y))))
      + `<div class="calc-grid" style="margin-top:14px">`
      + scalar('setupFee', 'Setup fee, one-time ($)', 'Charged once at signing. Not part of ARR.')
      + scalar('pilotFee', '30-day pilot fee ($)', 'Charged once per paid pilot.')
      + scalar('pilots', 'Pilot locations', ys.length ? `The model starts with these paying in Jan ${ys[0]}.` : 'The model starts with these paying.')
      + `</div>`;
    return ui.panel({ title: 'Pricing', sub: 'What each location pays', body, cls: 'section' });
  }
  function growthPanel(ys) {
    const rows = rowHTML('New locations a month, low', 'A slow month', ys.map(y => cell(`newPerMonth.${y}.0`)))
      + rowHTML('New locations a month, high', 'A strong month', ys.map(y => cell(`newPerMonth.${y}.1`)))
      + `<tr><td><div class="cell-sub">Average a month: (low + high) ÷ 2, before the scenario multiplier</div></td>${ys.map(y => `<td class="num" id="${ID}-avg-${esc(y)}">${avgText(y)}</td>`).join('')}</tr>`;
    const srows = scenariosOf(st.draft).map(k => rowHTML(scenLabel(k), k === 'base' ? 'Drives every tab’s plan numbers' : 'Alternative case on Forecast', [cell('churn.' + k), cell('newMultiplier.' + k)])).join('');
    const body = table(yearHead('New locations', ys), rows)
      + `<div style="margin-top:14px">${table('<tr><th>Scenario</th><th class="num">Monthly churn (%)</th><th class="num">New-location multiplier (×)</th></tr>', srows)}</div>`
      + '<p class="note">Each scenario multiplies the average new locations a month by its multiplier, and loses its churn share of locations every month.</p>';
    return ui.panel({ title: 'Growth', sub: 'New locations and churn', body, cls: 'section' });
  }
  function costsPanel(ys) {
    const rows = rowHTML('Cost of service (%)', 'Share of revenue', ys.map(y => cell('costOfService.' + y)))
      + opexKeys(st.draft).map(k => rowHTML(`${opexLabel(k)} ($)`, 'Annual', ys.map(y => cell(`opex.${k}.${y}`)))).join('')
      + `<tr><td><div class="cell-main">Operating expenses, total</div><div class="cell-sub">Annual, then per month</div></td>${ys.map(y => `<td class="num" id="${ID}-opex-${esc(y)}">${opexText(y)}</td>`).join('')}</tr>`;
    return ui.panel({ title: 'Costs', sub: 'Cost of service and operating expenses by year', body: table(yearHead('Line', ys), rows), cls: 'section' });
  }
  function teamPanel(ys) {
    const rows = rowHTML('Team size', 'People', ys.map(y => cell('team.' + y)))
      + rowHTML('CAC per new location ($)', 'Cost to win one location', ys.map(y => cell('cac.' + y)));
    const body = table(yearHead('Line', ys), rows)
      + `<div class="calc-grid" style="margin-top:14px">`
      + scalar('hireSalesAtArr', 'Hire a salesperson at ARR of ($)', 'The first sales hire comes once ARR reaches this.')
      + scalar('startupCosts', 'Startup costs ($)', 'Founder-funded spending before revenue.')
      + `</div>`;
    return ui.panel({ title: 'Team & CAC', sub: 'People and the cost to win a location', body, cls: 'section' });
  }
  function targetsPanel() {
    const ts = Array.isArray(st.draft.targets) ? st.draft.targets : [];
    if (!ts.length) return ui.panel({ title: 'Targets', body: '<p class="note" style="margin-top:0">The plan has no dated targets. Reset to the projections doc to bring its targets back.</p>', cls: 'section' });
    const head = `<tr><th>Target</th><th>Date</th>${TARGET_COLS.map(c => `<th class="num">${esc(c[1])}</th>`).join('')}</tr>`;
    const rows = ts.map((t, i) => {
      const tt = t && typeof t === 'object' ? t : {};
      return `<tr><td style="vertical-align:top;padding-top:14px"><span class="cell-main">${esc(tt.label || 'Target')}</span></td><td style="vertical-align:top;padding-top:14px">${esc(ctx.fmtDate(tt.date) || tt.date || '')}</td>${TARGET_COLS.map(c => cell(`targets.${i}.${c[0]}`)).join('')}</tr>`;
    }).join('');
    return ui.panel({
      title: 'Targets', sub: 'Goals the other tabs measure against',
      body: table(head, rows) + '<p class="note">Labels and dates come from the projections doc. Revenue and operating income are totals for the calendar year that ends on the date.</p>',
      cls: 'section'
    });
  }
  function cashPanel() {
    const F = ctx.finance(), raw = ctx.get('settings', 'finance'), sc = asNum(ctx.plan().startupCosts);
    const row = (label, value, src) => `<div class="stat-row"><dt>${label}${src ? `<div class="source">${src}</div>` : ''}</dt><dd>${value}</dd></div>`;
    const rows = row('Opening cash', fmtPrice(round2(num(F.openingCash))))
      + row('As of', esc(longDate(F.openingDate)))
      + (F.note ? row('Note', esc(F.note)) : '');
    const notes = [];
    if (!raw) notes.push('Not set yet, so every tab uses this default.');
    if (sc != null && !same(sc, F.openingCash)) notes.push(`The plan’s startup costs are ${fmtMoney(sc)}.`);
    notes.push('Cash on every tab counts from this date: paid invoices in, expenses out. Expenses dated earlier are left out.');
    const body = `<dl class="stat-list">${rows}</dl><p class="note">${notes.join(' ')} <button class="link" type="button" data-act="go" data-view="cash">See today’s balance on Cash</button></p>`;
    const actions = ctx.canWrite() ? `<button class="btn btn-sm" type="button" data-act="mod" data-mod="${ID}" data-a="edit-cash">Edit</button>` : '';
    return ui.panel({ title: 'Cash starting point', sub: 'Where the cash balance starts', actions, body, cls: 'section' });
  }

  /* ---------- actions ---------- */
  /* Fields of the saved settings/plan doc that are not plan keys (setDoc replaces the whole doc, so keep them). */
  function savedRest() {
    const cur = Object.assign({}, ctx.get('settings', 'plan') || {});
    delete cur.id;
    Object.keys(ctx.PLAN_DEFAULTS).forEach(k => { delete cur[k]; });
    return cur;
  }
  async function save() {
    if (!ctx.canWrite() || st.saving || !st.draft) return;
    if (!changesVs(ctx.plan())) return;
    const bad = badFields();
    if (bad.length) {
      refresh();
      ctx.toast(`Fix ${plural(bad.length, 'field')} marked in red before saving.`, 'bad');
      const el = document.getElementById(domId(bad[0].key));
      if (el && el.focus) el.focus();
      return;
    }
    st.saving = true; refresh();
    const data = Object.assign(savedRest(), clone(st.draft), {
      source: `Edited in Dealbook on ${longDate(ctx.todayStr())} (based on the projections doc)`,
      updatedAt: ctx.iso(), updatedBy: ctx.me() || null
    });
    const ok = await ctx.setDoc('settings', 'plan', data);
    st.saving = false;
    if (ok) { ctx.toast('Assumptions saved'); dropDraft(); ctx.render(); }
    else refresh();
  }
  function reset() {
    if (!ctx.canWrite() || st.saving) return;
    const P = ctx.plan(), n = st.draft ? docDiffs(P) : 0, u = st.draft ? changesVs(P) : 0;
    let body = `Every tab goes back to the numbers in “${ctx.PLAN_DEFAULTS.source}”.`;
    if (n) body += ` This replaces ${plural(n, 'saved value')} that differ from the doc.`;
    if (u) body += ` Your ${plural(u, 'unsaved change')} will be discarded too.`;
    ctx.openConfirm('Reset the plan to the projections doc?', body, 'Reset to the doc', async () => {
      st.saving = true;
      const ok = await ctx.setDoc('settings', 'plan', Object.assign(savedRest(), clone(ctx.PLAN_DEFAULTS), { updatedAt: ctx.iso(), updatedBy: ctx.me() || null }));
      st.saving = false;
      if (ok) { ctx.toast('Plan reset to the projections doc'); dropDraft(); }
      ctx.render();
    });
  }
  function editCash() {
    if (!ctx.canWrite()) return;
    const F = ctx.finance();
    ctx.openFormModal({
      title: 'Cash starting point',
      body: `<div class="row2">${ctx.F.money(`${ID}-cash-amount`, 'Opening cash ($)', round2(num(F.openingCash)))}${ctx.F.date(`${ID}-cash-date`, 'As of', F.openingDate)}</div>
        <p class="note">The cash you had in the bank on that date. Cash, Overview and runway count paid invoices and expenses from here.</p>`,
      submitLabel: 'Save',
      onSubmit: async () => {
        const rawAmt = ctx.val(`${ID}-cash-amount`);
        if (!rawAmt) return ctx.formErr('Enter the opening cash, like 3500.', `${ID}-cash-amount`);
        const openingCash = ctx.parseMoney(rawAmt);
        if (openingCash === null) return ctx.formErr('Enter the opening cash as dollars, like 3500.', `${ID}-cash-amount`);
        const openingDate = ctx.val(`${ID}-cash-date`);
        if (!ctx.parseYmd(openingDate)) return ctx.formErr('Pick the date that balance was in the bank.', `${ID}-cash-date`);
        const cur = Object.assign({}, ctx.get('settings', 'finance') || {});
        delete cur.id;
        const ok = await ctx.setDoc('settings', 'finance', Object.assign(cur, { openingCash, openingDate, updatedAt: ctx.iso() }));
        if (ok) ctx.toast('Cash starting point saved');
        return ok;
      }
    });
  }

  /* ---------- module ---------- */
  return {
    id: ID,
    label: 'Assumptions',
    group: 'Planning',
    order: 60,
    collections: [],
    badge() {
      if (!st.draft || !ctx.canWrite()) return null;
      ensureDraft();
      const n = changesVs(ctx.plan());
      return n ? { text: String(n), title: `${plural(n, 'unsaved change')} to the plan` } : null;
    },
    render() {
      if (ctx.isLoading()) return ui.toolbar({ title: 'Assumptions' }) + '<div class="empty"><p>Loading your plan…</p></div>';
      ensureDraft();
      const P = ctx.plan(), edit = ctx.canWrite(), ys = yearsOf(st.draft);
      const n = changesVs(P), dirty = n > 0 || badFields().length > 0;
      const actions = edit
        ? `<button class="btn btn-sm" type="button" id="${ID}-reset" data-act="mod" data-mod="${ID}" data-a="reset"${resetDisabled() || st.saving ? ' disabled' : ''}>Reset to the projections doc</button>`
          + `<button class="btn btn-sm btn-primary" type="button" id="${ID}-save" data-act="mod" data-mod="${ID}" data-a="save"${!n || st.saving ? ' disabled' : ''}>Save changes</button>`
        : '';
      const head = ui.toolbar({ title: 'Assumptions', exportable: true, actions });

      const diffs = docDiffs(P), saved = ctx.get('settings', 'plan');
      let savedLine = '';
      if (saved && saved.updatedAt) savedLine = ` Last saved ${esc(ctx.relTime(saved.updatedAt))}${saved.updatedBy ? ` by ${esc(ctx.personName(saved.updatedBy))}` : ''}.`;
      else if (!saved) savedLine = ' Nothing has been saved here yet.';
      const status = `<div class="section">
        <p class="note" style="margin-top:0">Source: <strong>${esc(P.source || 'Not named')}</strong>. ${diffs ? `${ui.chip('Edited', 'accent')} ${plural(diffs, 'value differs', 'values differ')} from the projections doc.` : `${ui.chip('Matches the doc', 'good')} Every value matches the projections doc.`}${savedLine}</p>
        <p class="note">${edit ? `<span id="${ID}-unsaved" aria-live="polite">${esc(unsavedText())}</span> · Edits stay in this draft until you save. Every tab then uses the new plan.` : 'You can view the plan but not change it.'}</p>
      </div>`;
      const conflict = st.conflict && edit
        ? `<div class="notice warn" style="margin-bottom:14px"><span><strong>The saved plan changed while you were editing.</strong> Saving now replaces it with your draft.</span><span class="spacer"></span><button class="btn btn-sm" type="button" data-act="mod" data-mod="${ID}" data-a="discard">Load the saved plan</button></div>`
        : '';
      if (!ys.length) {
        return head + status + ui.empty({
          title: 'No plan years to edit',
          text: 'The plan has no prices by year, so there is nothing to model. Reset to the projections doc to load its three years.',
          action: edit ? `<button class="btn btn-primary" type="button" data-act="mod" data-mod="${ID}" data-a="reset">Reset to the projections doc</button>` : ''
        }) + cashPanel();
      }
      const preview = ui.panel({
        title: 'Live preview',
        sub: edit ? 'Base case model from your draft, next to the saved plan' : 'Base case model from the saved plan',
        body: `<div id="${ID}-preview">${previewHTML()}</div>`,
        cls: 'section'
      });
      const bar = edit
        ? `<div id="${ID}-bar" style="position:sticky;bottom:12px;z-index:5"${dirty ? '' : ' hidden'}><div class="panel" style="display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;box-shadow:var(--shadow)">
            <span id="${ID}-bar-text" style="font-size:14px;min-width:0">${barText()}</span><span style="flex:1"></span>
            <button class="btn btn-sm" type="button" data-act="mod" data-mod="${ID}" data-a="discard">Discard edits</button>
            <button class="btn btn-sm btn-primary" type="button" id="${ID}-bar-save" data-act="mod" data-mod="${ID}" data-a="save"${!n || st.saving ? ' disabled' : ''}>Save changes</button>
          </div></div>`
        : '';
      const editor = `<div>${preview}${pricingPanel(ys)}${growthPanel(ys)}${costsPanel(ys)}${teamPanel(ys)}${targetsPanel()}${bar}</div>`;
      return head + status + conflict + editor + cashPanel();
    },
    onAction(a) {
      if (a === 'save') save();
      else if (a === 'reset') reset();
      else if (a === 'discard') { dropDraft(); ctx.render(); }
      else if (a === 'edit-cash') editCash();
    },
    onInput(key, el) {
      if (!ctx.canWrite() || !st.draft || !el) return;
      const f = st.byKey[key];
      if (!f) return;
      const raw = String(el.value == null ? '' : el.value);
      st.text[key] = raw;
      const r = parseIn(f, raw);
      if (r.msg) st.bad[key] = r.msg;
      else { delete st.bad[key]; setPath(st.draft, f.path, r.v); }
      refresh();
    },
    csv() {
      const P = ctx.plan(), D = ctx.PLAN_DEFAULTS, rows = [['Key', 'Value', 'Plan doc value']], seen = {};
      const cellOf = v => (v == null || typeof v === 'object' ? '' : typeof v === 'number' ? (isFinite(v) ? v : '') : typeof v === 'boolean' ? String(v) : String(v));
      const walk = (o, path, fn) => {
        if (o != null && typeof o === 'object') (Array.isArray(o) ? o.map((_, i) => i) : Object.keys(o)).forEach(k => walk(o[k], path.concat([k]), fn));
        else fn(path, o);
      };
      walk(P, [], (path, v) => { const k = keyOf(path); seen[k] = true; rows.push([k, cellOf(v), cellOf(getPath(D, path))]); });
      walk(D, [], (path, v) => { const k = keyOf(path); if (!seen[k]) rows.push([k, '', cellOf(v)]); });
      const F = ctx.finance(), FD = ctx.FIN_DEFAULTS || {};
      rows.push(['finance.openingCash', num(F.openingCash), cellOf(FD.openingCash)]);
      rows.push(['finance.openingDate', String(F.openingDate || ''), cellOf(FD.openingDate)]);
      return { name: 'plan-assumptions', rows };
    }
  };
});
