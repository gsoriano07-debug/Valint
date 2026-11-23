(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';

  /* What-if inputs, kept as typed so the next render shows them. */
  var whatIf = { extraSpend: '', extraIncome: '' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PROJECT_MONTHS = 12;

  function round2(n) { return (Math.round(ctx.num(n) * 100) / 100) || 0; }
  /* Exact dollars and cents for recorded cash; whole dollars for estimates. */
  function money(n) { return ctx.fmtPrice(round2(n)); }
  function signed(n) { var v = round2(n); return (v > 0 ? '+' : '') + money(v); }
  function monYear(ym) { var p = String(ym).split('-'); return (MONTHS[Number(p[1]) - 1] || '') + ' ' + p[0]; }
  function negCls(n) { return round2(n) < 0 ? ' neg' : ''; }

  /* Everything the tab shows, computed once per render from the shared finance helpers. */
  function model() {
    var F = ctx.finance();
    var today = ctx.todayStr();
    var cur = ctx.ymOf(today);
    var openYm = ctx.ymOf(F.openingDate);
    var first = openYm <= cur ? openYm : cur;
    var rows = ctx.cashByMonth(first, cur);
    var flows = ctx.cashFlows(ctx.monthEnd(cur));
    var burn = ctx.burnRate();
    var cash = ctx.cashOn(today);
    var curRow = rows[rows.length - 1] || { ym: cur, cashIn: 0, cashOut: 0, net: 0, end: cash };
    var proj = [];
    for (var k = 1; k <= PROJECT_MONTHS; k++) {
      proj.push({ ym: ctx.addMonths(cur, k), change: -burn.monthly, end: curRow.end - burn.monthly * k });
    }
    var todayFlows = ctx.cashFlows(today);
    return {
      F: F, today: today, cur: cur, rows: rows, burn: burn, cash: cash, curRow: curRow, proj: proj,
      runway: ctx.runwayMonths(), hasFlows: flows.ins.length + flows.outs.length > 0,
      inToDate: ctx.sum(todayFlows.ins, function (x) { return x.amount; }),
      outToDate: ctx.sum(todayFlows.outs, function (x) { return x.amount; })
    };
  }

  /* Runway text for a given cash balance and monthly net burn. */
  function runwayInfo(cash, burnMonthly, today) {
    if (!(burnMonthly > 0)) return { months: Infinity, text: 'Not burning cash', until: burnMonthly < 0 ? 'Cash in covers cash out' : 'No net cash going out', tone: 'good' };
    var r = Math.max(0, cash / burnMonthly);
    var tone = r < 6 ? 'bad' : r < 12 ? 'warn' : '';
    if (r <= 0) return { months: 0, text: '0 months', until: 'Cash is at or below zero', tone: 'bad' };
    if (r >= 120) return { months: r, text: 'Over 10 years', until: 'At this burn rate', tone: tone };
    var end = ctx.addDays(today, Math.round(r * 30.4375));
    return { months: r, text: ctx.fmtNum(r, 1) + ' months', until: 'until ' + monYear(ctx.ymOf(end)), tone: tone };
  }

  function whatIfNumbers(m) {
    var spend = ctx.parseMoney(whatIf.extraSpend), income = ctx.parseMoney(whatIf.extraIncome);
    var bad = spend == null || income == null;
    var b = m.burn.monthly + (spend || 0) - (income || 0);
    return { burn: b, run: runwayInfo(m.cash, b, m.today), bad: bad };
  }
  function burnText(b) {
    var v = Math.round(b);
    if (v > 0) return ctx.fmtMoney(v) + ' a month';
    return v < 0 ? 'Cash-flow positive (' + ctx.fmtMoney(-v) + ' a month in)' : 'Break-even ($0 a month)';
  }
  function runText(run) { return run.months === Infinity ? run.text : run.text + ', ' + run.until.replace(/^Cash/, 'cash').replace(/^At/, 'at'); }

  function kpis(m) {
    var b = m.burn.monthly;
    var basis = String(m.burn.basis || '');
    basis = basis.charAt(0).toUpperCase() + basis.slice(1);
    var run = runwayInfo(m.cash, b, m.today);
    return '<section class="kpis">' +
      ctx.ui.kpi({ label: 'Cash on hand', value: money(m.cash), tone: m.cash < 0 ? 'bad' : '',
        sub: money(m.F.openingCash) + ' opening + ' + money(m.inToDate) + ' in &minus; ' + money(m.outToDate) + ' out' }) +
      (m.hasFlows
        ? ctx.ui.kpi({ label: 'Net burn / month', value: b > 0 ? ctx.fmtMoney(b) : 'Cash-flow positive', tone: b > 0 ? '' : 'good',
          sub: ctx.esc(basis) + (Math.round(b) < 0 ? ' (' + ctx.fmtMoney(-b) + ' a month in)' : '') })
        /* Nothing recorded yet: do not claim the company is cash-flow positive. */
        : ctx.ui.kpi({ label: 'Net burn / month', value: ctx.fmtMoney(0), sub: 'Nothing recorded since ' + ctx.esc(ctx.fmtDate(m.F.openingDate)) })) +
      ctx.ui.kpi({ label: 'Runway', value: ctx.esc(run.text), tone: run.tone === 'good' ? 'good' : run.tone, sub: ctx.esc(run.until) }) +
      ctx.ui.kpi({ label: 'This month in / out', value: money(m.curRow.cashIn) + ' / ' + money(m.curRow.cashOut),
        sub: 'Net ' + signed(m.curRow.net) + ' in ' + monYear(m.cur) }) +
      '</section>';
  }

  function charts(m) {
    var labels = m.rows.map(function (r) { return ctx.monthLabel(r.ym); }).concat(m.proj.map(function (p) { return ctx.monthLabel(p.ym); }));
    var n = m.rows.length;
    var actual = m.rows.map(function (r) { return round2(r.end); }).concat(m.proj.map(function () { return null; }));
    var projected = m.rows.map(function (r, i) { return i === n - 1 ? round2(r.end) : null; }).concat(m.proj.map(function (p) { return round2(p.end); }));
    var zero = null;
    for (var i = 0; i < m.proj.length; i++) { if (m.proj[i].end < 0) { zero = m.proj[i].ym; break; } }
    var b = m.burn.monthly;
    var lineNote = 'With what is recorded so far, ' + monYear(m.cur) + ' ends at ' + money(m.curRow.end) + '. ' +
      (b > 0
        ? 'At ' + ctx.fmtMoney(b) + ' a month net burn, ' + (round2(m.curRow.end) < 0 ? 'the balance is already below zero and keeps falling.' : zero ? 'the balance drops below zero in ' + monYear(zero) + '.' : 'it stays above zero for the next ' + PROJECT_MONTHS + ' months.')
        : 'Cash in covers cash out, so the projection does not fall.');
    var line = ctx.ui.panel({
      title: 'Month-end cash', sub: 'actual, then ' + PROJECT_MONTHS + ' months at the current burn',
      body: ctx.chart.line({
        labels: labels, height: 240, refLine: { value: 0, label: 'Zero cash' },
        ariaLabel: 'Month-end cash from ' + monYear(m.rows[0].ym) + ' to ' + monYear(m.cur) + ', projected to ' + monYear(m.proj[m.proj.length - 1].ym),
        series: [
          { name: 'Actual', values: actual, color: 'var(--viz-1)' },
          { name: 'Projected at current burn', values: projected, color: 'var(--viz-plan)', dashed: true }
        ]
      }) + '<p class="note">' + lineNote + '</p>'
    });
    var bars = ctx.ui.panel({
      title: 'Cash in and out', sub: 'by month',
      body: ctx.chart.bars({
        labels: m.rows.map(function (r) { return ctx.monthLabel(r.ym); }), height: 240,
        ariaLabel: 'Cash in and cash out by month',
        series: [
          { name: 'Cash in', values: m.rows.map(function (r) { return round2(r.cashIn); }), color: 'var(--viz-3)' },
          { name: 'Cash out', values: m.rows.map(function (r) { return round2(r.cashOut); }), color: 'var(--viz-2)' }
        ]
      }) + '<p class="note">Cash in is paid invoices; cash out is recorded expenses. The table below has the same numbers.</p>'
    });
    return '<div class="grid grid-2 section">' + line + bars + '</div>';
  }

  function tables(m) {
    var tIn = ctx.sum(m.rows, function (r) { return r.cashIn; }), tOut = ctx.sum(m.rows, function (r) { return r.cashOut; });
    var body = m.rows.slice().reverse().map(function (r) {
      return '<tr><td>' + monYear(r.ym) + (r.ym === m.cur ? ' <span class="muted">so far</span>' : '') + '</td>' +
        '<td class="num">' + money(r.cashIn) + '</td><td class="num">' + money(r.cashOut) + '</td>' +
        '<td class="num' + negCls(r.net) + '">' + signed(r.net) + '</td>' +
        '<td class="num' + negCls(r.end) + '">' + money(r.end) + '</td></tr>';
    }).join('');
    var total = m.rows.length > 1
      ? '<tr><td><strong>Total</strong></td><td class="num"><strong>' + money(tIn) + '</strong></td><td class="num"><strong>' + money(tOut) + '</strong></td>' +
        '<td class="num' + negCls(tIn - tOut) + '"><strong>' + signed(tIn - tOut) + '</strong></td><td></td></tr>'
      : '';
    var monthly = ctx.ui.panel({
      title: 'Monthly cash', sub: 'since ' + ctx.fmtDate(m.F.openingDate),
      body: '<div class="table-wrap flat"><table class="compact"><thead><tr><th>Month</th><th class="num">Cash in</th><th class="num">Cash out</th><th class="num">Net</th><th class="num">End balance</th></tr></thead><tbody>' +
        body + total + '</tbody></table></div>' +
        '<p class="note">Starts from the ' + money(m.F.openingCash) + ' opening balance on ' + ctx.fmtDate(m.F.openingDate) + '.</p>'
    });
    var projRows = m.proj.map(function (p) {
      return '<tr><td>' + monYear(p.ym) + '</td><td class="num' + negCls(p.change) + '">' + (p.change > 0 ? '+' : '') + ctx.fmtMoney(p.change) + '</td>' +
        '<td class="num' + negCls(p.end) + '">' + ctx.fmtMoney(p.end) + '</td></tr>';
    }).join('');
    var proj = ctx.ui.panel({
      title: 'Projection', sub: 'at ' + (m.burn.monthly > 0 ? ctx.fmtMoney(m.burn.monthly) + ' a month net burn' : 'the current net cash flow'),
      body: '<div class="table-wrap flat"><table class="compact" style="min-width:0"><thead><tr><th>Month</th><th class="num">Change</th><th class="num">Month-end cash</th></tr></thead><tbody>' +
        projRows + '</tbody></table></div>' +
        '<p class="note">Starts from ' + monYear(m.cur) + '’s ' + money(m.curRow.end) + ' and applies the current net burn (' + ctx.esc(String(m.burn.basis || '')) + ') every month. New customers and hires are not included.</p>'
    });
    return '<div class="grid grid-2 section">' + monthly + proj + '</div>';
  }

  function openingPanel(m) {
    var doc = ctx.get('settings', 'finance');
    var isDefault = !doc || doc.openingCash == null || doc.openingCash === '';
    var startup = ctx.num(ctx.plan().startupCosts);
    /* finance() falls back to FIN_DEFAULTS, which can differ from the plan's startupCosts once the plan is edited. */
    var def = ctx.FIN_DEFAULTS && ctx.FIN_DEFAULTS.openingCash != null ? ctx.num(ctx.FIN_DEFAULTS.openingCash) : startup;
    var before = ctx.all('expenses').filter(function (x) { return x.date && x.date < m.F.openingDate; });
    var beforeAmt = ctx.sum(before, function (x) { return ctx.num(x.amount); });
    var body = '<dl class="stat-list">' +
      '<div class="stat-row"><dt>Opening balance</dt><dd>' + money(m.F.openingCash) + '</dd></div>' +
      '<div class="stat-row"><dt>As of</dt><dd>' + ctx.esc(ctx.fmtDate(m.F.openingDate)) + '</dd></div>' +
      (m.F.note ? '<div class="stat-row"><dt>Note</dt><dd style="font-family:inherit">' + ctx.esc(m.F.note) + '</dd></div>' : '') +
      '</dl>' +
      '<p class="note">' + (isDefault ? 'This is still the default: ' : 'The default is ') + ctx.fmtMoney(def) +
      ', the plan’s founder-funded startup costs' + (Math.round(startup) !== Math.round(def) ? ' (the plan now lists ' + ctx.fmtMoney(startup) + ')' : '') + '. Replace it with your real bank balance on the day you start tracking; cash on hand adds paid invoices and subtracts expenses from that date.</p>' +
      (before.length ? '<p class="note">' + before.length + ' expense' + (before.length === 1 ? '' : 's') + ' (' + money(beforeAmt) + ') dated before ' + ctx.fmtDate(m.F.openingDate) +
        (before.length === 1 ? ' is' : ' are') + ' not counted, since the opening balance already reflects ' + (before.length === 1 ? 'it' : 'them') + '.</p>' : '');
    return ctx.ui.panel({
      title: 'Opening balance', sub: isDefault ? 'plan default' : '',
      actions: ctx.canWrite() ? '<button class="btn btn-sm" type="button" data-act="mod" data-mod="cash" data-a="edit-opening">Edit</button>' : '',
      body: body
    });
  }

  function whatIfPanel(m) {
    var w = whatIfNumbers(m);
    var inputs = '<div class="row2">' +
      ctx.F.money('cash-whatif-spend', 'Extra spend per month', whatIf.extraSpend, 'placeholder="0" data-mod-input="cash" data-key="extraSpend"') +
      ctx.F.money('cash-whatif-income', 'Extra income per month', whatIf.extraIncome, 'placeholder="0" data-mod-input="cash" data-key="extraIncome"') +
      '</div>';
    var out = '<dl class="stat-list" style="margin-top:14px">' +
      '<div class="stat-row"><dt>Net burn</dt><dd id="cash-whatif-burn">' + ctx.esc(burnText(w.burn)) + '</dd></div>' +
      '<div class="stat-row total"><dt>Runway</dt><dd id="cash-whatif-runway">' + ctx.esc(runText(w.run)) + '</dd></div>' +
      '</dl>' +
      '<p class="note" id="cash-whatif-msg"' + (w.bad ? '' : ' hidden') + '>Use plain dollar amounts, like 500. Anything else counts as $0.</p>' +
      '<p class="note">Try a hire, a new tool or a few more paying locations. Nothing here is saved.</p>';
    return ctx.ui.panel({ title: 'What if', sub: 'from ' + money(m.cash) + ' on hand', body: inputs + out });
  }

  function planPanel() {
    var P = ctx.plan();
    var years = ctx.planYears();
    var sumRows = ctx.planYearSummary(ctx.planModel('base'));
    var byYear = {};
    sumRows.forEach(function (r) { byYear[r.year] = r; });
    var targets = Array.isArray(P.targets) ? P.targets : [];
    function docOp(y) {
      var t = null;
      targets.forEach(function (x) { if (x && String(x.date || '').slice(0, 4) === String(y) && x.opIncome != null && x.opIncome !== '') t = x; });
      return t ? ctx.num(t.opIncome) : null;
    }
    var firstDoc = null, firstModel = null;
    var rows = years.map(function (y) {
      var mo = byYear[y] ? byYear[y].opIncome : null, d = docOp(y);
      if (firstDoc == null && d != null && d > 0) firstDoc = y;
      if (firstModel == null && mo != null && mo > 0) firstModel = y;
      return '<tr><td>' + y + '</td>' +
        '<td class="num' + (mo != null ? negCls(mo) : '') + '">' + (mo == null ? '—' : ctx.fmtMoney(mo)) + '</td>' +
        '<td class="num' + (d != null ? negCls(d) : '') + '">' + (d == null ? '—' : ctx.fmtMoney(d)) + '</td></tr>';
    }).join('');
    var y1 = firstDoc != null ? firstDoc : firstModel;
    var line = y1 != null
      ? 'The plan expects Valint to be cash-flow positive in ' + y1 + ', so today’s burn should end as paid locations ramp up.'
      : 'Neither the plan doc nor the model shows positive operating income in the plan years.';
    return ctx.ui.panel({
      title: 'Plan check', sub: 'operating income, base case',
      body: '<div class="table-wrap flat"><table class="compact" style="min-width:0"><thead><tr><th>Year</th><th class="num">Model</th><th class="num">Plan doc</th></tr></thead><tbody>' +
        rows + '</tbody></table></div><p class="note">' + ctx.esc(line) + '</p>' +
        '<p class="source">Model: month-by-month plan model. Plan doc: the projections document. Edit either on the Assumptions tab.</p>'
    });
  }

  function emptyBlock(m) {
    return '<div class="section">' + ctx.ui.empty({
      title: 'No cash in or out yet',
      text: 'Paid invoices and expenses dated ' + ctx.fmtDate(m.F.openingDate) + ' or later appear here month by month, with a chart of month-end cash and a 12-month projection. Record your first expense or mark an invoice paid to start.',
      action: '<div class="row-actions" style="justify-content:center"><button class="btn btn-sm" type="button" data-act="go" data-view="expenses">Go to Expenses</button><button class="btn btn-sm" type="button" data-act="go" data-view="invoices">Go to Invoices</button></div>'
    }) + '</div>';
  }

  function openEdit() {
    var F = ctx.finance();
    ctx.openFormModal({
      title: 'Opening balance',
      submitLabel: 'Save balance',
      body: '<div class="row2">' + ctx.F.money('cash-open-amount', 'Bank balance', F.openingCash) + ctx.F.date('cash-open-date', 'As of', F.openingDate) + '</div>' +
        ctx.F.text('cash-open-note', 'Note', F.note, 'placeholder="e.g. Business checking, from the bank statement"') +
        '<p class="note">Cash on hand starts here, then adds paid invoices and subtracts expenses dated on or after this day.</p>',
      onSubmit: async function () {
        var amt = ctx.parseMoney(ctx.val('cash-open-amount'));
        if (amt == null) return ctx.formErr('Enter the balance in dollars, like 12500.', 'cash-open-amount');
        var date = ctx.val('cash-open-date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !ctx.parseYmd(date)) return ctx.formErr('Pick the date of that balance.', 'cash-open-date');
        var cur = Object.assign({}, ctx.get('settings', 'finance') || {});
        delete cur.id; /* the record's id is not a stored field */
        var ok = await ctx.setDoc('settings', 'finance', Object.assign(cur, {
          openingCash: amt, openingDate: date, note: ctx.val('cash-open-note'), updatedAt: ctx.iso()
        }));
        if (ok) ctx.toast('Opening balance saved');
        return !!ok;
      }
    });
  }

  return {
    id: 'cash',
    label: 'Cash & runway',
    group: 'Finance',
    order: 40,
    collections: ['invoices', 'expenses'],

    render: function () {
      var loading = ctx.isLoading();
      if (loading) {
        return ctx.ui.toolbar({ title: 'Cash & runway' }) + '<div class="empty"><p>Loading cash…</p></div>';
      }
      var m = model();
      var head = ctx.ui.toolbar({ title: 'Cash & runway', count: 'since ' + ctx.fmtDate(m.F.openingDate), exportable: true });
      var body = m.hasFlows ? charts(m) + tables(m) : emptyBlock(m);
      return head + kpis(m) + body +
        '<div class="grid grid-3 section">' + openingPanel(m) + whatIfPanel(m) + planPanel() + '</div>';
    },

    onAction: function (a) {
      if (a === 'edit-opening') openEdit();
    },

    onInput: function (key, el) {
      if (key !== 'extraSpend' && key !== 'extraIncome') return;
      whatIf[key] = el ? String(el.value || '') : '';
      var w = whatIfNumbers(model());
      var b = document.getElementById('cash-whatif-burn');
      if (b) b.textContent = burnText(w.burn);
      var r = document.getElementById('cash-whatif-runway');
      if (r) r.textContent = runText(w.run);
      var msg = document.getElementById('cash-whatif-msg');
      if (msg) msg.hidden = !w.bad;
    },

    csv: function () {
      var m = model();
      return {
        name: 'cash',
        rows: [['Month', 'Cash in', 'Cash out', 'Net', 'End balance']].concat(m.rows.map(function (r) {
          return [r.ym, round2(r.cashIn), round2(r.cashOut), round2(r.net), round2(r.end)];
        }))
      };
    }
  };
});
