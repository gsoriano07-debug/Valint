(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  /* Team & hiring: the headcount and payroll plan. Each role is a doc in `hires`:
     {role, name, startMonth 'YYYY-MM', endMonth 'YYYY-MM'|null (last month employed), annualSalary|null,
      status 'planned'|'open'|'hired', notes, order, createdAt, createdBy}.
     A role counts in a month when startMonth <= month and (no endMonth, or endMonth >= month), whatever its status.
     Payroll for a year = annualSalary / 12 x months employed in that year. Roles without a salary count as $0
     and are flagged, so the comparison with the plan reads as incomplete rather than as savings. */
  const ID = 'team';
  const COLL = 'hires';
  const STATUS = [['planned', 'Planned'], ['open', 'Open (recruiting)'], ['hired', 'Hired']];
  const STATUS_LABEL = { planned: 'Planned', open: 'Open', hired: 'Hired' };
  const STATUS_TONE = { planned: '', open: 'accent', hired: 'good' };
  const st = { busy: false };

  /* ---------- small helpers ---------- */
  const isYm = s => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s || ''));
    return !!m && +m[2] >= 1 && +m[2] <= 12;
  };
  function normYm(s) {
    const m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(String(s || '').trim());
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    return `${m[1]}-${ctx.pad(+m[2])}`;
  }
  const curYm = () => ctx.ymOf(ctx.todayStr());
  const curYear = () => Number(curYm().slice(0, 4));
  const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  const plural = (n, w, pl) => `${ctx.fmtNum(n)} ${n === 1 ? w : (pl || w + 's')}`;
  const money = n => ctx.fmtMoney(Math.round(ctx.num(n)));
  const mLabel = ym => (isYm(ym) ? ctx.monthLabel(ym) : '');
  const btn = (a, text, extra, cls) => `<button class="btn btn-sm ${cls || ''}" type="button" data-act="mod" data-mod="${ID}" data-a="${a}" ${extra || ''}>${text}</button>`;
  function listText(names) {
    const n = names.map(x => String(x));
    if (n.length <= 1) return n.join('');
    if (n.length === 2) return `${n[0]} and ${n[1]}`;
    if (n.length <= 3) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
    return `${n.slice(0, 3).join(', ')} and ${n.length - 3} more`;
  }

  const hasSalary = h => !!h && h.annualSalary != null && h.annualSalary !== '' && isFinite(Number(h.annualSalary)) && Number(h.annualSalary) >= 0;
  const salary = h => (hasSalary(h) ? Number(h.annualSalary) : 0);
  const statusOf = h => (h && STATUS_LABEL[h.status] ? h.status : 'planned');
  const startOf = h => (isYm(h.startMonth) ? h.startMonth : null);
  const endOf = h => (isYm(h.endMonth) ? h.endMonth : null);
  const roleName = h => String(h.role || '').trim() || 'Untitled role';
  const employedIn = (h, ym) => !!startOf(h) && h.startMonth <= ym && (!endOf(h) || h.endMonth >= ym);
  function monthsIn(h, y) {
    const s = startOf(h);
    if (!s) return 0;
    const jan = `${y}-01`, dec = `${y}-12`, e = endOf(h);
    const from = s > jan ? s : jan, to = e && e < dec ? e : dec;
    return from > to ? 0 : monthsBetween(from, to) + 1;
  }
  const payrollFor = (list, y) => ctx.sum(list, h => salary(h) / 12 * monthsIn(h, y));
  const noSalaryIn = (list, y) => list.filter(h => !hasSalary(h) && monthsIn(h, y) > 0);
  const headAt = (list, ym) => list.filter(h => employedIn(h, ym)).length;
  function planNum(v) { return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); }
  const planTeam = y => planNum((ctx.plan().team || {})[y]);
  const planPay = y => planNum(((ctx.plan().opex || {}).payroll || {})[y]);
  const salesAt = () => ctx.num(ctx.plan().hireSalesAtArr);

  function sorted(list) {
    return list.slice().sort((a, b) => {
      const sa = startOf(a) || '9999-99', sb = startOf(b) || '9999-99';
      if (sa !== sb) return sa < sb ? -1 : 1;
      return (ctx.num(a.order) - ctx.num(b.order)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }
  const hires = () => sorted(ctx.all(COLL));
  const maxOrder = () => ctx.all(COLL).reduce((m, h) => Math.max(m, ctx.num(h.order)), 0);
  const upcoming = list => list.filter(h => (statusOf(h) === 'planned' || statusOf(h) === 'open') && startOf(h));
  const pastDue = h => (statusOf(h) === 'planned' || statusOf(h) === 'open') && !!startOf(h) && h.startMonth < curYm();

  /* ---------- KPIs ---------- */
  function kpiRow(list) {
    const ym = curYm(), y = curYear(), years = ctx.planYears();
    const team = list.filter(h => statusOf(h) === 'hired' && employedIn(h, ym));
    const later = list.filter(h => statusOf(h) === 'hired' && startOf(h) && h.startMonth > ym);
    let teamSub;
    if (team.length) teamSub = ctx.esc(listText(team.map(h => h.name ? `${h.name}` : roleName(h))));
    else if (later.length) teamSub = `${plural(later.length, 'hire')} starting later, first in ${ctx.esc(mLabel(later[0].startMonth))}`;
    else teamSub = 'No one hired yet';
    const pt = planTeam(y);
    if (pt != null) teamSub += ` · plan ${ctx.fmtNum(pt)} in ${y}`;

    const open = list.filter(h => statusOf(h) === 'open').length;
    const planned = list.filter(h => statusOf(h) === 'planned').length;
    const late = list.filter(pastDue).length;

    const pay = payrollFor(list, y), missing = noSalaryIn(list, y).length;
    const pp = planPay(y);
    let paySub;
    if (pp != null) paySub = `Plan ${y}: ${money(pp)}`;
    else if (years.length && y < years[0]) paySub = `No plan payroll in ${y}. ${years[0]}: ${money(payrollFor(list, years[0]))} on your list, ${planPay(years[0]) == null ? 'no plan figure' : money(planPay(years[0])) + ' planned'}`;
    else paySub = `No plan payroll for ${y}`;
    if (missing) paySub += ` · ${plural(missing, 'salary', 'salaries')} not set`;

    const next = upcoming(list)[0];
    let nextKpi;
    if (next) {
      const away = monthsBetween(ym, next.startMonth);
      const when = away > 0 ? `in ${plural(away, 'month')}` : away === 0 ? 'this month' : `${plural(-away, 'month')} late`;
      nextKpi = ctx.ui.kpi({
        label: 'Next hire', value: ctx.esc(mLabel(next.startMonth)), tone: away < 0 ? 'warn' : '',
        sub: `${ctx.esc(roleName(next))} · ${ctx.esc(STATUS_LABEL[statusOf(next)].toLowerCase())} · ${when}`
      });
    } else nextKpi = ctx.ui.kpi({ label: 'Next hire', value: '—', sub: 'No planned or open roles with a start month' });

    return `<section class="kpis">
      ${ctx.ui.kpi({ label: 'Team today', value: ctx.fmtNum(team.length), sub: teamSub })}
      ${ctx.ui.kpi({ label: 'Planned hires', value: ctx.fmtNum(open + planned), tone: late ? 'warn' : '', sub: `${ctx.fmtNum(open)} open, ${ctx.fmtNum(planned)} planned${late ? ` · ${plural(late, 'start month')} passed` : ''}` })}
      ${ctx.ui.kpi({ label: `Payroll ${y}`, value: money(pay), sub: paySub })}
      ${nextKpi}
    </section>`;
  }

  /* ---------- plan comparison ---------- */
  function yearRows(list) {
    return ctx.planYears().map(y => {
      const pt = planTeam(y), pp = planPay(y);
      const head = headAt(list, `${y}-12`), pay = payrollFor(list, y);
      return { y, pt, pp, head, pay, missing: noSalaryIn(list, y) };
    });
  }
  function headDiff(d) {
    if (d == null) return '<td class="num muted">—</td>';
    d = Math.round(d * 10) / 10;
    if (d === 0) return '<td class="num muted">Matches</td>';
    return `<td class="num">${d > 0 ? `${ctx.fmtNum(d, 1)} more` : `${ctx.fmtNum(-d, 1)} fewer`}</td>`;
  }
  /* partial: some roles in that period have no salary, so the list's payroll is a floor, not a total. */
  function payDiff(d, partial) {
    if (d == null) return '<td class="num muted">—</td>';
    const r = Math.round(d);
    if (r === 0) return `<td class="num muted">${partial ? 'Matches so far' : 'Matches'}</td>`;
    const amt = money(Math.abs(r));
    return `<td class="num${r > 0 ? ' neg' : ''}">${r > 0 ? `${partial ? 'At least ' : ''}${amt} over` : `${partial ? 'Up to ' : ''}${amt} under`}</td>`;
  }

  function vsPlanPanel(list, rows) {
    if (!rows.length) {
      return ctx.ui.panel({ title: 'Headcount and payroll vs plan', body: '<p class="muted" style="margin:0">No plan years are set. Add them on the Assumptions tab.</p>' });
    }
    const body = rows.map(r => `<tr>
        <td><strong>${r.y}</strong></td>
        <td class="num">${r.pt == null ? '—' : ctx.fmtNum(r.pt, 1)}</td>
        <td class="num">${ctx.fmtNum(r.head)}</td>
        ${headDiff(r.pt == null ? null : r.head - r.pt)}
        <td class="num">${r.pp == null ? '—' : money(r.pp)}</td>
        <td class="num">${money(r.pay)}${r.missing.length ? ` <span class="chip chip-warn" title="${ctx.esc(listText(r.missing.map(roleName)))}">${plural(r.missing.length, 'salary', 'salaries')} not set</span>` : ''}</td>
        ${payDiff(r.pp == null ? null : r.pay - r.pp, r.missing.length > 0)}
      </tr>`).join('');
    /* Totals compare the same years on both sides: only years that have a plan payroll figure. */
    const withPlan = rows.filter(r => r.pp != null);
    const totRows = withPlan.length ? withPlan : rows;
    const tp = withPlan.length ? ctx.sum(withPlan, r => r.pp) : null;
    const tl = ctx.sum(totRows, r => r.pay);
    const totLabel = withPlan.length && withPlan.length < rows.length ? `Payroll, ${listText(withPlan.map(r => r.y))}` : `${rows.length}-year payroll`;
    const foot = `<tr><td colspan="4"><strong>${ctx.esc(totLabel)}</strong></td><td class="num"><strong>${tp == null ? '—' : money(tp)}</strong></td><td class="num"><strong>${money(tl)}</strong></td>${payDiff(tp == null ? null : tl - tp, totRows.some(r => r.missing.length))}</tr>`;
    const head = '<tr><th>Year</th><th class="num">Plan team</th><th class="num">Your list, Dec</th><th class="num">Difference</th><th class="num">Plan payroll</th><th class="num">Your list payroll</th><th class="num">Difference</th></tr>';

    const gapYears = rows.filter(r => r.missing.length);
    const noSal = [];
    gapYears.forEach(r => r.missing.forEach(h => { if (noSal.indexOf(h) < 0) noSal.push(h); }));
    const undated = list.filter(h => !startOf(h));
    let note = '';
    if (gapYears.length) {
      note += `Roles without a salary count as $0, so payroll on your list is incomplete for ${ctx.esc(listText(gapYears.map(r => r.y)))}. Set a salary for ${ctx.esc(listText(noSal.map(roleName)))} to finish the comparison. `;
    }
    if (undated.length) note += `${plural(undated.length, 'role')} without a start month ${undated.length === 1 ? 'is' : 'are'} left out. `;
    note += `“Your list” counts every role, planned, open or hired, between its start and end months; headcount is at December. The plan’s team and payroll come from the Assumptions tab. <button class="link" type="button" data-act="go" data-view="assumptions">Change the plan</button>`;
    return ctx.ui.panel({
      title: 'Headcount and payroll vs plan', sub: 'Per plan year',
      body: `<div class="table-wrap flat"><table class="compact" style="min-width:0"><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div><p class="note">${note}</p>`
    });
  }

  function chartPanel(rows) {
    if (!rows.length) return '';
    const plan = rows.map(r => (r.pp == null ? null : Math.round(r.pp)));
    const mine = rows.map(r => Math.round(r.pay));
    const chart = ctx.chart.bars({
      labels: rows.map(r => String(r.y)), height: 220, format: ctx.fmtCompact,
      ariaLabel: 'Payroll per plan year: plan compared with your list',
      series: [{ name: 'Plan', values: plan, color: 'var(--viz-plan)' }, { name: 'Your list', values: mine, color: 'var(--viz-1)' }]
    });
    const text = rows.map(r => `${r.y}: plan ${r.pp == null ? '—' : ctx.fmtCompact(r.pp)}, your list ${ctx.fmtCompact(r.pay)}`).join('; ');
    return ctx.ui.panel({ title: 'Payroll per year', sub: 'Plan vs your list', body: `${chart}<p class="note">${ctx.esc(text)}.</p>` });
  }

  /* ---------- hiring trigger ---------- */
  function triggerPanel(list) {
    const thr = salesAt();
    if (!(thr > 0)) {
      return ctx.ui.panel({ title: 'Hiring trigger', body: '<p class="muted" style="margin:0">The plan has no ARR level for hiring the first salesperson. Set one on the Assumptions tab.</p>' });
    }
    const arr = ctx.mrrOn(ctx.todayStr()) * 12;
    const frac = arr / thr, gap = thr - arr, passed = arr >= thr;
    const sales = list.filter(h => /sales/i.test(String(h.role || '')));
    const s = sales.find(h => statusOf(h) !== 'hired') || sales[0] || null;
    const cross = ctx.planModel('base').find(r => ctx.num(r.arr) >= thr);
    const lines = [];
    lines.push(`The plan says to hire the first salesperson once ARR passes ${money(thr)}.`);
    lines.push(cross ? `The base model gets there in ${ctx.esc(mLabel(cross.ym))}.` : 'The base model does not get there inside the plan years.');
    if (s) {
      const sm = startOf(s);
      const who = ctx.esc(roleName(s));
      if (statusOf(s) === 'hired') lines.push(`${who} is hired${sm ? ` from ${ctx.esc(mLabel(sm))}` : ''}.`);
      else lines.push(`Your list starts ${who} in ${sm ? ctx.esc(mLabel(sm)) : 'no set month'}${passed ? '; ARR is already past the trigger, so consider starting now' : ''}.`);
    } else lines.push(`No sales role is on your list yet.${ctx.canWrite() ? ' Add one to plan the hire.' : ''}`);
    const body = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px;font-size:13px"><span class="muted">${passed ? 'Trigger passed' : `${ctx.fmtPct(frac, 1)} of the way`}</span><span class="mono">${money(arr)} / ${money(thr)}</span></div>
      ${ctx.ui.progress(frac, passed ? 'good' : '')}
      <dl class="stat-list" style="margin-top:12px">
        <div class="stat-row"><dt>Current ARR</dt><dd id="team-arr">${money(arr)}</dd></div>
        <div class="stat-row"><dt>Hire the first salesperson at</dt><dd>${money(thr)}</dd></div>
        <div class="stat-row total"><dt>${passed ? 'Past the trigger by' : 'Gap'}</dt><dd>${money(Math.abs(gap))}</dd></div>
      </dl>
      <p class="note">${lines.join(' ')} ARR is the monthly revenue of active customers today times 12.</p>`;
    return ctx.ui.panel({ title: 'Hiring trigger', sub: 'First salesperson', body });
  }

  /* ---------- roles table ---------- */
  function rolesPanel(list) {
    const w = ctx.canWrite();
    const rows = list.filter(h => ctx.matches(h.role, h.name, h.notes, STATUS_LABEL[statusOf(h)]));
    const q = String(ctx.S.q || '').trim();
    const add = w ? btn('new', 'Add role', '', 'btn-primary') : '';
    const counts = ['hired', 'open', 'planned'].map(s => `${ctx.fmtNum(list.filter(h => statusOf(h) === s).length)} ${STATUS_LABEL[s].toLowerCase()}`).join(', ');
    if (!rows.length) {
      return ctx.ui.panel({ title: 'Roles', sub: `${plural(list.length, 'role')}: ${counts}`, actions: add, body: `<p class="muted" style="margin:0">No roles match “${ctx.esc(q)}”. Try another search.</p>` });
    }
    const body = rows.map(h => {
      const id = ctx.esc(h.id), label = ctx.esc(roleName(h));
      const s = statusOf(h);
      return `<tr>
        <td><div class="trunc"><strong>${label}</strong></div>${h.notes ? `<div class="trunc muted" style="font-size:12.5px" title="${ctx.esc(h.notes)}">${ctx.esc(h.notes)}</div>` : ''}</td>
        <td><div class="trunc">${h.name ? ctx.esc(h.name) : '<span class="muted">—</span>'}</div></td>
        <td style="white-space:nowrap">${startOf(h) ? ctx.esc(mLabel(h.startMonth)) : ctx.ui.chip('Not set', 'warn')}</td>
        <td style="white-space:nowrap">${endOf(h) ? ctx.esc(mLabel(h.endMonth)) : '<span class="muted">—</span>'}</td>
        <td class="num">${hasSalary(h) ? money(h.annualSalary) : ctx.ui.chip('Not set', 'warn')}</td>
        <td style="white-space:nowrap">${ctx.ui.chip(STATUS_LABEL[s], STATUS_TONE[s])}${pastDue(h) ? ' ' + ctx.ui.chip('Start passed', 'warn') : ''}</td>
        ${w ? `<td><div class="row-actions">${btn('edit', 'Edit', `data-id="${id}" aria-label="Edit ${label}"`, 'btn-ghost')}${btn('delete', 'Delete', `data-id="${id}" aria-label="Delete ${label}"`, 'btn-ghost btn-danger')}</div></td>` : ''}
      </tr>`;
    }).join('');
    const head = `<tr><th>Role</th><th>Name</th><th>Start</th><th>End</th><th class="num">Annual salary</th><th>Status</th>${w ? '<th aria-label="Actions"></th>' : ''}</tr>`;
    return ctx.ui.panel({
      title: 'Roles', sub: `${plural(list.length, 'role')}: ${counts}${q ? ` · ${rows.length} matching “${q}”` : ''}`, actions: add,
      body: `<div class="table-wrap flat"><table class="compact"><thead>${head}</thead><tbody>${body}</tbody></table></div>`
    });
  }

  /* ---------- empty state ---------- */
  /* The plan's team as roles: one per person the plan adds each year. Only the founder (first person) and the
     first salesperson (second) are named in the plan; the founder's salary is the first plan year's payroll
     when the plan has one person that year. */
  function planSeed() {
    const years = ctx.planYears(), out = [];
    const thr = salesAt();
    let count = 0;
    years.forEach((y, i) => {
      const t = planTeam(y);
      if (t == null) return;
      const goal = Math.min(50, Math.max(0, Math.round(t)));
      let k = 0;
      while (count < goal) {
        count++; k++;
        const base = { name: '', endMonth: null, annualSalary: null, status: 'planned', notes: '' };
        if (count === 1) {
          const pay = planPay(y);
          const solo = i === 0 && goal === 1 && pay != null;
          out.push(Object.assign(base, {
            role: 'Founder', startMonth: `${y}-01`, annualSalary: solo ? pay : null, status: 'hired',
            notes: solo ? `The plan’s ${y} payroll of ${money(pay)} is founder-only.` : ''
          }));
        } else if (count === 2) {
          out.push(Object.assign(base, { role: 'First salesperson', startMonth: `${y}-03`, notes: thr > 0 ? `Once ARR passes ${money(thr)}` : '' }));
        } else if (count === 3) {
          out.push(Object.assign(base, { role: 'Customer success', startMonth: `${y}-07`, notes: `Plan has ${ctx.fmtNum(goal)} people in ${y}; role not named in the plan` }));
        } else {
          const mm = ['01', '04', '07', '10'][(k - 1) % 4];
          out.push(Object.assign(base, { role: `Hire ${count}`, startMonth: `${y}-${mm}`, notes: `Plan has ${ctx.fmtNum(goal)} people in ${y}; role not named in the plan` }));
        }
      }
    });
    return out;
  }

  function emptyState() {
    const w = ctx.canWrite(), years = ctx.planYears();
    const parts = years.filter(y => planTeam(y) != null).map(y => `${plural(planTeam(y), 'person', 'people')} in ${y}${planPay(y) != null ? ` (${money(planPay(y))} payroll)` : ''}`);
    const seed = planSeed();
    const intro = w
      ? 'List the people on the team and the roles you plan to hire, each with a start month and salary, to see headcount and payroll against the plan.'
      : 'No roles are on the list yet. Once someone with edit access adds the team and planned hires, headcount and payroll show here against the plan.';
    const text = `${intro}${parts.length ? ` The plan has ${listText(parts)}.` : ''}${w && seed.length ? ` Start from the plan’s ${plural(seed.length, 'role')} and fill in names and salaries as you go.` : ''}`;
    const action = w ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${seed.length ? `<button class="btn btn-primary" type="button" data-act="mod" data-mod="${ID}" data-a="seed"${st.busy ? ' disabled' : ''}>Add the plan’s team</button>` : ''}<button class="btn${seed.length ? '' : ' btn-primary'}" type="button" data-act="mod" data-mod="${ID}" data-a="new">Add a role</button></div>` : '';
    return ctx.ui.empty({ title: 'Plan your team and payroll', text, action });
  }

  /* ---------- writes ---------- */
  async function seed() {
    if (st.busy || !ctx.canWrite()) return;
    if (ctx.all(COLL).length) { ctx.toast('Your list already has roles. Add more one at a time.'); return; }
    const list = planSeed();
    if (!list.length) return;
    st.busy = true; ctx.render();
    try {
      let order = maxOrder(), added = 0;
      for (const h of list) {
        const id = await ctx.create(COLL, Object.assign({}, h, { order: ++order, createdAt: ctx.iso(), createdBy: ctx.me() }));
        if (!id) break;
        added++;
      }
      if (added) ctx.toast(added === list.length ? `Added the plan’s team: ${plural(added, 'role')}` : `Added ${plural(added, 'role')} of ${list.length}`);
    } finally { st.busy = false; ctx.render(); }
  }

  function openForm(h) {
    const editing = !!(h && h.id), r = h || {};
    const body = `<div class="row2">${ctx.F.text('team-f-role', 'Role', r.role || '', 'maxlength="80" autocomplete="off" placeholder="e.g. Account executive" required')}${ctx.F.text('team-f-name', 'Name', r.name || '', 'maxlength="80" autocomplete="off" placeholder="Blank until someone is hired"')}</div>`
      + `<div class="row2">${ctx.F.text('team-f-start', 'Start month', isYm(r.startMonth) ? r.startMonth : ctx.addMonths(curYm(), 1), 'type="month" placeholder="YYYY-MM"')}${ctx.F.text('team-f-end', 'End month (optional)', isYm(r.endMonth) ? r.endMonth : '', 'type="month" placeholder="YYYY-MM"')}</div>`
      + `<div class="row2">${ctx.F.money('team-f-salary', 'Annual salary ($, optional)', hasSalary(r) ? r.annualSalary : '', 'placeholder="Not set"')}${ctx.F.select('team-f-status', 'Status', STATUS, statusOf(r))}</div>`
      + ctx.F.area('team-f-notes', 'Notes', r.notes || '', 2);
    ctx.openFormModal({
      title: editing ? 'Edit role' : 'Add role',
      submitLabel: editing ? 'Save changes' : 'Add role',
      body,
      deleteLabel: editing ? 'Delete' : undefined,
      onDelete: editing ? () => confirmDelete(r.id) : undefined,
      onSubmit: async () => {
        const role = ctx.val('team-f-role');
        if (!role) return ctx.formErr('Add the role, like Account executive.', 'team-f-role');
        const startMonth = normYm(ctx.val('team-f-start'));
        if (!startMonth) return ctx.formErr('Pick the start month, like 2027-03.', 'team-f-start');
        const endRaw = ctx.val('team-f-end');
        let endMonth = null;
        if (endRaw) {
          endMonth = normYm(endRaw);
          if (!endMonth) return ctx.formErr('Enter the end month like 2028-06, or leave it blank.', 'team-f-end');
          if (endMonth < startMonth) return ctx.formErr('The end month comes before the start month.', 'team-f-end');
        }
        const salRaw = ctx.val('team-f-salary');
        let annualSalary = null;
        if (salRaw) {
          annualSalary = ctx.parseMoney(salRaw);
          if (annualSalary == null) return ctx.formErr('Enter the annual salary in dollars, like 85000, or leave it blank.', 'team-f-salary');
        }
        const status = STATUS_LABEL[ctx.val('team-f-status')] ? ctx.val('team-f-status') : 'planned';
        const fields = { role, name: ctx.val('team-f-name'), startMonth, endMonth, annualSalary, status, notes: ctx.val('team-f-notes') };
        if (editing) {
          const ok = await ctx.patch(COLL, r.id, Object.assign(fields, { updatedAt: ctx.iso() }));
          if (!ok) return false;
          ctx.toast(`${role} updated`);
          return true;
        }
        const id = await ctx.create(COLL, Object.assign(fields, { order: maxOrder() + 1, createdAt: ctx.iso(), createdBy: ctx.me() }));
        if (!id) return false;
        ctx.toast(`Added ${role}, starting ${mLabel(startMonth)}`);
        return true;
      }
    });
  }

  function confirmDelete(id) {
    const h = ctx.get(COLL, id);
    if (!h) return;
    const who = roleName(h) + (h.name ? ` (${h.name})` : '');
    ctx.openConfirm('Delete this role?', `${who}${startOf(h) ? `, starting ${mLabel(h.startMonth)}` : ''}. It leaves your headcount and payroll plan. This can’t be undone.`, 'Delete role', async () => {
      if (await ctx.remove(COLL, id)) ctx.toast('Role deleted');
    });
  }

  /* ---------- module ---------- */
  return {
    id: ID,
    label: 'Team & hiring',
    group: 'Planning',
    order: 50,
    collections: [COLL],
    newItems: [{ label: 'Role', a: 'new' }],
    badge() {
      if (ctx.isLoading()) return null;
      const late = ctx.all(COLL).filter(pastDue).length;
      return late ? { text: String(late), hot: true, title: `${plural(late, 'planned role')} past ${late === 1 ? 'its' : 'their'} start month` } : null;
    },
    render() {
      const w = ctx.canWrite();
      const add = w ? btn('new', 'Add role', '', 'btn-primary') : '';
      if (ctx.isLoading()) {
        return ctx.ui.toolbar({ title: 'Team & hiring', actions: add }) + '<div class="empty"><p>Loading the team…</p></div>';
      }
      const list = hires();
      if (!list.length) {
        return ctx.ui.toolbar({ title: 'Team & hiring', count: '0 roles', actions: add, exportable: true })
          + emptyState()
          + `<div class="grid grid-2 section">${triggerPanel(list)}</div>`;
      }
      const rows = yearRows(list);
      return ctx.ui.toolbar({ title: 'Team & hiring', count: plural(list.length, 'role'), actions: add, exportable: true })
        + kpiRow(list)
        + `<div class="section">${vsPlanPanel(list, rows)}</div>`
        + `<div class="grid grid-2 section">${chartPanel(rows)}${triggerPanel(list)}</div>`
        + `<div class="section">${rolesPanel(list)}</div>`;
    },
    onAction(a, d) {
      if (a === 'new') return openForm(null);
      if (a === 'edit') { const h = ctx.get(COLL, d.id); if (h) openForm(h); else ctx.toast('That role no longer exists.', 'bad'); return; }
      if (a === 'delete') return confirmDelete(d.id);
      if (a === 'seed') return seed();
    },
    csv() {
      const rows = [['Role', 'Name', 'Status', 'Start month', 'End month', 'Annual salary', 'Notes', 'Created']];
      hires().forEach(h => {
        rows.push([roleName(h), h.name || '', STATUS_LABEL[statusOf(h)], startOf(h) || '', endOf(h) || '', hasSalary(h) ? Number(h.annualSalary) : '', h.notes || '', ctx.isoToYmd(h.createdAt)]);
      });
      return { name: 'team', rows };
    }
  };
});
