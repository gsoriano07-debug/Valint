(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Market tab: TAM / SAM / SOM from the user's market segments, priced at a per-location monthly price,
     and how much of the market each plan target needs. Segment doc:
     {name, count (locations, may be null), inTarget, notes, source, order, createdAt, createdBy}. */
  const ID = 'market';
  const esc = ctx.esc;

  // The two segments the business plan names. Offered only on the empty state, as a one-click start.
  const SUGGESTED = [
    { name: 'New York licensed adult-use dispensaries', count: 623, inTarget: true, notes: 'Licensed adult-use dispensaries as of Mar 31, 2026', source: 'Business plan' },
    { name: 'U.S. dispensaries', count: 15000, inTarget: false, notes: 'About 15,000 nationwide', source: 'Business plan' }
  ];

  // Closure state: what the founder typed into the calculators (null = use the plan default).
  const st = { price: null, priceRaw: null, goal: null, goalRaw: null, busy: false };

  /* ---------- data ---------- */
  const hasCount = s => !!s && s.count !== null && s.count !== undefined && s.count !== '' && isFinite(Number(s.count)) && Number(s.count) >= 0;
  const countOf = s => (hasCount(s) ? Number(s.count) : 0);
  const segName = s => String((s && s.name) || '').trim() || 'Unnamed segment';
  function segments() {
    return ctx.all('segments').slice().sort((a, b) =>
      (ctx.num(a.order) - ctx.num(b.order)) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      segName(a).localeCompare(segName(b)));
  }
  const maxOrder = () => ctx.all('segments').reduce((m, s) => Math.max(m, ctx.num(s.order)), 0);
  function targets() {
    return (ctx.plan().targets || [])
      .filter(t => t && t.locations != null && isFinite(Number(t.locations)))
      .slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  }
  const planPrice = () => ctx.priceFor('2027-01-01');
  const price = () => (st.price == null ? planPrice() : st.price);
  function defaultGoal(z) {
    const last = z.last;
    return last && ctx.num(last.arr) > 0 ? ctx.num(last.arr) : Math.round(z.som);
  }
  const goal = z => (st.goal == null ? defaultGoal(z) : st.goal);

  function sizes(p) {
    const segs = segments();
    const sized = segs.filter(hasCount), unsized = segs.filter(s => !hasCount(s));
    const target = sized.filter(s => s.inTarget);
    const tamLocs = ctx.sum(sized, countOf), samLocs = ctx.sum(target, countOf);
    const ts = targets(), last = ts.length ? ts[ts.length - 1] : null;
    const somLocs = last ? ctx.num(last.locations) : 0;
    const yr = p * 12;
    return {
      segs, sized, unsized, target, ts, last, tamLocs, samLocs, somLocs,
      tam: tamLocs * yr, sam: samLocs * yr, som: somLocs * yr,
      pen: last && samLocs > 0 ? somLocs / samLocs : null
    };
  }

  /* ---------- formatting ---------- */
  const DASH = '—';
  const pct = x => (x == null || !isFinite(x) ? DASH : ctx.fmtPct(x, x > 0 && x < 0.01 ? 2 : 1));
  const share = (n, of) => (of > 0 ? n / of : null);
  const locTxt = n => ctx.fmtNum(n) + (n === 1 ? ' location' : ' locations');
  const perMo = p => ctx.fmtPrice(p) + '/mo';
  const lc = label => esc(String(label || 'final').replace(/^./, c => c.toLowerCase()));
  function parseAmount(raw) { // '' -> 'empty'; invalid -> null; else a number >= 0
    const s = String(raw == null ? '' : raw).replace(/[$,\s]/g, '');
    if (!s) return 'empty';
    const n = Number(s);
    return isFinite(n) && n >= 0 ? n : null;
  }
  // Every number that depends on the price or the goal, keyed by element id, so render() and the
  // in-place refresh can never disagree.
  function figures(p, z) {
    const g = goal(z), yr = p * 12;
    const need = yr > 0 ? Math.ceil(g / yr) : null;
    const f = {
      'market-tam': z.sized.length ? ctx.fmtCompact(z.tam) : DASH,
      'market-sam': z.target.length ? ctx.fmtCompact(z.sam) : DASH,
      'market-som': z.last ? ctx.fmtCompact(z.som) : DASH,
      'market-pen': pct(z.pen),
      'market-tam-full': ctx.fmtMoney(z.tam),
      'market-tam-row': z.sized.length ? ctx.fmtCompact(z.tam) : DASH,
      'market-sam-full': ctx.fmtMoney(z.sam),
      'market-som-full': ctx.fmtMoney(z.som),
      'market-tam-calc': `${ctx.fmtNum(z.tamLocs)} × ${ctx.fmtPrice(p)} × 12`,
      'market-sam-calc': `${ctx.fmtNum(z.samLocs)} × ${ctx.fmtPrice(p)} × 12`,
      'market-som-calc': `${ctx.fmtNum(z.somLocs)} × ${ctx.fmtPrice(p)} × 12`,
      'market-price-shown': perMo(p),
      'market-tgt-rev-h': 'Annual revenue at ' + perMo(p),
      'market-seg-rev-h': 'Annual revenue at ' + perMo(p),
      'market-goal-locs': need == null ? DASH : ctx.fmtNum(need),
      'market-goal-sam': need == null ? DASH : pct(share(need, z.samLocs)),
      'market-goal-tam': need == null ? DASH : pct(share(need, z.tamLocs)),
      'market-goal-vs': need == null || !z.last ? DASH
        : need === z.somLocs ? `Same as the ${lc(z.last.label)} target`
        : `${ctx.fmtNum(Math.abs(need - z.somLocs))} ${need > z.somLocs ? 'more' : 'fewer'} than the ${lc(z.last.label)} target of ${ctx.fmtNum(z.somLocs)}`
    };
    z.ts.forEach((t, i) => { f['market-tgt-' + i + '-rev'] = ctx.fmtCompact(ctx.num(t.locations) * yr); });
    f['market-tgt-now-rev'] = ctx.fmtCompact(nowLocs() * yr);
    z.segs.forEach(s => { f['market-seg-' + s.id + '-rev'] = hasCount(s) ? ctx.fmtCompact(countOf(s) * yr) : DASH; });
    return f;
  }
  const nowLocs = () => ctx.locationsOn(ctx.todayStr());
  function refresh() {
    const p = price(), z = sizes(p), f = figures(p, z);
    Object.keys(f).forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = f[id]; });
    // When the goal is the default and the last target has no ARR, the default (SOM revenue) moves with the price:
    // keep the goal field showing the number the results use.
    const gi = document.getElementById('market-goal');
    if (gi && st.goal == null && st.goalRaw == null && document.activeElement !== gi) gi.value = ctx.fmtNum(Math.round(goal(z)));
    const yrs = ctx.planYears();
    yrs.forEach(y => { const b = document.getElementById('market-py-' + y); if (b) b.setAttribute('aria-pressed', String(Math.abs(ctx.priceFor(y + '-01-01') - p) < 0.005)); });
  }

  /* ---------- writes ---------- */
  async function seed() {
    if (st.busy || !ctx.canWrite()) return;
    st.busy = true;
    try {
      const have = new Set(ctx.all('segments').map(s => String(s.name || '').trim().toLowerCase()));
      let order = maxOrder(), added = 0;
      for (const s of SUGGESTED) {
        if (have.has(s.name.toLowerCase())) continue;
        const id = await ctx.create('segments', Object.assign({}, s, { order: ++order, createdAt: ctx.iso(), createdBy: ctx.me() }));
        if (!id) break;
        added++;
      }
      if (added) ctx.toast(added === SUGGESTED.length ? 'Added the two segments from the business plan' : `Added ${added} segment${added === 1 ? '' : 's'} from the business plan`);
    } finally { st.busy = false; }
  }
  async function toggleTarget(id) {
    const s = ctx.get('segments', id);
    if (!s || !ctx.canWrite()) return;
    const on = !s.inTarget;
    if (await ctx.patch('segments', id, { inTarget: on, updatedAt: ctx.iso() })) {
      ctx.toast(!on ? `${segName(s)} no longer counts toward SAM`
        : hasCount(s) ? `${segName(s)} now counts toward SAM`
        : `${segName(s)} is in the target market. Add a location count to include it in SAM.`);
    }
  }
  function confirmDelete(id) {
    const s = ctx.get('segments', id);
    if (!s || !ctx.canWrite()) return;
    ctx.openConfirm('Delete this segment?',
      `${segName(s)}${hasCount(s) ? ` (${locTxt(countOf(s))})` : ''} will leave your market sizing. This can't be undone.`,
      'Delete segment',
      async () => { if (await ctx.remove('segments', id)) ctx.toast('Deleted ' + segName(s)); });
  }
  function openForm(id) {
    const s = id ? ctx.get('segments', id) : null;
    if (id && !s) return;
    const F = ctx.F;
    ctx.openFormModal({
      title: s ? 'Edit market segment' : 'New market segment',
      submitLabel: s ? 'Save segment' : 'Add segment',
      body:
        F.text('market-f-name', 'Segment name', s ? s.name : '', 'required maxlength="120" autocomplete="off" placeholder="e.g. New Jersey licensed dispensaries"') +
        F.number('market-f-count', 'Number of locations', s && hasCount(s) ? countOf(s) : '', 'min="0" step="1" inputmode="numeric" placeholder="Leave empty if not known yet"') +
        F.check('market-f-target', 'In our target market (counts toward SAM)', s ? !!s.inTarget : false) +
        F.area('market-f-notes', 'Notes', s ? s.notes : '', 2) +
        F.text('market-f-source', 'Source', s ? s.source : '', 'maxlength="200" placeholder="Where the count comes from"'),
      deleteLabel: s ? 'Delete segment' : undefined,
      onDelete: s ? () => confirmDelete(s.id) : undefined,
      onSubmit: async () => {
        const name = ctx.val('market-f-name');
        if (!name) return ctx.formErr('Name the segment.', 'market-f-name');
        const countEl = document.getElementById('market-f-count');
        if (countEl && countEl.validity && countEl.validity.badInput) return ctx.formErr('Enter the number of locations as a number, or leave it empty.', 'market-f-count');
        const raw = ctx.val('market-f-count').replace(/[,\s]/g, '');
        let count = null;
        if (raw) {
          const n = Number(raw);
          if (!isFinite(n) || n < 0) return ctx.formErr('Enter the number of locations as 0 or more, or leave it empty.', 'market-f-count');
          count = Math.round(n);
        }
        const tEl = document.getElementById('market-f-target');
        const data = { name, count, inTarget: !!(tEl && tEl.checked), notes: ctx.val('market-f-notes'), source: ctx.val('market-f-source') };
        if (s) return await ctx.patch('segments', s.id, Object.assign(data, { updatedAt: ctx.iso() }));
        const newId = await ctx.create('segments', Object.assign(data, { order: maxOrder() + 1, createdAt: ctx.iso(), createdBy: ctx.me() }));
        if (newId) ctx.toast('Added ' + name);
        return !!newId;
      }
    });
  }

  /* ---------- render pieces ---------- */
  const btn = (a, label, extra, cls) => `<button class="btn btn-sm ${cls || ''}" type="button" data-act="mod" data-mod="${ID}" data-a="${a}" ${extra || ''}>${label}</button>`;
  function priceControls(p) {
    const yrs = ctx.planYears();
    const seg = yrs.length ? `<div class="seg" role="group" aria-label="Use a plan price">${yrs.map(y => {
      const v = ctx.priceFor(y + '-01-01');
      return `<button type="button" id="market-py-${y}" data-act="mod" data-mod="${ID}" data-a="price" data-price="${v}" aria-pressed="${Math.abs(v - p) < 0.005}" title="Plan price for ${y}: ${ctx.fmtPrice(v)} per location per month">${y} · ${ctx.fmtPrice(v)}</button>`;
    }).join('')}</div>` : '';
    const raw = st.priceRaw != null ? st.priceRaw : String(p);
    return `<label for="market-price" class="muted" style="font-size:13px">Price per location per month</label>
      <input class="input mono" id="market-price" data-mod-input="${ID}" data-key="price" inputmode="decimal" autocomplete="off" style="width:96px" value="${esc(raw)}" aria-describedby="market-price-err">
      ${seg}<span id="market-price-err" class="neg" style="font-size:13px" hidden>Enter a price of 0 or more.</span>`;
  }
  function head(z, loading, p) {
    return ctx.ui.toolbar({
      title: 'Market',
      count: loading ? null : `${z.segs.length} segment${z.segs.length === 1 ? '' : 's'}`,
      filters: loading || !z.segs.length ? '' : priceControls(p),
      exportable: !loading && z.segs.length > 0,
      actions: ctx.canWrite() ? btn('new', 'Add segment', '', 'btn-primary') : ''
    });
  }
  function emptyState(z, p) {
    const last = z.last;
    const somLine = last
      ? ` Your ${String(last.label || 'final').replace(/^./, c => c.toLowerCase())} plan target is ${locTxt(ctx.num(last.locations))}, worth ${ctx.fmtCompact(ctx.num(last.locations) * p * 12)} a year at ${ctx.fmtPrice(p)} per location per month.`
      : '';
    const text = 'Add the groups of stores you could sell to, with a location count for each. This tab turns them into TAM, SAM and SOM and shows how much of the market each plan target needs.' + somLine +
      ' The business plan names two segments: New York licensed adult-use dispensaries (623 as of Mar 31, 2026) and U.S. dispensaries (about 15,000).' +
      (ctx.canWrite() ? '' : ' Someone with edit access can add them.');
    const action = ctx.canWrite()
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn btn-primary" type="button" data-act="mod" data-mod="${ID}" data-a="seed">Add these two</button><button class="btn" type="button" data-act="mod" data-mod="${ID}" data-a="new">Add a different segment</button></div>`
      : '';
    return ctx.ui.empty({ title: 'Size the market you sell into', text, action });
  }
  function kpiRow(z, f) {
    const ui = ctx.ui;
    const last = z.last;
    const tamSub = z.sized.length ? `${locTxt(z.tamLocs)} · every sized segment` : 'No segment has a location count yet';
    const samSub = z.target.length ? `${locTxt(z.samLocs)} · ${z.target.length} target segment${z.target.length === 1 ? '' : 's'}` : (z.sized.length ? 'Mark a sized segment as in target' : 'Size a target segment first');
    const somSub = last ? `${locTxt(z.somLocs)} · ${esc(last.label || 'final')} plan target` : 'Add plan targets on the Assumptions tab';
    const penSub = z.pen == null
      ? (last ? 'Needs a sized target segment' : 'Needs a plan target')
      : `${ctx.fmtNum(z.somLocs)} of ${ctx.fmtNum(z.samLocs)} target locations`;
    const tone = z.pen == null ? '' : z.pen > 1 ? 'bad' : z.pen > 0.5 ? 'warn' : '';
    return `<section class="kpis">
      ${ui.kpi({ label: 'TAM · total market', value: `<span id="market-tam">${f['market-tam']}</span>`, sub: tamSub })}
      ${ui.kpi({ label: 'SAM · target market', value: `<span id="market-sam">${f['market-sam']}</span>`, sub: samSub })}
      ${ui.kpi({ label: 'SOM · plan target', value: `<span id="market-som">${f['market-som']}</span>`, sub: somSub })}
      ${ui.kpi({ label: 'Penetration needed', value: `<span id="market-pen">${f['market-pen']}</span>`, sub: penSub, tone, bar: z.pen == null ? '' : `<div style="margin-top:8px">${ui.progress(Math.min(1, z.pen), tone)}</div>` })}
    </section>`;
  }
  function unsizedNote(z) {
    if (!z.unsized.length) return '';
    const list = z.unsized.map(s => `${esc(segName(s))}${s.inTarget ? ' · in target' : ''}`).join(', ');
    return `<p class="note section" id="market-unsized">Not sized yet, so left out of TAM and SAM: ${list}. Add a location count to include ${z.unsized.length === 1 ? 'it' : 'them'}.</p>`;
  }
  function chartPanel(z, f, p) {
    const chart = ctx.chart.bars({
      labels: ['TAM', 'SAM', 'SOM'],
      series: [{ name: 'Annual revenue', values: [z.tam, z.sam, z.som], color: 'var(--viz-1)' }],
      height: 220,
      format: ctx.fmtCompact,
      ariaLabel: `Annual revenue at ${ctx.fmtPrice(p)} per location per month: TAM ${ctx.fmtCompact(z.tam)}, SAM ${ctx.fmtCompact(z.sam)}, SOM ${ctx.fmtCompact(z.som)}`
    });
    const row = (k, label) => `<div class="stat-row"><dt>${label} <span class="source" id="market-${k}-calc">${f['market-' + k + '-calc']}</span></dt><dd id="market-${k}-full">${f['market-' + k + '-full']}</dd></div>`;
    const body = `${chart}<dl class="stat-list" style="margin-top:12px">${row('tam', 'TAM')}${row('sam', 'SAM')}${row('som', 'SOM')}</dl>
      <p class="note">Locations × price per month × 12. The chart redraws when you leave the price field.</p>`;
    return ctx.ui.panel({ title: 'Annual revenue by market size', body });
  }
  function goalPanel(z, f) {
    const g = goal(z);
    const raw = st.goalRaw != null ? st.goalRaw : ctx.fmtNum(Math.round(g));
    const src = st.goal == null && z.last && ctx.num(z.last.arr) > 0 ? `Starts at the ${lc(z.last.label)} plan ARR.` : '';
    const body = `<div class="calc-grid">
        <div class="field"><label for="market-goal">Annual revenue goal</label><input class="input mono" id="market-goal" data-mod-input="${ID}" data-key="goal" inputmode="decimal" autocomplete="off" value="${esc(raw)}" aria-describedby="market-goal-err"><span class="hint">${src}</span></div>
      </div>
      <span id="market-goal-err" class="neg" style="font-size:13px" hidden>Enter an amount of 0 or more.</span>
      <dl class="stat-list" style="margin-top:12px">
        <div class="stat-row"><dt>Price used</dt><dd id="market-price-shown">${f['market-price-shown']}</dd></div>
        <div class="stat-row total"><dt>Paying locations needed</dt><dd id="market-goal-locs">${f['market-goal-locs']}</dd></div>
        <div class="stat-row"><dt>Share of SAM</dt><dd id="market-goal-sam">${f['market-goal-sam']}</dd></div>
        <div class="stat-row"><dt>Share of TAM</dt><dd id="market-goal-tam">${f['market-goal-tam']}</dd></div>
        <div class="stat-row"><dt>Against the plan</dt><dd id="market-goal-vs" style="font-family:var(--f-body)">${f['market-goal-vs']}</dd></div>
      </dl>
      <p class="note">Locations needed = goal ÷ (price × 12), rounded up. Setup and pilot fees are left out.</p>`;
    return ctx.ui.panel({ title: 'Locations needed for a revenue goal', body });
  }
  function targetPanel(z, f) {
    const samH = z.samLocs > 0 ? `% of SAM <span class="muted">(${ctx.fmtNum(z.samLocs)})</span>` : '% of SAM';
    const tamH = z.tamLocs > 0 ? `% of TAM <span class="muted">(${ctx.fmtNum(z.tamLocs)})</span>` : '% of TAM';
    const now = nowLocs();
    const tr = (label, date, n, revId) => `<tr>
        <td><div class="cell-main">${label}</div>${date ? `<div class="cell-sub">${esc(ctx.fmtDate(date))}</div>` : ''}</td>
        <td class="num">${ctx.fmtNum(n)}</td>
        <td class="num" title="${z.samLocs > 0 ? `${ctx.fmtNum(n)} of ${ctx.fmtNum(z.samLocs)} target locations` : 'No sized target segment'}">${pct(share(n, z.samLocs))}</td>
        <td class="num">${pct(share(n, z.tamLocs))}</td>
        <td class="num" id="${revId}">${f[revId]}</td></tr>`;
    const rows = tr('Today · active customers', ctx.todayStr(), now, 'market-tgt-now-rev') +
      z.ts.map((t, i) => tr(esc(t.label || 'Target'), t.date, ctx.num(t.locations), 'market-tgt-' + i + '-rev')).join('');
    const names = z.target.map(s => esc(segName(s))).join(', ');
    const ex = z.ts.find(t => t.date === ctx.planTarget().end) || z.ts[0];
    const exLine = ex && z.samLocs > 0 && z.target.length
      ? ` For example, the ${lc(ex.label)} target: ${ctx.fmtNum(ex.locations)} ÷ ${ctx.fmtNum(z.samLocs)} = ${pct(share(ctx.num(ex.locations), z.samLocs))} of ${z.target.length === 1 ? names : 'your target locations'}.`
      : '';
    const note = z.target.length
      ? `SAM is the ${locTxt(z.samLocs)} in your target segments: ${names}.${exLine}`
      : 'Mark a sized segment as in target to see the share of SAM each target needs.';
    const body = z.ts.length || now
      ? `<div class="table-wrap flat"><table class="compact"><thead><tr><th>Milestone</th><th class="num">Locations</th><th class="num">${samH}</th><th class="num">${tamH}</th><th class="num" id="market-tgt-rev-h">${f['market-tgt-rev-h']}</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">${note}</p>`
      : '<p class="note">The plan has no location targets yet. Add them on the Assumptions tab.</p>';
    return ctx.ui.panel({ title: 'Penetration by plan target', sub: 'From the plan on the Assumptions tab', body, cls: 'section' });
  }
  function segmentPanel(z, f) {
    const w = ctx.canWrite();
    const list = z.segs.filter(s => ctx.matches(s.name, s.notes, s.source));
    const row = s => {
      const id = esc(s.id);
      const sized = hasCount(s);
      return `<tr>
        <td><div class="cell-main">${esc(segName(s))}</div></td>
        <td class="num">${sized ? ctx.fmtNum(countOf(s)) : ctx.ui.chip('Not sized', 'warn')}</td>
        <td class="num">${sized ? pct(share(countOf(s), z.tamLocs)) : DASH}</td>
        <td class="num" id="market-seg-${id}-rev">${f['market-seg-' + s.id + '-rev']}</td>
        <td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${s.inTarget ? ctx.ui.chip('In target', 'accent') : ctx.ui.chip('Outside target')}${w ? btn('toggle', s.inTarget ? 'Remove' : 'Add to target', `data-id="${id}" aria-label="${s.inTarget ? 'Remove' : 'Add'} ${esc(segName(s))} ${s.inTarget ? 'from' : 'to'} the target market"`, 'btn-ghost') : ''}</div></td>
        <td style="max-width:280px">${s.notes ? esc(s.notes) : '<span class="muted">—</span>'}</td>
        <td>${s.source ? `<span class="source">${esc(s.source)}</span>` : '<span class="muted">—</span>'}</td>
        ${w ? `<td><div class="row-actions">${btn('edit', 'Edit', `data-id="${id}" aria-label="Edit ${esc(segName(s))}"`, 'btn-ghost')}${btn('delete', 'Delete', `data-id="${id}" aria-label="Delete ${esc(segName(s))}"`, 'btn-ghost btn-danger')}</div></td>` : ''}
      </tr>`;
    };
    const cols = w ? 8 : 7;
    const bodyRows = list.length ? list.map(row).join('') : `<tr><td colspan="${cols}" class="muted">No segments match your search.</td></tr>`;
    const sizedTotal = z.sized.length ? `<tr><td><div class="cell-main">All sized segments (TAM)</div></td><td class="num">${ctx.fmtNum(z.tamLocs)}</td><td class="num">100%</td><td class="num" id="market-tam-row">${f['market-tam-row']}</td><td colspan="${cols - 4}"></td></tr>` : '';
    const body = `<div class="table-wrap flat"><table class="compact"><thead><tr><th>Segment</th><th class="num">Locations</th><th class="num">Share of TAM</th><th class="num" id="market-seg-rev-h">${f['market-seg-rev-h']}</th><th>Target market</th><th>Notes</th><th>Source</th>${w ? '<th><span class="muted" style="font-weight:400">Actions</span></th>' : ''}</tr></thead><tbody>${bodyRows}${ctx.S.q ? '' : sizedTotal}</tbody></table></div>`;
    return ctx.ui.panel({
      title: 'Segments',
      sub: `${z.sized.length} sized · ${z.unsized.length} not sized yet`,
      actions: w ? btn('new', 'Add segment') : '',
      body, cls: 'section'
    });
  }

  return {
    id: ID,
    label: 'Market',
    group: 'Planning',
    order: 30,
    collections: ['segments'],
    newItems: [{ label: 'Market segment', a: 'new' }],
    render() {
      const loading = ctx.isLoading();
      const p = price();
      const z = sizes(p);
      if (loading) return head(z, true, p) + '<div class="empty"><p>Loading market segments…</p></div>';
      if (!z.segs.length) return head(z, false, p) + emptyState(z, p);
      const f = figures(p, z);
      return head(z, false, p) +
        kpiRow(z, f) +
        unsizedNote(z) +
        `<div class="grid grid-2 section">${chartPanel(z, f, p)}${goalPanel(z, f)}</div>` +
        targetPanel(z, f) +
        segmentPanel(z, f);
    },
    onAction(a, data) {
      if (a === 'new') return openForm(null);
      if (a === 'edit') return openForm(data.id);
      if (a === 'delete') return confirmDelete(data.id);
      if (a === 'toggle') return toggleTarget(data.id);
      if (a === 'seed') return seed();
      if (a === 'price') {
        const v = Number(data.price);
        if (!isFinite(v) || v < 0) return;
        st.price = Math.abs(v - planPrice()) < 0.005 ? null : v;
        st.priceRaw = null;
        ctx.render();
      }
    },
    onInput(key, el, ev) {
      if (key !== 'price' && key !== 'goal') return;
      const v = parseAmount(el.value);
      const err = document.getElementById(key === 'price' ? 'market-price-err' : 'market-goal-err');
      if (v === null) {
        if (err) err.hidden = false;
        el.setAttribute('aria-invalid', 'true');
        return;
      }
      if (err) err.hidden = true;
      el.removeAttribute('aria-invalid');
      const committed = !!ev && ev.type === 'change';
      if (key === 'price') { st.price = v === 'empty' ? null : v; st.priceRaw = v === 'empty' && committed ? null : el.value; }
      else { st.goal = v === 'empty' ? null : v; st.goalRaw = v === 'empty' ? null : el.value; }
      refresh();
      // The chart is drawn by the core on render; redraw it once the edit is committed, not per keystroke.
      // A blur from clicking a button fires 'change' on mousedown; re-rendering at once would replace that
      // button before mouseup and swallow the click, so wait until the click has landed.
      if (committed) setTimeout(() => ctx.render(), 300);
    },
    csv() {
      const p = price(), z = sizes(p);
      const rows = [['Segment', 'Locations', 'In target market', 'Share of sized locations', 'Price per location per month', 'Annual revenue (locations x price x 12)', 'Notes', 'Source', 'Created']];
      z.segs.forEach(s => {
        const sized = hasCount(s);
        rows.push([segName(s), sized ? countOf(s) : '', s.inTarget ? 'Yes' : 'No',
          sized && z.tamLocs > 0 ? Math.round(countOf(s) / z.tamLocs * 10000) / 10000 : '',
          p, sized ? countOf(s) * p * 12 : '', String(s.notes || ''), String(s.source || ''), ctx.isoToYmd(s.createdAt) || '']);
      });
      return { name: 'market-segments', rows };
    }
  };
});
