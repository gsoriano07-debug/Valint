(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Milestones tab: company milestones with live progress against actuals. Milestone doc:
     {title, targetDate, metric:'none'|'locations'|'arr'|'mrr'|'cash', targetValue|null,
      status:'not-started'|'in-progress'|'done', doneAt|null, notes, source, order, createdAt, createdBy}.
     Metric milestones read today's paying locations, MRR, ARR (MRR x 12) or cash from the actuals. */
  const ID = 'milestones';
  const esc = ctx.esc;
  const DASH = '—';
  const SOURCE = 'Three-Year Financial Projections';
  const METRICS = [
    ['none', 'Nothing (mark it done by hand)'],
    ['locations', 'Paying locations'],
    ['arr', 'ARR'],
    ['mrr', 'MRR'],
    ['cash', 'Cash in the bank']
  ];
  const STATUSES = [['not-started', 'Not started'], ['in-progress', 'In progress'], ['done', 'Done']];
  const NOW_LABEL = { locations: 'Paying locations now', arr: 'ARR now', mrr: 'MRR now', cash: 'Cash now' };
  const TARGET_LABEL = { none: 'Target value', locations: 'Target paying locations', arr: 'Target ARR ($)', mrr: 'Target MRR ($)', cash: 'Target cash ($)' };

  // Closure state: guards the one-click plan import against double clicks.
  const st = { busy: false };

  /* ---------- data ---------- */
  const isMoney = k => k === 'arr' || k === 'mrr' || k === 'cash';
  const hasMetric = k => k === 'locations' || isMoney(k);
  const metricOf = m => (m && hasMetric(m.metric) ? m.metric : 'none');
  const statusOf = m => (m && (m.status === 'done' || m.status === 'in-progress') ? m.status : 'not-started');
  const isDone = m => statusOf(m) === 'done';
  const titleOf = m => String((m && m.title) || '').trim() || 'Untitled milestone';
  const dateOf = m => (m && ctx.parseYmd(m.targetDate) ? m.targetDate : '');
  const doneOn = m => (!m || !m.doneAt ? '' : ctx.parseYmd(m.doneAt) ? m.doneAt : ctx.isoToYmd(m.doneAt));
  const targetOf = m => { const n = Number(m && m.targetValue); return m && m.targetValue != null && m.targetValue !== '' && isFinite(n) && n > 0 ? n : null; };
  const today = () => ctx.todayStr();
  const isOverdue = (m, t) => !isDone(m) && !!dateOf(m) && dateOf(m) < t;
  function daysBetween(from, to) {
    const a = ctx.parseYmd(from), b = ctx.parseYmd(to);
    return a && b ? Math.round((b.getTime() - a.getTime()) / 864e5) : null;
  }
  const list = () => ctx.all('milestones');
  const maxOrder = () => list().reduce((mx, m) => Math.max(mx, ctx.num(m.order)), 0);
  const byTarget = (a, b) =>
    (dateOf(a) || '9999-12-31').localeCompare(dateOf(b) || '9999-12-31') ||
    (ctx.num(a.order) - ctx.num(b.order)) || titleOf(a).localeCompare(titleOf(b));
  const byDoneDesc = (a, b) => doneOn(b).localeCompare(doneOn(a)) || byTarget(b, a);

  // The actuals that metric milestones measure, read once per render.
  function snapshot(t) {
    const mrr = ctx.mrrOn(t);
    return { locations: ctx.locationsOn(t), mrr, arr: Math.round(mrr * 12 * 100) / 100, cash: ctx.cashOn(t) };
  }
  function progressOf(m, now) {
    const k = metricOf(m), target = targetOf(m);
    if (k === 'none' || target == null) return null;
    const cur = ctx.num(now[k]);
    return { k, target, cur, frac: Math.max(0, cur / target), reached: cur >= target };
  }
  function summary(t) {
    const all = list();
    const open = all.filter(m => !isDone(m)).sort(byTarget);
    return {
      all,
      done: all.filter(isDone).length,
      inProgress: all.filter(m => statusOf(m) === 'in-progress').length,
      notStarted: all.filter(m => statusOf(m) === 'not-started').length,
      overdue: open.filter(m => isOverdue(m, t)),
      next: open.find(m => dateOf(m)) || open[0] || null
    };
  }

  /* ---------- formatting ---------- */
  const fmtVal = (k, v) => (isMoney(k) ? ctx.fmtMoney(v) : ctx.fmtNum(v));
  // Never round a target that isn't reached up to 100%, or some progress down to 0%.
  const pct = f => (f > 0 && f < 0.001 ? '<0.1%' : f < 1 && f >= 0.995 ? ctx.fmtPct(Math.min(f, 0.999), 1) : ctx.fmtPct(f, f > 0 && f < 0.1 ? 1 : 0));
  const plural = (n, w) => `${ctx.fmtNum(n)} ${w}${n === 1 ? '' : 's'}`;
  function dueText(m, t) {
    const d = dateOf(m);
    if (!d) return 'No target date';
    const n = daysBetween(t, d);
    if (n === 0) return 'due today';
    if (n === 1) return 'due tomorrow';
    if (n > 1) return `${plural(n, 'day')} left`;
    return `${plural(-n, 'day')} late`;
  }
  function doneText(m) {
    const at = doneOn(m), d = dateOf(m);
    if (!at) return 'done';
    if (!d) return `done ${ctx.fmtDate(at)}`;
    const n = daysBetween(d, at);
    const rel = n === 0 ? 'on the target date' : n < 0 ? `${plural(-n, 'day')} early` : `${plural(n, 'day')} late`;
    return `done ${ctx.fmtDate(at)}, ${rel}`;
  }
  const statusChip = m => {
    const s = statusOf(m);
    return s === 'done' ? ctx.ui.chip('Done', 'good') : s === 'in-progress' ? ctx.ui.chip('In progress', 'accent') : ctx.ui.chip('Not started');
  };

  /* ---------- the plan's milestones (offered on the empty state) ---------- */
  function seeds() {
    const p = ctx.plan();
    const ts = (Array.isArray(p.targets) ? p.targets : [])
      .filter(x => x && ctx.parseYmd(x.date))
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const end = ctx.planTarget();
    const pilots = Math.max(0, Math.round(ctx.num(p.pilots)));
    const hireAt = ctx.num(p.hireSalesAtArr);
    const out = [
      { title: 'Form the LLC and open a business bank account', targetDate: '2026-11-30', metric: 'none', targetValue: null, status: 'not-started' }
    ];
    if (pilots > 0) {
      out.push({ title: `Run ${plural(pilots, 'paid pilot')}`, targetDate: '2026-12-31', metric: 'none', targetValue: null, status: 'in-progress' });
      out.push({ title: `Convert the pilots to paid at ${ctx.fmtPrice(ctx.priceFor('2027-01-01'))}/location/month`, targetDate: '2027-01-31', metric: 'locations', targetValue: pilots, status: 'not-started' });
    }
    const first = ts[0];
    if (first && ctx.num(first.locations) > 0 && first.date !== end.end) {
      out.push({ title: `Reach ${ctx.fmtNum(first.locations)} paying locations`, targetDate: first.date, metric: 'locations', targetValue: ctx.num(first.locations), status: 'not-started' });
    }
    if (end.arr > 0 && ctx.parseYmd(end.end)) {
      out.push({ title: `Reach ${ctx.fmtNum(end.locations)} locations and ${ctx.fmtCompact(end.arr)} ARR`, targetDate: end.end, metric: 'arr', targetValue: end.arr, status: 'not-started' });
    }
    if (hireAt > 0) {
      out.push({ title: `Pass ${ctx.fmtCompact(hireAt)} ARR and hire the first salesperson`, targetDate: '2028-06-30', metric: 'arr', targetValue: hireAt, status: 'not-started' });
    }
    ts.filter(x => x.date > end.end && ctx.num(x.arr) > 0).forEach(x => {
      const n = ctx.num(x.locations);
      out.push({ title: n > 0 ? `Reach ${ctx.fmtNum(n)} locations and ${ctx.fmtCompact(x.arr)} ARR` : `Reach ${ctx.fmtCompact(x.arr)} ARR`, targetDate: x.date, metric: 'arr', targetValue: ctx.num(x.arr), status: 'not-started' });
    });
    return out.map((s, i) => ({ s, i })).sort((a, b) => a.s.targetDate.localeCompare(b.s.targetDate) || a.i - b.i).map(x => x.s);
  }

  /* ---------- writes ---------- */
  async function seed() {
    if (st.busy || !ctx.canWrite()) return;
    st.busy = true;
    try {
      const have = new Set(list().map(m => titleOf(m).toLowerCase()));
      let order = maxOrder(), added = 0, failed = false;
      for (const s of seeds()) {
        if (have.has(s.title.toLowerCase())) continue;
        const id = await ctx.create('milestones', Object.assign({}, s, {
          doneAt: null, notes: '', source: SOURCE, order: ++order, createdAt: ctx.iso(), createdBy: ctx.me()
        }));
        if (!id) { failed = true; break; }
        added++;
      }
      // A failed create already showed its own error toast; don't follow it with a wrong "already added" message.
      if (added) ctx.toast(`Added ${plural(added, 'milestone')} from the ${SOURCE}`);
      else if (!failed) ctx.toast('The plan’s milestones are already on your list.');
    } finally { st.busy = false; }
  }
  async function setStatus(id, status) {
    const m = ctx.get('milestones', id);
    if (!m || !ctx.canWrite()) return;
    const wasDone = isDone(m);
    const ok = await ctx.patch('milestones', id, { status, doneAt: status === 'done' ? today() : null, updatedAt: ctx.iso() });
    if (!ok) return;
    const t = titleOf(m);
    ctx.toast(status === 'done' ? `Marked “${t}” done` : wasDone ? `Reopened “${t}”` : `Started “${t}”`);
  }
  function confirmDelete(id) {
    const m = ctx.get('milestones', id);
    if (!m || !ctx.canWrite()) return;
    ctx.openConfirm('Delete this milestone?',
      `“${titleOf(m)}” will leave your milestone list. This can’t be undone.`,
      'Delete milestone',
      async () => { if (await ctx.remove('milestones', id)) ctx.toast('Deleted ' + titleOf(m)); });
  }
  function openForm(id) {
    const m = id ? ctx.get('milestones', id) : null;
    if (id && !m) return;
    const F = ctx.F;
    const k = m ? metricOf(m) : 'none';
    const tv = m && targetOf(m) != null ? targetOf(m) : '';
    ctx.openFormModal({
      title: m ? 'Edit milestone' : 'New milestone',
      submitLabel: m ? 'Save milestone' : 'Add milestone',
      body:
        F.text('milestones-f-title', 'Milestone', m ? m.title : '', 'required maxlength="160" autocomplete="off" placeholder="e.g. Sign the first multi-location customer"') +
        `<div class="row2">${F.date('milestones-f-date', 'Target date', m ? dateOf(m) : '')}${F.select('milestones-f-status', 'Status', STATUSES, m ? statusOf(m) : 'not-started')}</div>` +
        `<div class="row2">${F.select('milestones-f-metric', 'Track progress with', METRICS, k)}<div id="milestones-f-target-wrap"${k === 'none' ? ' hidden' : ''}>${F.text('milestones-f-target', `<span id="milestones-f-target-label">${TARGET_LABEL[k]}</span>`, tv, 'inputmode="decimal" autocomplete="off"')}</div></div>` +
        '<p class="note" style="margin:0">Paying locations, MRR and ARR come from won deals; cash comes from the opening balance, paid invoices and expenses.</p>' +
        F.area('milestones-f-notes', 'Notes', m ? m.notes : '', 3),
      deleteLabel: m ? 'Delete milestone' : undefined,
      onDelete: m ? () => confirmDelete(m.id) : undefined,
      afterOpen() {
        const sel = document.getElementById('milestones-f-metric');
        if (!sel) return;
        sel.addEventListener('change', () => {
          const v = hasMetric(sel.value) ? sel.value : 'none';
          const wrap = document.getElementById('milestones-f-target-wrap');
          const lab = document.getElementById('milestones-f-target-label');
          if (wrap) wrap.hidden = v === 'none';
          if (lab) lab.textContent = TARGET_LABEL[v];
        });
      },
      onSubmit: async () => {
        const title = ctx.val('milestones-f-title');
        if (!title) return ctx.formErr('Name the milestone.', 'milestones-f-title');
        const date = ctx.val('milestones-f-date');
        if (!date) return ctx.formErr('Pick a target date.', 'milestones-f-date');
        if (!ctx.parseYmd(date)) return ctx.formErr('Enter the target date as YYYY-MM-DD.', 'milestones-f-date');
        if (date < '2000-01-01' || date > '2099-12-31') return ctx.formErr('Check the year: enter a target date between 2000 and 2099.', 'milestones-f-date');
        const kv = ctx.val('milestones-f-metric');
        const metric = hasMetric(kv) ? kv : 'none';
        let targetValue = null;
        if (metric !== 'none') {
          const raw = ctx.val('milestones-f-target').replace(/[$,\s]/g, '');
          if (!raw) return ctx.formErr(metric === 'locations' ? 'Enter how many paying locations to reach.' : 'Enter the dollar amount to reach.', 'milestones-f-target');
          const n = Number(raw);
          if (!isFinite(n) || n <= 0) return ctx.formErr(`Enter the target as a number above 0, like ${metric === 'locations' ? '25' : '250000'}.`, 'milestones-f-target');
          if (metric === 'locations' && !Number.isInteger(n)) return ctx.formErr('Enter a whole number of locations.', 'milestones-f-target');
          targetValue = metric === 'locations' ? n : Math.round(n * 100) / 100;
        }
        const sv = ctx.val('milestones-f-status');
        const status = STATUSES.some(s => s[0] === sv) ? sv : 'not-started';
        const doneAt = status === 'done' ? (m && isDone(m) && doneOn(m) ? doneOn(m) : today()) : null;
        const data = { title, targetDate: date, metric, targetValue, status, doneAt, notes: ctx.val('milestones-f-notes') };
        if (m) {
          const ok = await ctx.patch('milestones', m.id, Object.assign(data, { updatedAt: ctx.iso() }));
          if (ok) ctx.toast('Saved ' + title);
          return ok;
        }
        const newId = await ctx.create('milestones', Object.assign(data, { source: '', order: maxOrder() + 1, createdAt: ctx.iso(), createdBy: ctx.me() }));
        if (newId) ctx.toast('Added ' + title);
        return !!newId;
      }
    });
  }

  /* ---------- render pieces ---------- */
  const btn = (a, label, extra, cls) => `<button class="btn btn-sm ${cls || ''}" type="button" data-act="mod" data-mod="${ID}" data-a="${a}" ${extra || ''}>${label}</button>`;
  function head(loading, n) {
    return ctx.ui.toolbar({
      title: 'Milestones',
      count: loading ? null : plural(n, 'milestone'),
      exportable: !loading && n > 0,
      actions: ctx.canWrite() ? btn('new', 'Add milestone', '', 'btn-primary') : ''
    });
  }
  function emptyState() {
    const items = seeds();
    const last = items[items.length - 1];
    const text = `The ${SOURCE} lay out ${plural(items.length, 'milestone')}, from forming the LLC by ${ctx.fmtDate(items[0].targetDate)}` +
      (last && last.metric === 'arr' ? ` to ${ctx.fmtCompact(last.targetValue)} ARR by ${ctx.fmtDate(last.targetDate)}.` : '.') +
      ' Add them here to track each one against its date. Milestones tied to paying locations, ARR, MRR or cash show live progress from your deals, invoices and expenses.' +
      (ctx.canWrite() ? '' : ' Someone with edit access can add them.');
    const preview = `<ul class="note" style="text-align:left;margin:0;padding-left:18px;max-width:60ch">${items.map(s =>
      `<li>${esc(s.title)} <span class="mono">· ${esc(ctx.fmtDate(s.targetDate))}</span></li>`).join('')}</ul>`;
    const action = preview + (ctx.canWrite()
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn btn-primary" type="button" data-act="mod" data-mod="${ID}" data-a="seed">Add the plan’s milestones</button><button class="btn" type="button" data-act="mod" data-mod="${ID}" data-a="new">Add a different milestone</button></div>`
      : '');
    return ctx.ui.empty({ title: 'Track the milestones in your plan', text, action });
  }
  function kpiRow(z, t) {
    const ui = ctx.ui, total = z.all.length, over = z.overdue.length;
    const next = z.next;
    let nextVal = DASH, nextSub = 'Every milestone is done';
    if (next) {
      const d = dateOf(next);
      nextVal = d ? esc(ctx.fmtShort(d)) : DASH;
      nextSub = `${esc(titleOf(next))}${d ? ` · <span class="${isOverdue(next, t) ? 'neg' : ''}">${esc(dueText(next, t))}</span>` : ''}`;
    }
    const oldest = z.overdue[0];
    return `<section class="kpis">
      ${ui.kpi({ label: 'Done', value: ctx.fmtNum(z.done), sub: `of ${plural(total, 'milestone')}`, tone: z.done && z.done === total ? 'good' : '', bar: total ? `<div style="margin-top:8px">${ui.progress(z.done / total, 'good')}</div>` : '' })}
      ${ui.kpi({ label: 'In progress', value: ctx.fmtNum(z.inProgress), sub: `${ctx.fmtNum(z.notStarted)} not started yet` })}
      ${ui.kpi({ label: 'Overdue', value: ctx.fmtNum(over), tone: over ? 'bad' : '', sub: oldest ? `Oldest: ${esc(titleOf(oldest))}, ${esc(dueText(oldest, t))}` : 'Nothing past its target date' })}
      ${ui.kpi({ label: 'Next up', value: nextVal, sub: nextSub })}
    </section>`;
  }
  function row(m, t, now) {
    const w = ctx.canWrite(), id = esc(m.id), title = esc(titleOf(m));
    const s = statusOf(m), late = isOverdue(m, t), d = dateOf(m);
    const p = progressOf(m, now);
    let chips = statusChip(m);
    if (late) chips += ctx.ui.chip('Overdue', 'bad');
    if (p && p.reached && s !== 'done') chips += ctx.ui.chip('Target reached', 'good');
    const when = d
      ? `Target ${esc(ctx.fmtDate(d))} · <span class="${late ? 'neg' : ''}">${esc(s === 'done' ? doneText(m) : dueText(m, t))}</span>`
      : (s === 'done' ? esc(doneText(m).replace(/^d/, 'D')) : 'No target date');
    let prog = '';
    if (p) {
      prog = `<div style="display:grid;gap:4px;margin-top:8px;max-width:560px">
          <div style="display:flex;justify-content:space-between;gap:4px 12px;flex-wrap:wrap;font-size:13px"><span class="muted">${NOW_LABEL[p.k]}</span><span class="mono">${fmtVal(p.k, p.cur)} of ${fmtVal(p.k, p.target)} · ${esc(pct(p.frac))}</span></div>
          ${ctx.ui.progress(Math.min(1, p.frac), p.reached ? 'good' : late ? 'bad' : '')}
        </div>`;
    } else if (metricOf(m) !== 'none') {
      prog = '<p class="note" style="margin:6px 0 0">Add a target value to track progress.</p>';
    }
    const notes = m.notes ? `<p class="note" style="margin:6px 0 0;white-space:pre-line;overflow-wrap:anywhere">${esc(m.notes)}</p>` : '';
    let acts = '';
    if (w) {
      const lab = what => `aria-label="${what} ${title}"`;
      const data = `data-id="${id}"`;
      if (s === 'not-started') acts += btn('start', 'Start', `${data} ${lab('Start')}`);
      if (s !== 'done') acts += btn('done', 'Mark done', `${data} ${lab('Mark done:')}`, p && p.reached ? 'btn-primary' : '');
      else acts += btn('reopen', 'Reopen', `${data} ${lab('Reopen')}`);
      acts += btn('edit', 'Edit', `${data} ${lab('Edit')}`, 'btn-ghost') + btn('delete', 'Delete', `${data} ${lab('Delete')}`, 'btn-ghost btn-danger');
    }
    const foot = m.source || acts
      ? `<div style="display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-top:8px">${m.source ? `<span class="source">${esc(m.source)}</span>` : ''}<span style="flex:1"></span>${acts ? `<div class="row-actions" style="flex-wrap:wrap">${acts}</div>` : ''}</div>`
      : '';
    return `<li class="task-row" style="grid-template-columns:minmax(0,1fr);gap:0;align-items:start;padding:12px 14px">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap"><span class="cell-main" style="overflow-wrap:anywhere;margin-right:2px">${title}</span>${chips}</div>
        <div class="cell-sub" style="margin-top:2px">${when}</div>
        ${prog}${notes}${foot}
      </div></li>`;
  }
  function section(label, items, t, now, tone) {
    if (!items.length) return '';
    return `<section><h2 class="group-h ${tone || ''}">${label} <span class="n">${items.length}</span></h2><ul class="task-list">${items.map(m => row(m, t, now)).join('')}</ul></section>`;
  }
  function lists(z, t, now) {
    const shown = z.all.filter(m => ctx.matches(m.title, m.notes, m.source));
    if (!shown.length) return ctx.ui.empty({ title: 'No milestones match', text: 'Try another search.' });
    const open = shown.filter(m => !isDone(m)).sort(byTarget);
    const overdue = open.filter(m => isOverdue(m, t));
    const upcoming = open.filter(m => !isOverdue(m, t));
    const done = shown.filter(isDone).sort(byDoneDesc);
    let html = section('Overdue', overdue, t, now, 'bad') + section('Upcoming', upcoming, t, now) + section('Done', done, t, now);
    if (!open.length) html = `<p class="note" style="margin:0">Every milestone${ctx.S.q ? ' that matches your search' : ''} is done.${ctx.canWrite() ? ' Add the next one to keep the plan moving.' : ''}</p>` + html;
    return `<div class="groups" style="margin-bottom:18px">${html}</div>`;
  }
  // Milestones per quarter (per year when the dates span more than four years).
  function buckets(all) {
    const dated = all.filter(dateOf);
    if (!dated.length) return null;
    const qk = d => Number(d.slice(0, 4)) * 4 + Math.floor((Number(d.slice(5, 7)) - 1) / 3);
    const keys = dated.map(m => qk(dateOf(m)));
    const lo = Math.min.apply(null, keys), hi = Math.max.apply(null, keys);
    const yearly = hi - lo + 1 > 16;
    const key = d => (yearly ? Number(d.slice(0, 4)) : qk(d));
    const from = yearly ? Math.floor(lo / 4) : lo, to = yearly ? Math.floor(hi / 4) : hi;
    const rows = [];
    for (let k = from; k <= to; k++) {
      const y = yearly ? k : Math.floor(k / 4), q = yearly ? 0 : (k % 4) + 1;
      rows.push({ k, label: yearly ? String(y) : `Q${q} ’${String(y).slice(2)}`, long: yearly ? String(y) : `Q${q} ${y}`, total: 0, done: 0 });
    }
    dated.forEach(m => { const r = rows[key(dateOf(m)) - from]; if (r) { r.total++; if (isDone(m)) r.done++; } });
    return { rows, yearly };
  }
  function timelinePanel(z) {
    const b = buckets(z.all);
    if (!b) return '';
    const unit = b.yearly ? 'year' : 'quarter';
    const chart = ctx.chart.bars({
      labels: b.rows.map(r => r.label),
      series: [{ name: 'Milestones due', values: b.rows.map(r => r.total), color: 'var(--viz-1)' }],
      height: 180,
      // Counts are whole numbers: leave fractional y-axis ticks (0.25, 0.5...) unlabeled so they don't round to repeats.
      format: v => (Number.isInteger(v) ? ctx.fmtNum(v) : ''),
      ariaLabel: 'Milestones due per ' + unit + ': ' + b.rows.filter(r => r.total).map(r => `${r.long} ${r.total}`).join(', ')
    });
    const text = b.rows.filter(r => r.total).map(r => `${r.long}: ${r.total}${r.done ? ` (${r.done} done)` : ''}`).join(' · ');
    const undated = z.all.length - z.all.filter(dateOf).length;
    return ctx.ui.panel({
      title: 'Milestones by target ' + unit,
      body: `${chart}<p class="note">${esc(text)}.${undated ? ` ${plural(undated, 'milestone')} without a target date ${undated === 1 ? 'is' : 'are'} left out.` : ''}</p>`
    });
  }
  function nowPanel(now, t) {
    const r = (label, v, sub) => `<div class="stat-row"><dt>${label}${sub ? ` <span class="source">${sub}</span>` : ''}</dt><dd>${v}</dd></div>`;
    const body = `<dl class="stat-list">
        ${r('Paying locations', ctx.fmtNum(now.locations), 'active won deals')}
        ${r('MRR', ctx.fmtMoney(now.mrr), 'active won deals')}
        ${r('ARR', ctx.fmtMoney(now.arr), 'MRR × 12')}
        ${r('Cash in the bank', `<span class="${now.cash < 0 ? 'neg' : ''}">${ctx.fmtMoney(now.cash)}</span>`, 'opening balance + paid invoices − expenses')}
      </dl>
      <p class="note">Metric milestones compare these numbers to their targets. They update as you win deals, record payments and log expenses.</p>`;
    return ctx.ui.panel({ title: 'What progress is measured against', sub: 'As of ' + ctx.fmtDate(t), body });
  }

  return {
    id: ID,
    label: 'Milestones',
    group: 'Planning',
    order: 40,
    // Cash milestones read ctx.cashOn(), which sums paid invoices and expenses, so subscribe to both.
    collections: ['milestones', 'invoices', 'expenses'],
    newItems: [{ label: 'Milestone', a: 'new' }],
    badge() {
      if (ctx.isLoading()) return null;
      const t = today();
      const n = list().filter(m => isOverdue(m, t)).length;
      return n ? { text: String(n), hot: true, title: `${plural(n, 'milestone')} overdue` } : null;
    },
    render() {
      const loading = ctx.isLoading();
      if (loading) return head(true, 0) + '<div class="empty"><p>Loading milestones…</p></div>';
      const t = today();
      const z = summary(t);
      if (!z.all.length) return head(false, 0) + emptyState();
      const now = snapshot(t);
      return head(false, z.all.length) +
        kpiRow(z, t) +
        lists(z, t, now) +
        `<div class="grid grid-2 section">${timelinePanel(z)}${nowPanel(now, t)}</div>`;
    },
    onAction(a, data) {
      if (a === 'new') return openForm(null);
      if (a === 'edit') return openForm(data.id);
      if (a === 'delete') return confirmDelete(data.id);
      if (a === 'start') return setStatus(data.id, 'in-progress');
      if (a === 'done') return setStatus(data.id, 'done');
      if (a === 'reopen') return setStatus(data.id, 'in-progress');
      if (a === 'seed') return seed();
    },
    csv() {
      const t = today(), now = snapshot(t);
      const rows = [['Milestone', 'Target date', 'Status', 'Overdue', 'Days left (negative = late)', 'Done on', 'Metric', 'Target value', 'Current value', 'Progress', 'Notes', 'Source', 'Created']];
      list().slice().sort(byTarget).forEach(m => {
        const p = progressOf(m, now), d = dateOf(m), k = metricOf(m);
        const left = d && !isDone(m) ? daysBetween(t, d) : null;
        rows.push([
          titleOf(m), d, (STATUSES.find(s => s[0] === statusOf(m)) || STATUSES[0])[1], isOverdue(m, t) ? 'Yes' : 'No',
          left == null ? '' : left, isDone(m) ? doneOn(m) : '', k === 'none' ? '' : (METRICS.find(x => x[0] === k) || METRICS[0])[1],
          targetOf(m) == null ? '' : targetOf(m), p ? Math.round(p.cur * 100) / 100 : '', p ? Math.round(p.frac * 10000) / 10000 : '',
          String(m.notes || ''), String(m.source || ''), ctx.isoToYmd(m.createdAt) || ''
        ]);
      });
      return { name: 'milestones', rows };
    }
  };
});
