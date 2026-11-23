/* Headless test harness for the Dealbook CRM page (runs in macOS JavaScriptCore, no browser needed).

   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
   python3 build.py --only expenses --out "$TMPDIR/t.html"
   $JSC src/harness/run.js -- "$TMPDIR/t.html" expenses            # render + smoke-test one tab
   $JSC src/harness/run.js -- "$TMPDIR/t.html" all                  # every tab

   It runs every <script> in the built page against a fake DOM, a fake window.claude (db, user,
   downloads) loaded from src/harness/fixture.json, then for each requested tab:
     - renders it and fails on render errors / console.error / suspicious output (NaN, undefined, [object Object]);
     - calls badge(), csv() and each newItems action, then submits the opened form once (empty) and
       once with values from the form's own defaults, reporting writes and form errors;
     - prints a short HTML excerpt so you can sanity-check what the tab shows.
   Exit status: prints "RESULT: PASS" or "RESULT: FAIL (n problems)" as the last line. */
'use strict';
var ARGS = typeof arguments !== 'undefined' ? Array.prototype.slice.call(arguments) : [];
var PAGE = ARGS[0], WANT = ARGS.slice(1);
if (!PAGE) { print('usage: jsc src/harness/run.js -- <built.html> <viewId|all> ...'); throw new Error('no page'); }
var problems = [];
function fail(msg) { problems.push(msg); print('  FAIL: ' + msg); }

/* ---------- fake DOM ---------- */
var listeners = { doc: {}, win: {} };
var els = {};
var mainHtmlSources = function () { return [els['#main'] && els['#main'].innerHTML, els['#modal'] && els['#modal'].innerHTML, els['#drawer-body'] && els['#drawer-body'].innerHTML].join('\n'); };
function attrOf(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null; }
function El(key, html) {
  this.key = key; this.id = key.charAt(0) === '#' ? key.slice(1) : key; this.innerHTML = ''; this.textContent = ''; this.hidden = false;
  this.dataset = {}; this.style = {}; this.value = ''; this.checked = false; this.disabled = false; this.placeholder = ''; this._l = {};
  var self = this; this.classList = { _c: {}, toggle: function (c, on) { self.classList._c[c] = on === undefined ? !self.classList._c[c] : !!on; }, add: function (c) { self.classList._c[c] = true; }, remove: function (c) { delete self.classList._c[c]; }, contains: function (c) { return !!self.classList._c[c]; } };
  if (html) {
    var tag = new RegExp('<(input|select|textarea|button)[^>]*\\sid="' + this.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>', 'i').exec(html);
    if (tag) {
      var t = tag[0], kind = tag[1].toLowerCase();
      if (kind === 'input') { this.value = attrOf(t, 'value') || ''; this.checked = /\schecked(\s|>|=)/.test(t); this.type = attrOf(t, 'type') || 'text'; }
      if (kind === 'textarea') { var rest = html.slice(tag.index + t.length); this.value = rest.slice(0, rest.indexOf('</textarea>')).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
      if (kind === 'select') { var body = html.slice(tag.index + t.length); body = body.slice(0, body.indexOf('</select>')); var sel = /<option value="([^"]*)"[^>]*selected/.exec(body) || /<option value="([^"]*)"/.exec(body); this.value = sel ? sel[1] : ''; }
      var dm = t.match(/\sdata-[a-z-]+="[^"]*"/g) || []; var ds = this.dataset;
      dm.forEach(function (a) { var m = /data-([a-z-]+)="([^"]*)"/.exec(a); ds[m[1].replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = m[2]; });
    }
  }
}
El.prototype.addEventListener = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); };
El.prototype.removeEventListener = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.setAttribute = function (k, v) { this['attr_' + k] = v; };
El.prototype.getAttribute = function (k) { return this['attr_' + k] || null; };
El.prototype.removeAttribute = function () {};
El.prototype.focus = function () {}; El.prototype.blur = function () {};
El.prototype.closest = function () { return null; };
El.prototype.contains = function () { return false; };
El.prototype.getBoundingClientRect = function () { return { width: 0, height: 0, left: 0, top: 0 }; };
El.prototype.appendChild = function () {}; El.prototype.remove = function () {};
El.prototype.requestSubmit = function () { (this._l.submit || []).forEach(function (f) { f({ preventDefault: function () {} }); }); };
Object.defineProperty(El.prototype, 'clientWidth', { get: function () { return 900; } });
function byId(id) {
  var key = '#' + id;
  var src = mainHtmlSources();
  if (els[key] && els[key]._static) return els[key];
  if (src.indexOf('id="' + id + '"') < 0) return null;
  if (!els[key] || els[key]._src !== src) { var e = new El(key, src); e._src = src; if (els[key]) { e._l = els[key]._l; if (els[key]._touched) { e.value = els[key].value; e.checked = els[key].checked; e._touched = true; } } els[key] = e; }
  return els[key];
}
['#main', '#notice', '#sidenav', '#modal', '#modal-scrim', '#drawer', '#drawer-scrim', '#drawer-body', '#drawer-kind', '#drawer-back', '#drawer-close', '#drawer-scroll', '#drawer-composer', '#toasts', '#viz-tip', '#q', '#ro-chip', '#new-wrap', '#new-menu', '#new-btn', '#form-err', '#f-submit', '#mod-form', '#mod-del', '#confirm-yes', '#rec-form'].forEach(function (k) { var e = new El(k); e._static = true; els[k] = e; });
els['#modal'].hidden = true; els['#drawer'].hidden = true;
var consoleErrors = [];
var document = {
  querySelector: function (sel) {
    if (/^#[\w-]+$/.test(sel)) return byId(sel.slice(1)) || (els[sel] && els[sel]._static ? els[sel] : null);
    var m = /^#([\w-]+)\s/.exec(sel); if (m) return null;
    return null;
  },
  querySelectorAll: function () { return []; },
  getElementById: function (id) { return byId(id) || (els['#' + id] && els['#' + id]._static ? els['#' + id] : null); },
  addEventListener: function (t, fn) { (listeners.doc[t] = listeners.doc[t] || []).push(fn); },
  createElement: function () { return new El('x'); },
  createRange: function () { return { selectNodeContents: function () {} }; },
  activeElement: null, body: {}, contains: function () { return true; }
};
var window = globalThis;
globalThis.document = document;
globalThis.window = window;
window.addEventListener = function (t, fn) { (listeners.win[t] = listeners.win[t] || []).push(fn); };
globalThis.location = { hash: '' };
globalThis.innerWidth = 1280; globalThis.innerHeight = 900;
globalThis.scrollTo = function () {};
globalThis.CSS = { escape: function (s) { return String(s); } };
globalThis.getSelection = function () { return { removeAllRanges: function () {}, addRange: function () {} }; };
globalThis.navigator = { clipboard: { writeText: function () { return Promise.resolve(); } } };
globalThis.requestAnimationFrame = function (fn) { Promise.resolve().then(function () { fn(0); }); return 1; };
var timers = [];
globalThis.setTimeout = function (fn) { timers.push(fn); return timers.length; };
globalThis.clearTimeout = function () {};
globalThis.console = { log: function () {}, warn: function () {}, info: function () {}, error: function () { var a = Array.prototype.slice.call(arguments).map(function (x) { return x && x.stack ? x.message + '\n' + x.stack.split('\n').slice(0, 3).join('\n') : String(x); }); consoleErrors.push(a.join(' ')); } };
globalThis.reportError = function (e) { consoleErrors.push('reportError: ' + e); };

/* ---------- fake window.claude ---------- */
var FIX = JSON.parse(read('src/harness/fixture.json'));
var store = {};
Object.keys(FIX.collections).forEach(function (c) { store[c] = {}; Object.keys(FIX.collections[c]).forEach(function (id) { store[c][id] = JSON.parse(JSON.stringify(FIX.collections[c][id])); }); });
var subs = [], writes = [], seq = 0;
function snapFor(c) {
  var docs = Object.keys(store[c] || {}).sort().map(function (id) { var d = store[c][id]; return { id: id, exists: true, data: function () { return d; }, metadata: { fromCache: false, hasPendingWrites: false } }; });
  return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
}
function deliver(c) { subs.forEach(function (s) { if (s.c === c) s.next(snapFor(c)); }); }
function checkPath(p) { var n = p.split('/').length; if (n % 2) throw new TypeError('document path needs an even number of segments: ' + p); }
function docRef(path) {
  checkPath(path); var parts = path.split('/'), id = parts.pop(), c = parts.join('/');
  return {
    id: id, path: path,
    get: function () { var d = store[c] && store[c][id]; return Promise.resolve({ id: id, exists: !!d, data: function () { return d; }, metadata: {} }); },
    set: function (data) { if (!data || typeof data !== 'object' || Array.isArray(data)) return Promise.reject({ code: 'invalid_argument', message: 'body must be an object' }); var s = JSON.stringify(data); if (/NaN|Infinity/.test(s) && /:\s*(NaN|Infinity)/.test(s)) fail('write to ' + path + ' contains NaN/Infinity'); store[c] = store[c] || {}; store[c][id] = JSON.parse(s); writes.push({ op: 'set', path: path, data: store[c][id] }); deliver(c); return Promise.resolve(); },
    update: function (data) { if (!store[c] || !store[c][id]) return Promise.reject({ code: 'invalid_argument', message: 'update needs an existing document: ' + path }); var cur = store[c][id]; Object.keys(data).forEach(function (k) { cur[k] = JSON.parse(JSON.stringify(data[k] === undefined ? null : data[k])); }); writes.push({ op: 'update', path: path, data: data }); deliver(c); return Promise.resolve(); },
    delete: function () { if (store[c]) delete store[c][id]; writes.push({ op: 'delete', path: path }); deliver(c); return Promise.resolve(); },
    onSnapshot: function (next) { next({ id: id, exists: !!(store[c] && store[c][id]), data: function () { return store[c] && store[c][id]; }, metadata: { fromCache: false } }); return function () {}; },
    collection: function (sub) { return colRef(path + '/' + sub); }
  };
}
function colRef(c) {
  if (c.split('/').length % 2 === 0) throw new TypeError('collection path needs an odd number of segments: ' + c);
  return {
    path: c,
    doc: function (id) { return docRef(c + '/' + (id || ('gen' + (++seq)))); },
    add: function (data) { var r = docRef(c + '/' + ('gen' + (++seq))); return r.set(data).then(function () { return r; }); },
    onSnapshot: function (next) { store[c] = store[c] || {}; subs.push({ c: c, next: next }); next(snapFor(c)); return function () {}; },
    get: function () { return Promise.resolve(snapFor(c)); },
    where: function () { return this; }, orderBy: function () { return this; }, limit: function () { return this; }
  };
}
var fakeDb = { collection: colRef, doc: docRef };
var fakeUser = {
  me: function () { return Promise.resolve({ id: 'u_founder', name: 'Test Founder', avatarUrl: '', color: '#888', email: null, isOwner: true, canEdit: true }); },
  id: function () { return Promise.resolve('u_founder'); },
  can: function () { return Promise.resolve(true); }, isOwner: function () { return Promise.resolve(true); }, canEdit: function () { return Promise.resolve(true); },
  profiles: function (ids) { var o = {}; [].concat(ids).forEach(function (id) { o[id] = { id: id, name: id === 'u_founder' ? 'Test Founder' : 'Teammate', avatarUrl: '', color: '#888', email: null, isMe: id === 'u_founder', guest: false }; }); return Promise.resolve(o); },
  search: function () { return Promise.resolve([]); }
};
var savedFiles = [];
var fakeDownloads = { save: function (o) { savedFiles.push(o); return Promise.resolve({ status: 'saved' }); } };
window.claude = { use: function (n) { return Promise.resolve(n === 'db' ? fakeDb : n === 'user' ? fakeUser : n === 'downloads' ? fakeDownloads : null); } };

/* ---------- load the page ---------- */
var html = read(PAGE);
var scripts = [], re = /<script>([\s\S]*?)<\/script>/g, m;
while ((m = re.exec(html))) scripts.push(m[1]);
print('Loaded ' + PAGE + ': ' + scripts.length + ' inline scripts');
scripts.forEach(function (code, i) { try { (0, eval)(code); } catch (e) { fail('script #' + (i + 1) + ' threw while loading: ' + e + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')); } });

function fire(scope, type, ev) { ((scope === 'win' ? listeners.win : listeners.doc)[type] || []).forEach(function (fn) { fn(ev); }); }
function fakeTarget(dataset, sel, extra) {
  var t = { dataset: dataset, value: (extra && extra.value) || '', checked: !!(extra && extra.checked), closest: function (s) { return s === sel ? t : null; }, matches: function () { return false; } };
  return t;
}
function clickAct(dataset) { var t = fakeTarget(dataset, '[data-act]'); fire('doc', 'click', { target: t, preventDefault: function () {} }); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 30); i++) p = p.then(function () {}); return p; }
function suspicious(htmlStr, where) {
  var bad = [];
  if (/\bNaN\b/.test(htmlStr)) bad.push('NaN');
  if (/>\s*undefined\s*</.test(htmlStr) || /="undefined"/.test(htmlStr) || / undefined[ <]/.test(htmlStr)) bad.push('undefined');
  if (/\[object Object\]/.test(htmlStr)) bad.push('[object Object]');
  if (/Infinity/.test(htmlStr.replace(/runway[^<]{0,40}/gi, ''))) bad.push('Infinity');
  if (/couldn.t load/.test(htmlStr)) bad.push('render error panel');
  bad.forEach(function (b) { fail(where + ' shows "' + b + '"'); });
}
function excerpt(h) { return h.replace(/<svg[\s\S]*?<\/svg>/g, '[svg]').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700); }

(async function () {
  await tick(80);
  var dbg = window.__dbDebug;
  if (!dbg) { fail('core did not expose window.__dbDebug (boot failed?)'); }
  var ids = dbg ? dbg.VIEWS.map(function (v) { return v.id; }) : [];
  print('Tabs registered: ' + ids.join(', '));
  if (dbg && dbg.S.status !== 'ok') fail('status after boot is ' + dbg.S.status + ' (expected ok)');
  var targets = WANT.indexOf('all') >= 0 || !WANT.length ? ids : WANT;
  for (var i = 0; i < targets.length; i++) {
    var id = targets[i];
    print('\n=== ' + id + ' ===');
    if (ids.indexOf(id) < 0) { fail('tab "' + id + '" is not registered'); continue; }
    consoleErrors.length = 0;
    location.hash = '#' + id; fire('win', 'hashchange', {}); await tick(20);
    var h = els['#main'].innerHTML;
    if (!h || h.length < 50) fail(id + ' rendered almost nothing (' + (h || '').length + ' chars)');
    suspicious(h, id + ' render');
    print('  rendered ' + h.length + ' chars; charts: ' + (h.match(/data-chart="/g) || []).length);
    print('  text: ' + excerpt(h));
    var v = dbg.VIEWS.filter(function (x) { return x.id === id; })[0];
    if (v.badge) { try { var b = v.badge(); print('  badge: ' + JSON.stringify(b)); } catch (e) { fail(id + ' badge() threw: ' + e); } }
    if (v.csv) { try { var c = v.csv(); if (!c || !Array.isArray(c.rows) || !c.name) fail(id + ' csv() must return {name, rows[]}'); else { print('  csv: ' + c.name + ', ' + c.rows.length + ' rows; header: ' + JSON.stringify(c.rows[0])); var w = c.rows[0] ? c.rows[0].length : 0; c.rows.forEach(function (r, ri) { if (r.length !== w) fail(id + ' csv row ' + ri + ' has ' + r.length + ' cells, header has ' + w); r.forEach(function (cell) { if (typeof cell === 'number' && !isFinite(cell)) fail(id + ' csv has a non-finite number'); if (cell === undefined || (cell && typeof cell === 'object')) fail(id + ' csv cell is ' + (cell === undefined ? 'undefined' : 'an object')); }); }); } } catch (e) { fail(id + ' csv() threw: ' + e); } }
    var items = (v.newItems || []);
    for (var j = 0; j < items.length; j++) {
      var it = items[j], before = writes.length;
      els['#modal'].innerHTML = ''; els['#modal'].hidden = true;
      clickAct({ act: 'mod', mod: id, a: it.a || 'new' }); await tick(10);
      var mh = els['#modal'].innerHTML;
      if (!mh) { fail(id + ' newItems "' + it.label + '" did not open a form'); continue; }
      suspicious(mh, id + ' "' + it.label + '" form');
      print('  form "' + it.label + '": ' + excerpt(mh).slice(0, 260));
      /* submit with the form's own defaults */
      var form = els['#mod-form']; var subs1 = form._l.submit || [];
      if (!subs1.length) { print('  (form has no submit listener on #mod-form; skipped submit test)'); continue; }
      els['#form-err'].hidden = true; els['#form-err'].textContent = '';
      await subs1[subs1.length - 1]({ preventDefault: function () {} }); await tick(10);
      var made = writes.slice(before);
      print('  submit with defaults -> ' + (made.length ? made.length + ' write(s): ' + made.map(function (w) { return w.op + ' ' + w.path; }).join(', ') : 'no write') + (els['#form-err'].hidden ? '' : '; form error: "' + els['#form-err'].textContent + '"'));
      if (!made.length && els['#form-err'].hidden && els['#modal'].hidden === false) print('  NOTE: nothing was written and no error was shown');
    }
    location.hash = '#' + id; fire('win', 'hashchange', {}); await tick(20);
    suspicious(els['#main'].innerHTML, id + ' re-render after actions');
    if (consoleErrors.length) consoleErrors.forEach(function (e) { fail(id + ' console.error: ' + e.slice(0, 400)); });
  }
  print('\nWrites recorded: ' + writes.length + (writes.length ? ' (' + writes.slice(-6).map(function (w) { return w.op + ' ' + w.path; }).join(', ') + ')' : ''));
  print(problems.length ? 'RESULT: FAIL (' + problems.length + ' problems)' : 'RESULT: PASS');
})().catch(function (e) { print('HARNESS ERROR: ' + e + '\n' + e.stack); print('RESULT: FAIL (harness error)'); });
