/* Invoices tab: a record of what each customer was billed, what they still owe and what has been paid.
   These are records only; the founder sends the actual invoice from email or a billing tool. */
(window.__dbViews = window.__dbViews || []).push(function (ctx) {
  'use strict';
  const ID = 'invoices';
  const esc = ctx.esc;
  const TERMS_DAYS = 14;      // default payment terms: due 14 days after the issue date
  const MAX_LINES = 5;        // line rows shown in the form
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const FILTERS = [['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']];
  const BUCKETS = [
    { label: 'Not yet due', short: 'Not due', test: d => d <= 0 },
    { label: '1–30 days', short: '1–30', test: d => d >= 1 && d <= 30 },
    { label: '31–60 days', short: '31–60', test: d => d >= 31 && d <= 60 },
    { label: '61–90 days', short: '61–90', test: d => d >= 61 && d <= 90 },
    { label: '90+ days', short: '90+', test: d => d > 90 }
  ];
  const LINE_GRID = 'display:grid;grid-template-columns:minmax(0,1fr) 64px 100px;gap:8px;align-items:center';

  const state = { filter: 'all' };
  /* Per-form state for the invoice modal that is open right now. */
  let form = { rows: MAX_LINES, dueEdited: false };

  /* ---------- helpers ---------- */
  const s = n => (n === 1 ? '' : 's');
  const round2 = n => Math.round(ctx.num(n) * 100) / 100;
  const money = n => ctx.fmtPrice(round2(n));
  const invoices = () => ctx.all('invoices');
  const total = inv => ctx.invoiceTotal(inv);
  const coName = inv => { const c = ctx.company(inv.companyId); return c ? (c.name || 'Unnamed company') : ''; };
  const dealName = inv => { const d = ctx.deal(inv.dealId); return d ? (d.name || 'Untitled deal') : ''; };
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  function daysBetween(from, to) {
    const a = ctx.parseYmd(from), b = ctx.parseYmd(to);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / 864e5);
  }
  /* Days past the due date as of today (0 or less = not yet due; no due date = not yet due). */
  function daysPastDue(inv, today) { const d = daysBetween(inv.dueDate, today); return d == null ? 0 : d; }
  function monYear(ymd) {
    const d = ctx.parseYmd(ymd) || ctx.parseYmd(ctx.todayStr());
    return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function monthLong(ym) {
    const m = Number(String(ym).slice(5, 7)), y = String(ym).slice(0, 4);
    return (MONTHS_LONG[m - 1] || '') + ' ' + y;
  }
  function nextNumber() {
    let max = 0;
    invoices().forEach(i => { const m = /(\d+)\s*$/.exec(String(i.number || '')); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return 'INV-' + String(max + 1).padStart(4, '0');
  }
  const byIssueDesc = (a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')) || String(b.number || '').localeCompare(String(a.number || ''));
  function actBtn(a, label, inv, cls) {
    return `<button class="btn btn-sm ${cls || ''}" type="button" data-act="mod" data-mod="${ID}" data-a="${a}" data-id="${esc(inv.id)}" aria-label="${esc(label + ' ' + (inv.number || 'invoice'))}">${esc(label)}</button>`;
  }
  function statusChip(inv, st, today) {
    if (st === 'overdue') { const n = daysPastDue(inv, today); return ctx.ui.chip(`Overdue · ${n} day${s(n)}`, 'bad'); }
    if (st === 'sent') return ctx.ui.chip('Sent', 'accent');
    if (st === 'paid') return ctx.ui.chip(inv.paidDate ? 'Paid · ' + ctx.fmtShort(inv.paidDate) : 'Paid', 'good');
    if (st === 'void') return ctx.ui.chip('Void');
    if (st === 'draft') return ctx.ui.chip('Draft');
    return ctx.ui.chip(String(st));
  }

  /* ---------- numbers ---------- */
  function summary(list, today) {
    const sent = list.filter(i => i.status === 'sent');                       // includes overdue
    const overdue = sent.filter(i => ctx.invoiceStatus(i) === 'overdue');
    const ym = ctx.ymOf(today);
    const paidMonth = list.filter(i => i.status === 'paid' && i.paidDate && ctx.ymOf(i.paidDate) === ym);
    const drafts = list.filter(i => ctx.invoiceStatus(i) === 'draft');
    const aging = BUCKETS.map(b => {
      const inB = sent.filter(i => b.test(daysPastDue(i, today)));
      return { label: b.label, short: b.short, count: inB.length, amount: round2(ctx.sum(inB, total)) };
    });
    return {
      sent, overdue, paidMonth, drafts, aging, ym,
      outAmt: round2(ctx.sum(sent, total)),
      odAmt: round2(ctx.sum(overdue, total)),
      odOldest: overdue.reduce((m, i) => Math.max(m, daysPastDue(i, today)), 0),
      paidAmt: round2(ctx.sum(paidMonth, total)),
      draftAmt: round2(ctx.sum(drafts, total))
    };
  }

  /* ---------- render ---------- */
  function newButton(primary, label) {
    return `<button class="btn ${primary ? 'btn-primary' : 'btn-sm'}" type="button" data-act="mod" data-mod="${ID}" data-a="new">${esc(label)}</button>`;
  }

  function kpisHtml(k) {
    return `<section class="kpis" aria-label="Invoice summary">${[
      ctx.ui.kpi({
        label: 'Outstanding', value: money(k.outAmt),
        sub: k.sent.length ? `${k.sent.length} sent invoice${s(k.sent.length)} awaiting payment` : 'No sent invoices awaiting payment'
      }),
      ctx.ui.kpi({
        label: 'Overdue', value: money(k.odAmt), tone: k.overdue.length || k.odAmt > 0 ? 'bad' : '',
        sub: k.overdue.length ? `${k.overdue.length} invoice${s(k.overdue.length)} past due · oldest ${k.odOldest} day${s(k.odOldest)}` : 'Nothing past due'
      }),
      ctx.ui.kpi({
        label: 'Paid this month', value: money(k.paidAmt),
        sub: k.paidMonth.length ? `${k.paidMonth.length} payment${s(k.paidMonth.length)} in ${esc(monthLong(k.ym))}` : `No payments yet in ${esc(monthLong(k.ym))}`
      }),
      ctx.ui.kpi({
        label: 'Drafts', value: String(k.drafts.length),
        sub: k.drafts.length ? `${money(k.draftAmt)} not sent yet` : 'Nothing waiting to send'
      })
    ].join('')}</section>`;
  }

  function agingHtml(k, today) {
    const sub = `Sent, unpaid invoices by days past due, as of ${ctx.fmtDate(today)}`;
    if (!k.sent.length) {
      return `<div class="section">${ctx.ui.panel({
        title: 'Receivables aging', sub,
        body: '<p class="note" style="margin:0">Nothing is owed right now. When you mark an invoice sent, it shows here by how late it is until you record the payment.</p>'
      })}</div>`;
    }
    const rows = k.aging.map(b => `<tr><td>${esc(b.label)}</td><td class="num">${b.count}</td><td class="num">${money(b.amount)}</td><td class="num">${k.outAmt > 0 ? ctx.fmtPct(b.amount / k.outAmt, 0) : '—'}</td></tr>`).join('');
    const table = `<table class="compact" style="min-width:0"><thead><tr><th>Days past due</th><th class="num">Invoices</th><th class="num">Owed</th><th class="num">Share</th></tr></thead>
      <tbody>${rows}<tr style="font-weight:600"><td>Total</td><td class="num">${k.sent.length}</td><td class="num">${money(k.outAmt)}</td><td class="num">${k.outAmt > 0 ? '100%' : '—'}</td></tr></tbody></table>`;
    const chart = ctx.chart.bars({
      labels: k.aging.map(b => b.short),
      series: [{ name: 'Owed', values: k.aging.map(b => b.amount), color: 'var(--viz-1)' }],
      height: 200, format: ctx.fmtCompact,
      ariaLabel: 'Amount owed by days past due: ' + k.aging.map(b => `${b.label} ${money(b.amount)}`).join(', ')
    });
    return `<div class="section">${ctx.ui.panel({
      title: 'Receivables aging', sub,
      body: `<div class="grid grid-2" style="align-items:start"><div style="overflow-x:auto">${table}</div><div>${chart}</div></div>`
    })}</div>`;
  }

  function rowHtml(inv, can, today) {
    const st = ctx.invoiceStatus(inv);
    const co = ctx.company(inv.companyId);
    const dn = dealName(inv);
    const cust = co
      ? `<button class="link" type="button" data-act="mod" data-mod="${ID}" data-a="open-co" data-id="${esc(co.id)}">${esc(co.name || 'Unnamed company')}</button>`
      : '<span class="muted">No customer</span>';
    let acts = '';
    if (can) {
      if (st === 'draft') acts += actBtn('send', 'Mark sent', inv);
      if (st === 'sent' || st === 'overdue') acts += actBtn('pay', 'Record payment', inv);
      if (st === 'paid') acts += actBtn('unpay', 'Undo payment', inv, 'btn-ghost');
      acts += actBtn('edit', 'Edit', inv, 'btn-ghost');
      if (st === 'draft' || st === 'sent' || st === 'overdue') acts += actBtn('void', 'Void', inv, 'btn-ghost');
      acts += actBtn('delete', 'Delete', inv, 'btn-ghost btn-danger');
    }
    return `<tr id="${ID}-row-${esc(inv.id)}">
      <td class="mono" style="white-space:nowrap">${esc(inv.number || '—')}</td>
      <td><div class="trunc">${cust}</div>${dn ? `<div class="cell-sub trunc">${esc(dn)}</div>` : ''}</td>
      <td style="white-space:nowrap">${esc(ctx.fmtDate(inv.issueDate)) || '<span class="muted">—</span>'}</td>
      <td style="white-space:nowrap">${esc(ctx.fmtDate(inv.dueDate)) || '<span class="muted">—</span>'}</td>
      <td class="num">${money(total(inv))}</td>
      <td>${statusChip(inv, st, today)}</td>
      ${can ? `<td><div class="row-actions">${acts}</div></td>` : ''}
    </tr>`;
  }

  function render() {
    const loading = ctx.isLoading();
    const can = ctx.canWrite();
    const list = invoices();
    const today = ctx.todayStr();
    if (loading) {
      return ctx.ui.toolbar({ title: 'Invoices' }) + '<div class="empty"><p>Loading invoices…</p></div>';
    }
    if (!list.length) {
      return ctx.ui.toolbar({ title: 'Invoices', count: '0', actions: can ? newButton(false, 'New invoice') : '' }) + ctx.ui.empty({
        title: 'No invoices yet',
        text: 'Record each invoice you bill: customer, line items and due date. This tab then shows what customers owe, what is overdue and what has been paid. Invoices here are records only; send the invoice itself from email or your billing tool.',
        action: can ? newButton(true, 'Record your first invoice') : ''
      });
    }

    const searched = list.filter(i => ctx.matches(i.number, coName(i)));
    const counts = { all: searched.length };
    searched.forEach(i => { const st = ctx.invoiceStatus(i); counts[st] = (counts[st] || 0) + 1; });
    const seg = `<div class="seg" role="group" aria-label="Filter invoices by status" style="max-width:100%;overflow-x:auto;white-space:nowrap">${FILTERS.map(f =>
      `<button type="button" data-act="mod" data-mod="${ID}" data-a="filter" data-v="${f[0]}" aria-pressed="${state.filter === f[0]}">${f[1]} <span style="opacity:.7;font-weight:500">${counts[f[0]] || 0}</span></button>`).join('')}</div>`;
    const head = ctx.ui.toolbar({
      title: 'Invoices', count: String(list.length), filters: seg, exportable: true,
      actions: can ? newButton(false, 'New invoice') : ''
    });

    const k = summary(list, today);
    const shown = searched.filter(i => state.filter === 'all' || ctx.invoiceStatus(i) === state.filter).sort(byIssueDesc);

    let table;
    if (!shown.length) {
      const q = String(ctx.S.q || '').trim();
      const fl = (FILTERS.find(f => f[0] === state.filter) || FILTERS[0])[1].toLowerCase();
      const clear = state.filter !== 'all' ? `<button class="btn btn-sm" type="button" data-act="mod" data-mod="${ID}" data-a="filter" data-v="all">Show all invoices</button>` : '';
      table = q
        ? `<div class="empty"><h2>No ${state.filter === 'all' ? '' : esc(fl) + ' '}invoices match “${esc(q)}”</h2><p>Search by invoice number or customer name, or clear the search.</p>${clear}</div>`
        : `<div class="empty"><h2>No ${esc(fl)} invoices</h2><p>${state.filter === 'overdue' ? 'Every sent invoice is still within its due date.' : 'Invoices with this status will appear here.'}</p>${clear}</div>`;
    } else {
      table = `<div class="table-wrap" style="margin-bottom:8px"><table class="compact" id="${ID}-table">
        <thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Due</th><th class="num">Total</th><th>Status</th>${can ? '<th class="num"><span class="muted" style="font-weight:600">Actions</span></th>' : ''}</tr></thead>
        <tbody>${shown.map(i => rowHtml(i, can, today)).join('')}</tbody></table></div>
        <p class="note" style="margin-bottom:28px">${shown.length} of ${list.length} invoice${s(list.length)} shown. Invoices here are records of what you billed: send the invoice itself from email or your billing tool, then mark it sent here so it counts as owed.</p>`;
    }
    return head + kpisHtml(k) + agingHtml(k, today) + table;
  }

  /* ---------- invoice form ---------- */
  function dealOpts(companyId) {
    const ds = companyId ? ctx.all('deals').filter(d => d.companyId === companyId).sort(byName) : [];
    const first = ds.length ? 'No deal' : (companyId ? 'No deals for this customer' : 'Choose a customer first');
    return [['', first]].concat(ds.map(d => [d.id, `${d.name || 'Untitled deal'} · ${ctx.stageOf(d).name}${ctx.priced(d) ? ` · ${ctx.locs(d)} location${s(ctx.locs(d))}` : ''}`]));
  }
  const optsHtml = (opts, sel) => opts.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String(sel || '') ? ' selected' : ''}>${esc(o[1])}</option>`).join('');

  /* Reads the line rows. Blank rows are skipped; a blank quantity counts as 1.
     The running total covers every complete line, even after an earlier line has an error. */
  function readLines() {
    const lines = [];
    let running = 0, err = null;
    for (let n = 1; n <= form.rows; n++) {
      const d = ctx.val(`inv-line-${n}-desc`), q = ctx.val(`inv-line-${n}-qty`), p = ctx.val(`inv-line-${n}-price`);
      if (!d && !q && !p) continue;
      const qty = q === '' ? 1 : round2(Number(q.replace(/,/g, '')));   // rounded as saved, so 0.001 does not pass as > 0
      const price = p === '' ? null : ctx.parseMoney(p);
      if (qty > 0 && price != null) running += qty * price;
      if (err) continue;
      if (!d) err = { error: `Describe line ${n}, like “Setup fee”.`, focus: `inv-line-${n}-desc` };
      else if (!(qty > 0)) err = { error: `Enter a quantity above 0 on line ${n}.`, focus: `inv-line-${n}-qty` };
      else if (price == null) err = { error: `Enter a unit price of 0 or more on line ${n}, like ${ctx.priceFor(ctx.val(`${ID}-issue`) || ctx.todayStr())}.`, focus: `inv-line-${n}-price` };
      else lines.push({ description: d, qty, unitPrice: price });
    }
    return err ? Object.assign(err, { running }) : { lines, running };
  }

  function formBody(inv, number) {
    const t = ctx.todayStr();
    const issue = inv && ctx.parseYmd(inv.issueDate) ? inv.issueDate : t;
    const due = (inv && inv.dueDate) || ctx.addDays(issue, TERMS_DAYS);
    const coId = inv && ctx.company(inv.companyId) ? inv.companyId : '';
    const coOpts = [['', 'Choose a customer']].concat(ctx.all('companies').slice().sort(byName).map(c => [c.id, c.name || 'Unnamed company']));
    const lines = inv && Array.isArray(inv.lines) ? inv.lines : [];
    let rows = '';
    for (let n = 1; n <= form.rows; n++) {
      const l = lines[n - 1] || {};
      rows += `<div style="${LINE_GRID}">
        <input class="input" id="inv-line-${n}-desc" aria-label="Line ${n} description" value="${esc(l.description == null ? '' : l.description)}">
        <input class="input mono" id="inv-line-${n}-qty" inputmode="decimal" placeholder="1" aria-label="Line ${n} quantity" value="${esc(l.qty == null ? '' : l.qty)}">
        <input class="input mono" id="inv-line-${n}-price" inputmode="decimal" aria-label="Line ${n} unit price in dollars" value="${esc(l.unitPrice == null ? '' : l.unitPrice)}">
      </div>`;
    }
    const p = ctx.plan();
    const quick = `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span class="muted" style="font-size:13px">Quick add</span>
      <button class="btn btn-sm" type="button" id="${ID}-add-setup" title="One-time setup fee, ${esc(money(ctx.setupFee()))}">Setup fee</button>
      <button class="btn btn-sm" type="button" id="${ID}-add-sub" title="One month per location at the plan price for the issue date's year">Monthly subscription</button>
      <button class="btn btn-sm" type="button" id="${ID}-add-pilot" title="30-day paid pilot, ${esc(money(ctx.num(p.pilotFee)))}">Paid pilot (30 days)</button></div>`;
    return `<p class="note" style="margin:0">Number ${esc(number)}. This saves a record of the invoice; send the invoice itself from email or your billing tool.</p>
      <div class="row2">${ctx.F.select(`${ID}-company`, 'Customer', coOpts, coId)}${ctx.F.select(`${ID}-deal`, 'Deal (optional)', dealOpts(coId), inv && inv.dealId ? inv.dealId : '')}</div>
      <div class="row2">${ctx.F.date(`${ID}-issue`, 'Issue date', issue)}${ctx.F.date(`${ID}-due`, `Due date <span class="muted" style="font-weight:400">(${TERMS_DAYS} days after issue unless you change it)</span>`, due)}</div>
      <div class="field" role="group" aria-labelledby="${ID}-lines-label"><span id="${ID}-lines-label" style="font-size:13px;font-weight:600">Line items</span>
        <div style="${LINE_GRID};font-size:12px;color:var(--muted)"><span>Description</span><span>Qty</span><span>Unit price</span></div>
        ${rows}
      </div>
      ${quick}
      <dl class="stat-list"><div class="stat-row total"><dt>Total</dt><dd id="${ID}-form-total">${money(ctx.invoiceTotal({ lines }))}</dd></div></dl>
      ${ctx.F.area(`${ID}-notes`, 'Notes (optional)', (inv && inv.notes) || '', 2)}`;
  }

  function updateTotal() {
    const el = document.getElementById(`${ID}-form-total`);
    if (el) el.textContent = money(readLines().running);
  }

  function fillLine(description, qty, unitPrice) {
    for (let n = 1; n <= form.rows; n++) {
      const d = document.getElementById(`inv-line-${n}-desc`), q = document.getElementById(`inv-line-${n}-qty`), p = document.getElementById(`inv-line-${n}-price`);
      if (!d || !q || !p) continue;
      if (String(d.value || '').trim() || String(q.value || '').trim() || String(p.value || '').trim()) continue;
      d.value = description; q.value = String(qty); p.value = String(round2(unitPrice));
      const err = document.getElementById('form-err'); if (err) err.hidden = true;
      updateTotal();
      return;
    }
    ctx.formErr(`All ${form.rows} lines are in use. Clear a line to add another.`);
  }

  function wireForm() {
    const g = id => document.getElementById(id);
    const co = g(`${ID}-company`), dealSel = g(`${ID}-deal`), issue = g(`${ID}-issue`), due = g(`${ID}-due`);
    if (co && dealSel) co.addEventListener('change', () => { dealSel.innerHTML = optsHtml(dealOpts(co.value), ''); });
    if (issue && due) {
      const onIssue = () => { if (!form.dueEdited && ctx.parseYmd(issue.value)) due.value = ctx.addDays(issue.value, TERMS_DAYS); };
      issue.addEventListener('input', onIssue); issue.addEventListener('change', onIssue);
      const onDue = () => { form.dueEdited = String(due.value || '') !== ''; };
      due.addEventListener('input', onDue); due.addEventListener('change', onDue);
    }
    for (let n = 1; n <= form.rows; n++) {
      ['desc', 'qty', 'price'].forEach(f => { const el = g(`inv-line-${n}-${f}`); if (el) el.addEventListener('input', updateTotal); });
    }
    const add = (id, fn) => { const b = g(id); if (b) b.addEventListener('click', e => { if (e && e.preventDefault) e.preventDefault(); fn(); }); };
    add(`${ID}-add-setup`, () => fillLine('Setup fee', 1, ctx.setupFee()));
    add(`${ID}-add-sub`, () => {
      const issueDate = ctx.val(`${ID}-issue`) || ctx.todayStr();
      const d = ctx.deal(ctx.val(`${ID}-deal`));
      fillLine(`Subscription, ${monYear(issueDate)}`, d ? ctx.locs(d) : 1, ctx.priceFor(issueDate));
    });
    add(`${ID}-add-pilot`, () => fillLine('Paid pilot (30 days)', 1, ctx.num(ctx.plan().pilotFee)));
  }

  function openForm(inv) {
    if (!ctx.canWrite()) { ctx.toast('You can view invoices but not change them.', 'bad'); return; }
    if (!inv && !ctx.all('companies').length) { ctx.toast('Add the customer as a company first, then record the invoice.', 'bad'); return; }
    const lines = inv && Array.isArray(inv.lines) ? inv.lines : [];
    const issue0 = inv && ctx.parseYmd(inv.issueDate) ? inv.issueDate : ctx.todayStr();
    form = {
      rows: Math.max(MAX_LINES, lines.length),
      dueEdited: !!(inv && inv.dueDate && inv.dueDate !== ctx.addDays(issue0, TERMS_DAYS))
    };
    const number = inv ? (inv.number || 'Invoice') : nextNumber();
    ctx.openFormModal({
      title: inv ? `Edit ${number}` : 'New invoice',
      body: formBody(inv, number),
      submitLabel: inv ? 'Save invoice' : 'Save as draft',
      afterOpen: wireForm,
      onSubmit: () => submitForm(inv ? inv.id : null)
    });
  }

  async function submitForm(id) {
    const cur = id ? ctx.get('invoices', id) : null;
    if (id && !cur) return ctx.formErr('This invoice was deleted. Close this form to see the current list.');
    const companyId = ctx.val(`${ID}-company`);
    if (!companyId || !ctx.company(companyId)) return ctx.formErr('Choose the customer for this invoice.', `${ID}-company`);
    let dealId = ctx.val(`${ID}-deal`) || null;
    if (dealId) { const d = ctx.deal(dealId); if (!d || d.companyId !== companyId) return ctx.formErr('Choose a deal for this customer, or No deal.', `${ID}-deal`); }
    const issueDate = ctx.val(`${ID}-issue`);
    if (!ctx.parseYmd(issueDate)) return ctx.formErr('Enter the issue date.', `${ID}-issue`);
    const dueDate = ctx.val(`${ID}-due`);
    if (!ctx.parseYmd(dueDate)) return ctx.formErr('Enter the due date.', `${ID}-due`);
    if (dueDate < issueDate) return ctx.formErr(`The due date can’t be before the issue date, ${ctx.fmtDate(issueDate)}.`, `${ID}-due`);
    const r = readLines();
    if (r.error) return ctx.formErr(r.error, r.focus);
    if (!r.lines.length) return ctx.formErr('Add at least one line with a description, quantity and unit price. The quick-add buttons fill one in.', 'inv-line-1-desc');
    if (cur && cur.status === 'paid' && cur.paidDate && cur.paidDate < issueDate) return ctx.formErr(`This invoice was paid on ${ctx.fmtDate(cur.paidDate)}, so the issue date can’t be later than that.`, `${ID}-issue`);
    const notes = ctx.val(`${ID}-notes`);
    if (cur) {
      const ok = await ctx.patch('invoices', cur.id, { companyId, dealId, issueDate, dueDate, lines: r.lines, notes, updatedAt: ctx.iso() });
      if (ok) ctx.toast(`Saved ${cur.number || 'invoice'}`);
      return ok;
    }
    const number = nextNumber();
    const newId = await ctx.create('invoices', {
      number, companyId, dealId, issueDate, dueDate, lines: r.lines, status: 'draft', paidDate: null, notes,
      createdAt: ctx.iso(), createdBy: ctx.me()
    });
    if (newId) {
      if (state.filter !== 'all' && state.filter !== 'draft') state.filter = 'all';
      ctx.toast(`${number} saved as a draft for ${money(ctx.invoiceTotal({ lines: r.lines }))}`);
    }
    return !!newId;
  }

  /* ---------- row actions ---------- */
  function openPay(inv) {
    const t = ctx.todayStr();
    const def = inv.issueDate && inv.issueDate > t ? inv.issueDate : t;
    const amt = money(total(inv));
    const open = ctx.finance().openingDate;   // cash flows only count payments from this date on
    const pre = inv.issueDate && open && inv.issueDate < open ? ` A payment dated before ${ctx.fmtDate(open)}, when your cash balance starts, stays out of cash.` : '';
    ctx.openFormModal({
      title: `Record payment · ${inv.number || 'Invoice'}`,
      body: `<dl class="stat-list">
          <div class="stat-row"><dt>Customer</dt><dd style="font-family:inherit">${esc(coName(inv) || 'No customer')}</dd></div>
          <div class="stat-row"><dt>Issued</dt><dd>${esc(ctx.fmtDate(inv.issueDate) || '—')}</dd></div>
          <div class="stat-row"><dt>Due</dt><dd>${esc(ctx.fmtDate(inv.dueDate) || '—')}</dd></div>
          <div class="stat-row total"><dt>Amount</dt><dd>${amt}</dd></div></dl>
        ${ctx.F.date(`${ID}-pay-date`, 'Payment date', def)}
        <p class="note" style="margin:0">This marks the full ${amt} as paid. Cash on hand counts it from the payment date.${esc(pre)}</p>`,
      submitLabel: 'Record payment',
      onSubmit: async () => {
        const cur = ctx.get('invoices', inv.id);
        if (!cur) return ctx.formErr('This invoice was deleted.');
        const d = ctx.val(`${ID}-pay-date`);
        if (!ctx.parseYmd(d)) return ctx.formErr('Enter the date the payment arrived.', `${ID}-pay-date`);
        if (cur.issueDate && d < cur.issueDate) return ctx.formErr(`The payment date can’t be before the issue date, ${ctx.fmtDate(cur.issueDate)}.`, `${ID}-pay-date`);
        const ok = await ctx.patch('invoices', cur.id, { status: 'paid', paidDate: d, updatedAt: ctx.iso() });
        if (ok) ctx.toast(`${cur.number || 'Invoice'} marked paid on ${ctx.fmtDate(d)}`);
        return ok;
      }
    });
  }

  async function onAction(a, data) {
    if (a === 'filter') { state.filter = FILTERS.some(f => f[0] === data.v) ? data.v : 'all'; ctx.render(); return; }
    if (a === 'open-co') { if (data.id && ctx.company(data.id)) ctx.openDrawer('company', data.id); return; }
    if (a === 'new') { openForm(null); return; }
    const inv = data.id ? ctx.get('invoices', data.id) : null;
    if (!inv) return;
    if (!ctx.canWrite()) { ctx.toast('You can view invoices but not change them.', 'bad'); return; }
    const label = inv.number || 'this invoice';
    switch (a) {
      case 'edit': openForm(inv); break;
      case 'send':
        if (await ctx.patch('invoices', inv.id, { status: 'sent', updatedAt: ctx.iso() })) ctx.toast(`${label} marked sent${inv.dueDate ? ' · due ' + ctx.fmtDate(inv.dueDate) : ''}`);
        break;
      case 'pay': openPay(inv); break;
      case 'unpay':
        if (await ctx.patch('invoices', inv.id, { status: 'sent', paidDate: null, updatedAt: ctx.iso() })) ctx.toast(`${label} is unpaid again`);
        break;
      case 'void':
        ctx.openConfirm(`Void ${label}?`, `${coName(inv) || 'No customer'} · ${money(total(inv))}. The invoice stays on record as void and no longer counts as owed.`, 'Void invoice', async () => {
          if (await ctx.patch('invoices', inv.id, { status: 'void', updatedAt: ctx.iso() })) ctx.toast(`${label} voided`);
        });
        break;
      case 'delete':
        ctx.openConfirm(`Delete ${label}?`, 'This removes the invoice record for good and can’t be undone. To keep a record, void it instead.', 'Delete', async () => {
          if (await ctx.remove('invoices', inv.id)) ctx.toast(`Deleted ${label}`);
        });
        break;
    }
  }

  /* ---------- export ---------- */
  function csv() {
    const today = ctx.todayStr();
    const rows = [['Number', 'Customer', 'Deal', 'Issue date', 'Due date', 'Status', 'Total', 'Paid date', 'Days past due', 'Lines', 'Notes']];
    invoices().slice().sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''))).forEach(i => {
      const st = ctx.invoiceStatus(i);
      const lines = (Array.isArray(i.lines) ? i.lines : []).map(l => `${l.description || ''} (${ctx.num(l.qty)} x ${ctx.fmtPrice(round2(l.unitPrice))})`).join('; ');
      rows.push([String(i.number || ''), coName(i), dealName(i), String(i.issueDate || ''), String(i.dueDate || ''), st, total(i),
        String(i.paidDate || ''), st === 'overdue' ? daysPastDue(i, today) : '', lines, String(i.notes || '')]);
    });
    return { name: 'invoices', rows };
  }

  return {
    id: ID,
    label: 'Invoices',
    group: 'Finance',
    order: 30,
    collections: ['invoices'],
    newItems: [{ label: 'Invoice', a: 'new' }],
    badge() {
      const n = invoices().filter(i => ctx.invoiceStatus(i) === 'overdue').length;
      return n ? { text: String(n), hot: true, title: `${n} overdue invoice${s(n)}` } : null;
    },
    render,
    onAction(a, data) {
      onAction(a, data || {}).catch(err => { console.error(err); ctx.toast('Something went wrong in Invoices.', 'bad'); });
    },
    csv
  };
});
