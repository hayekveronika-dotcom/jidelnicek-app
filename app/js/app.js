import * as D from './domain.js';
import * as P from './proposals.js';
import { loadState, saveState, requestPersistence } from './db.js';
import { drawPlanCanvas, canvasToPdf } from './pdf.js';
import { initSync, syncNow, markDirty, markReplace, getSyncInfo } from './sync.js';

// ---------- Pomocné ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => String(Math.round(n * 1000) / 1000).replace('.', ',');
const parseNum = v => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).replace(',', '.').trim()); return isFinite(n) && n > 0 ? n : null; };
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
const surovin = n => plural(n, 'surovina', 'suroviny', 'surovin');
const pokrmu = n => plural(n, 'pokrm', 'pokrmy', 'pokrmů');
const usedIn = n => n === 0 ? 'zatím nepoužito' : n === 1 ? 'použito v 1 pokrmu' : `použito ${n >= 2 && n <= 4 ? 've' : 'v'} ${n} pokrmech`;
const tagsText = tags => (tags || []).map(t => D.TAG_LABEL[t]).filter(Boolean).join(' · ');
const fmtDate = isoStr => { const d = new Date(isoStr); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
function fmtQty(qty, missing, unit) {
  if (qty > 0) return `${num(qty)} ${esc(unit)}${missing ? ' + další' : ''}`;
  return '—';
}

const I = {
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M4.5 4.5h15v12h-9l-4 3.5v-3.5h-2z"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.5l2.2 11h10.6l2-8H7"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="4.5" rx="1.2"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2v-6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>',
};

// ---------- Stav ----------
let state = null;
const ui = {
  planTab: 'current',
  libTag: 'all', libQuery: '', libFlags: {}, showDeleted: false,
  frozenTag: 'all', frozenQuery: '',
  archiveTab: 'plans', ingQuery: '', showRemoved: false,
  draft: null, draftFor: null, draftDirty: false, draftErrors: [],
};
let saveTimer = null;
function saveLocal() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveState(state), 120); }
function persist() { saveLocal(); markDirty(); }
// Nový stav ze serveru (synchronizace) – neoznačuje se jako lokální změna.
function replaceState(next) {
  state = D.migrateState(next);
  const changed = D.ensureWeeks(state);
  D.currentList(state);
  saveLocal();
  if (changed) markDirty();
  render();
  refreshPicker();
}

// ---------- Stav synchronizace ----------
function syncText(i = getSyncInfo()) {
  const t = i.lastSync ? new Date(i.lastSync).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const who = i.user ? ` (${i.user})` : '';
  switch (i.status) {
    case 'ok': return `Data se synchronizují mezi zařízeními${who}. Naposledy ${t}.`;
    case 'pending': case 'syncing': return `Ukládám změny na server…${t ? ` Naposledy ${t}.` : ''}`;
    case 'offline': return `Jste offline. Změny se uloží v zařízení a odešlou se po připojení.${t ? ` Naposledy synchronizováno ${t}.` : ''}`;
    case 'login': return 'Přihlášení vypršelo. Změny se ukládají v zařízení, na server se odešlou po přihlášení.';
    case 'error': return `Synchronizace se nepovedla: ${i.error}`;
    case 'local': return 'Synchronizace není dostupná, data jsou jen v tomto prohlížeči. Zálohu si občas exportujte.';
    default: return 'Připojuji se k serveru…';
  }
}
function renderSyncStatus(i) {
  const info = $('#sync-info'); if (info) info.textContent = syncText(i);
  let b = $('#sync-banner');
  const show = i.status === 'login' || i.status === 'error';
  if (!show) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'sync-banner'; b.className = 'sync-banner'; document.body.appendChild(b); }
  b.innerHTML = i.status === 'login'
    ? `<span>Přihlášení vypršelo, změny se neukládají na server.</span><button data-a="syncLogin">Přihlásit</button>`
    : `<span>${esc(syncText(i))}</span><button data-a="syncNow">Zkusit znovu</button>`;
}
function commit(fn, { rerender = true } = {}) {
  try {
    const r = fn(state);
    persist();
    if (rerender) render();
    return r;
  } catch (e) {
    toast(e.message || String(e));
    return undefined;
  }
}

// ---------- Toast / overlay ----------
let toastTimer;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}
const overlays = [];
function openOverlay(renderFn, { center = false, full = false, onClose } = {}) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim' + (center ? ' center' : '');
  const o = { scrim, renderFn, center, full, onClose };
  scrim.addEventListener('click', e => { if (e.target === scrim) closeOverlay(o); });
  overlays.push(o);
  document.body.appendChild(scrim);
  renderOverlay(o);
  return o;
}
function renderOverlay(o) {
  const html = o.renderFn();
  o.scrim.innerHTML = o.center ? `<div class="dialog" role="dialog">${html}</div>` : `<div class="sheet${o.full ? ' full' : ''}" role="dialog"><div class="grab"></div>${html}</div>`;
}
function rerenderTop() { const o = overlays[overlays.length - 1]; if (o) renderOverlay(o); }
function closeOverlay(o = overlays[overlays.length - 1]) {
  if (!o) return;
  const i = overlays.indexOf(o);
  if (i >= 0) overlays.splice(i, 1);
  o.scrim.remove();
  if (o.onClose) o.onClose();
}
function closeAllOverlays() { while (overlays.length) closeOverlay(); }

// Spodní okno (sheet) jde zavřít přetažením dolů, když je obsah odscrollovaný nahoru.
let sheetDrag = null;
document.addEventListener('touchstart', e => {
  const sheet = e.target.closest('.sheet');
  if (!sheet || e.touches.length > 1) { sheetDrag = null; return; }
  const t = e.touches[0];
  sheetDrag = { sheet, x: t.clientX, y: t.clientY, dy: 0, active: false, t0: Date.now() };
}, { passive: true });
document.addEventListener('touchmove', e => {
  const d = sheetDrag;
  if (!d) return;
  const t = e.touches[0];
  const dx = t.clientX - d.x, dy = t.clientY - d.y;
  if (!d.active) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    // jen tah dolů, když okno není odscrollované (jinak normální posouvání obsahu)
    if (dy <= 0 || Math.abs(dx) > dy || d.sheet.scrollTop > 0) { sheetDrag = null; return; }
    d.active = true;
    d.sheet.style.transition = 'none';
    document.activeElement?.blur?.();
  }
  e.preventDefault();
  d.dy = Math.max(0, dy);
  d.sheet.style.transform = `translateY(${d.dy}px)`;
}, { passive: false });
function endSheetDrag() {
  const d = sheetDrag; sheetDrag = null;
  if (!d || !d.active) return;
  const fast = d.dy > 40 && d.dy / Math.max(1, Date.now() - d.t0) > 0.6;
  const o = overlays.find(x => x.scrim.contains(d.sheet));
  d.sheet.style.transition = 'transform .2s ease';
  if (o && (d.dy > Math.min(140, d.sheet.offsetHeight * 0.25) || fast)) {
    d.sheet.style.transform = 'translateY(100%)';
    setTimeout(() => closeOverlay(o), 190);
  } else {
    d.sheet.style.transform = '';
  }
}
document.addEventListener('touchend', endSheetDrag);
document.addEventListener('touchcancel', endSheetDrag);

function confirmDialog({ title, text = '', ok = 'Potvrdit', cancel = 'Zrušit', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const o = openOverlay(() => `
      <h2>${esc(title)}</h2>${text ? `<p class="lead">${text}</p>` : ''}
      <div class="btns">
        <button class="btn btn-block ${danger ? 'btn-primary" style="background:var(--red)' : 'btn-primary'}" data-a="dlgOk">${esc(ok)}</button>
        <button class="btn btn-block btn-ghost" data-a="dlgCancel">${esc(cancel)}</button>
      </div>`, { center: true, onClose: () => { if (!done) resolve(false); } });
    o.resolve = v => { done = true; closeOverlay(o); resolve(v); };
  });
}

// ---------- Router ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  return { name: parts[0] || 'plan', id: parts[1], id2: parts[2] };
}
const go = hash => { location.hash = hash; };

function navHtml(active) {
  const tab = (key, href, icon, label) => `<a href="#/${href}" class="${active === key ? 'on' : ''}">${icon}<span>${label}</span></a>`;
  return `<nav class="tabs"><div class="in">
    ${tab('plan', 'plan', I.cal, 'Jídelníček')}
    ${tab('library', 'library', I.book, 'Knihovna')}
    ${tab('frozen', 'frozen', I.snow, 'Mražené')}
    ${tab('shop', 'shop', I.cart, 'Nákup')}
  </div></nav>`;
}

function render() {
  if (!state) return;
  const r = route();
  let html = '', active = 'plan';
  switch (r.name) {
    case 'library': html = viewLibrary(); active = 'library'; break;
    case 'dish': html = viewDish(r.id); active = 'library'; break;
    case 'ingredients': html = viewIngredients(); active = 'library'; break;
    case 'frozen': html = viewFrozen(); active = 'frozen'; break;
    case 'shop': html = viewShop(); active = 'shop'; break;
    case 'archive':
      html = r.id === 'plan' ? viewArchivePlan(r.id2) : r.id === 'list' ? viewArchiveList(r.id2) : viewArchive();
      break;
    default: html = viewPlan();
  }
  const app = $('#app');
  const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.keep;
  const selStart = focused ? document.activeElement.selectionStart : null;
  app.innerHTML = html;
  $('#nav').innerHTML = navHtml(active);
  if (focused) {
    const el = app.querySelector(`[data-keep="${focused}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(selStart, selStart); } catch { /* nic */ } }
  }
}

// =====================================================================
// 1 · Jídelníček
// =====================================================================
function planByTab() {
  return state.plans.find(p => p.status === (ui.planTab === 'next' ? 'next' : 'current'));
}
function entryInfo(e) {
  let name = '', badges = '', deleted = false;
  if (e.type === 'dish') {
    const d = D.getDish(state, e.refId);
    name = d ? d.name : '(neznámý pokrm)';
    if (!d || d.deleted) { deleted = true; badges += '<span class="badge deleted">Smazáno z knihovny</span>'; }
  } else if (e.type === 'ingredient') {
    const ing = D.getIngredient(state, e.refId);
    name = ing ? ing.name : '(neznámá surovina)';
    if (e.qty) name += ` · ${num(e.qty)} ${e.unit || ing?.unit || ''}`;
    badges += '<span class="badge ing">Surovina</span>';
  } else {
    const f = D.getFrozen(state, e.refId);
    name = (e.count > 1 ? `${e.count}× ` : '') + (f ? f.name : '(neznámý mražený pokrm)');
    badges += '<span class="badge frozen">Mražené</span>';
    if (!f || f.deleted) badges += ' <span class="badge deleted">Smazáno z mrazáku</span>';
  }
  return { name, badges, deleted };
}
function slotHtml(plan, di, meal, { readonly = false } = {}) {
  const key = D.slotKey(di, meal);
  const items = D.slotItems(plan, key);
  const lbl = `<div class="lbl">${D.TAG_LABEL[meal]}</div>`;
  if (!items.length) {
    if (readonly) return '';
    return `<button class="slot empty" data-a="pickSlot" data-plan="${plan.id}" data-key="${key}"><div class="main">${lbl}<div class="name">+ Přidat pokrm</div></div></button>`;
  }
  const rows = items.map((e, i) => {
    const { name, badges, deleted } = entryInfo(e);
    const inner = `<div class="main" style="flex:1;min-width:0"><div class="name ${deleted ? 'deleted' : ''}">${esc(name)}</div>${badges ? `<div>${badges}</div>` : ''}</div>`;
    return readonly ? `<div class="slot-item">${inner}</div>`
      : `<button class="slot-item" data-a="slotItemMenu" data-plan="${plan.id}" data-key="${key}" data-i="${i}">${inner}${I.chev}</button>`;
  }).join('');
  const add = readonly ? '' : `<button class="slot-add" data-a="pickSlot" data-plan="${plan.id}" data-key="${key}">+ Přidat další</button>`;
  return `<div class="slot multi">${lbl}${rows}${add}</div>`;
}
function weekHtml(plan, opts = {}) {
  const today = D.iso(new Date());
  let html = '';
  for (let di = 0; di < 7; di++) {
    const date = D.addDays(plan.weekStart, di);
    const slots = D.slotsForDay(di).map(m => slotHtml(plan, di, m, opts)).join('');
    if (opts.readonly && !slots) continue;
    html += `<div class="day-title ${date === today && !opts.readonly ? 'today' : ''}">${D.DAY_NAMES[di]} ${D.fmtDay(date)}${date === today && !opts.readonly ? ' · dnes' : ''}</div>${slots}`;
  }
  return html || '<div class="list-empty">Jídelníček je prázdný.</div>';
}
function viewPlan() {
  const cur = state.plans.find(p => p.status === 'current');
  const next = state.plans.find(p => p.status === 'next');
  const plan = planByTab();
  const st = D.planListStatus(state, plan);
  let btn;
  if (st === 'add') btn = `<button class="btn btn-primary btn-block" data-a="syncList" data-plan="${plan.id}">Přidat suroviny na nákupní seznam</button>`;
  else if (st === 'update') btn = `<button class="btn btn-primary btn-block" data-a="syncList" data-plan="${plan.id}">Aktualizovat nákupní seznam</button>`;
  else if (st === 'synced') btn = `<button class="btn btn-muted btn-block" disabled>✓ Nákupní seznam je aktuální</button>`;
  else btn = `<button class="btn btn-muted btn-block" disabled>Přidat suroviny na nákupní seznam</button>`;
  return `
  <div class="top"><h1>Jídelníček</h1><div class="actions">
    <button class="icon-btn" data-a="sharePlan" aria-label="Sdílet">${I.share}</button>
    <a class="icon-btn" href="#/archive" aria-label="Archiv">${I.archive}</a>
    <button class="icon-btn" data-a="settings" aria-label="Nastavení">${I.more}</button>
  </div></div>
  <div class="seg">
    <button class="${ui.planTab === 'current' ? 'on' : ''}" data-a="planTab" data-v="current">Aktuální<small>${D.fmtWeek(cur.weekStart)}</small></button>
    <button class="${ui.planTab === 'next' ? 'on' : ''}" data-a="planTab" data-v="next">Další<small>${D.fmtWeek(next.weekStart)}</small></button>
  </div>
  ${proposalsBannerHtml()}
  ${btn}
  ${weekHtml(plan)}`;
}

// Návrhy od Clauda (MCP) – čekají na potvrzení
function proposalsBannerHtml() {
  const n = P.pendingProposals(state).length;
  return n ? `<button class="proposal-banner" data-a="openProposals"><span>Návrhy od Clauda</span><b>${n}</b><span class="link">Zobrazit</span></button>` : '';
}
function openProposals() {
  openOverlay(() => {
    const list = P.pendingProposals(state);
    if (!list.length) return `<h2>Návrhy od Clauda</h2><p class="kv">Žádné návrhy nečekají.</p><button class="btn btn-primary btn-block" data-a="closeAll">Zavřít</button>`;
    return `<h2>Návrhy od Clauda</h2>
      <p class="kv">Po přijetí se změny provedou stejně, jako byste je zadali ručně. Upravit je jde potom běžně v aplikaci.</p>
      ${list.map(p => {
        const d = P.describeProposal(state, p);
        return `<div class="card proposal">
          <div class="proposal-title">${esc(d.title)}</div>
          ${p.note ? `<p class="proposal-note">${esc(p.note)}</p>` : ''}
          <ul>${d.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          <div class="proposal-actions">
            <button class="btn btn-ghost" data-a="rejectProposal" data-id="${p.id}">Zamítnout</button>
            <button class="btn btn-primary" data-a="acceptProposal" data-id="${p.id}">Přijmout</button>
          </div>
        </div>`;
      }).join('')}`;
  });
}

function slotTitle(planId, key) {
  const p = D.getPlan(state, planId);
  const [di, meal] = key.split('-');
  return `${D.DAY_NAMES[+di]} ${D.fmtDay(D.addDays(p.weekStart, +di))} · ${D.TAG_LABEL[meal]}`;
}
function openSlotItemMenu(planId, key, i) {
  const p = D.getPlan(state, planId);
  const e = D.slotItems(p, key)[i];
  if (!e) return;
  const isDish = e.type === 'dish', isIng = e.type === 'ingredient', isFrozen = e.type === 'frozen';
  openOverlay(() => `
    <h2>${esc(slotTitle(planId, key))}</h2>
    <p class="lead">${esc(entryInfo(e).name)}${isFrozen ? ' · mražené' : isIng ? ' · samostatná surovina' : ''}</p>
    <div class="action-list">
      ${isIng ? `<button data-a="slotQty" data-plan="${planId}" data-key="${key}" data-i="${i}">Upravit množství</button>` : ''}
      ${isFrozen ? `<button data-a="frozenCount" data-plan="${planId}" data-key="${key}" data-i="${i}">Upravit počet</button>` : ''}
      <button data-a="pickSlot" data-plan="${planId}" data-key="${key}" data-replace="${i}">Nahradit něčím jiným</button>
      ${isDish && D.getDish(state, e.refId) ? `<button data-a="openDishFromSlot" data-id="${e.refId}">Zobrazit recept</button>` : ''}
      <button class="danger" data-a="removeFromSlot" data-plan="${planId}" data-key="${key}" data-i="${i}">Odebrat ze dne${isFrozen ? ` (vrátí ${e.count || 1} do mrazáku)` : ''}</button>
    </div>`);
}

// 2 · Výběr pokrmu do slotu (bottom sheet)
let pick = null;
function openPicker(planId, key, replaceIndex = null) {
  const meal = key.split('-')[1];
  pick = { planId, key, tab: 'library', query: '', filter: meal, replaceIndex };
  openOverlay(pickerHtml, { full: true, onClose: () => { pick = null; } });
}
function pickerHtml() {
  return `<div class="picker ${pick.query.trim() ? 'searching' : ''}">
    <h2>${esc(slotTitle(pick.planId, pick.key))}</h2>
    <p class="lead pick-lead">${pick.replaceIndex != null ? 'Vyber, čím nahradit stávající položku' : 'Vyber pokrmy nebo samostatné suroviny. Opětovným klepnutím položku odebereš.'}</p>
    ${pick.replaceIndex == null ? `<div id="pick-chosen">${pickChosenHtml()}</div>` : ''}
    <div class="seg">
      <button class="${pick.tab === 'library' ? 'on' : ''}" data-a="pickTab" data-v="library">Knihovna</button>
      <button class="${pick.tab === 'frozen' ? 'on' : ''}" data-a="pickTab" data-v="frozen">Mražené</button>
      <button class="${pick.tab === 'ing' ? 'on' : ''}" data-a="pickTab" data-v="ing">Suroviny</button>
    </div>
    <label class="search">${I.search}<input data-in="pickQuery" placeholder="${pick.tab === 'ing' ? 'Hledat surovinu…' : 'Hledat pokrm…'}" value="${esc(pick.query)}" autocomplete="off"></label>
    ${pick.tab === 'ing' ? '' : `<div class="chips">
      ${pick.filter
        ? `<button class="chip on chip-x small" data-a="pickClearFilter">${D.TAG_LABEL[pick.filter]} ✕</button><span class="chips-note">předfiltrováno podle slotu</span>`
        : `<button class="chip small" data-a="pickRestoreFilter">Jen ${D.TAG_LABEL[pick.key.split('-')[1]]}</button><span class="chips-note">zobrazeno vše</span>`}
    </div>`}
    ${pick.tab === 'library' ? '<button class="btn btn-outline btn-block pick-new pick-new-top" data-a="pickNewDish">+ Vytvořit nový pokrm</button>' : ''}
    <div id="pick-list">${pickerListHtml()}</div>
    ${pick.replaceIndex == null ? '<div class="pick-done"><button class="btn btn-primary btn-block" data-a="closeAll">Hotovo</button></div>' : ''}
  </div>`;
}
function pickChosenHtml() {
  const items = D.slotItems(D.getPlan(state, pick.planId), pick.key);
  if (!items.length) return '';
  return `<div class="chosen">Ve slotu: ${items.map(e => `<b>${esc(entryInfo(e).name)}</b>`).join(', ')}</div>`;
}
function inSlot(type, id) {
  if (pick.replaceIndex != null) return false;
  return D.slotItems(D.getPlan(state, pick.planId), pick.key).some(e => e.type === type && e.refId === id);
}
function openSlotQtySheet(planId, key, index) {
  const e = D.slotItems(D.getPlan(state, planId), key)[index];
  const ing = e && D.getIngredient(state, e.refId);
  if (!ing) return;
  const o = openOverlay(() => `
    <h2>Množství – ${esc(ing.name)}</h2>
    <p class="lead">Nepovinné. Propíše se na nákupní seznam.</p>
    ${e.qty != null && e.unit && e.unit !== ing.unit ? `<div class="note amber">Bylo zadáno <b>${num(e.qty)} ${esc(e.unit)}</b>. Surovina se vede v jednotce „${esc(ing.unit)}“ – zadejte přepočtené množství.</div>` : ''}
    ${qtyFieldsHtml('sqv', e.unit && e.unit !== ing.unit ? '' : e.qty, ing.unit, 'např. 2')}
    <div style="display:grid;gap:6px">
      <button class="btn btn-primary btn-block" data-a="slotQtySave">Uložit</button>
      <button class="btn btn-ghost btn-block" data-a="slotQtyClear">Bez množství</button>
    </div>`);
  Object.assign(o, { planId, key, index });
  setTimeout(() => $('#sqv')?.focus(), 50);
}
function openFrozenCountSheet(planId, key, index) {
  const e = D.slotItems(D.getPlan(state, planId), key)[index];
  const f = e && D.getFrozen(state, e.refId);
  if (!f) return;
  const ctx = { planId, key, index, val: e.count || 1, max: () => (e.count || 1) + f.qty };
  const o = openOverlay(() => {
    const max = ctx.max(); // co je ve slotu + co zbývá v mrazáku
    return `
    <h2>Kolik – ${esc(f.name)}</h2>
    <p class="lead">Odečte se z mrazáku. K dispozici celkem ${num(max)} ${esc(f.unit)}.</p>
    <div class="count-row">
      <button class="count-btn" data-a="countStep" data-v="-1" aria-label="Méně">−</button>
      <input id="fcv" class="input count-val" inputmode="numeric" value="${ctx.val}">
      <button class="count-btn plus" data-a="countStep" data-v="1" aria-label="Více">+</button>
      <span class="count-unit">${esc(f.unit)}</span>
    </div>
    <button class="btn btn-primary btn-block" data-a="frozenCountSave">Uložit</button>`;
  });
  Object.assign(o, ctx);
}
function refreshPicker() {
  if (!pick) return;
  const l = $('#pick-list'); if (l) l.innerHTML = pickerListHtml();
  const c = $('#pick-chosen'); if (c) c.innerHTML = pickChosenHtml();
}
function pickerListHtml() {
  const q = D.normalize(pick.query);
  const plan = D.getPlan(state, pick.planId);
  if (pick.tab === 'library') {
    const items = state.dishes.filter(d => !d.deleted && (!pick.filter || d.tags.includes(pick.filter)) && (!q || D.normalize(d.name).includes(q))).sort(D.byName);
    // při hledání je „nový pokrm“ až pod výsledky, aby výsledky byly hned pod polem hledání
    const newBtn = q ? '<button class="btn btn-outline btn-block pick-new" data-a="pickNewDish">+ Vytvořit nový pokrm</button>' : '';
    if (!items.length) return `<div class="list-empty">Žádný pokrm neodpovídá.</div>${newBtn}`;
    return items.map(d => {
      const last = D.lastUsed(state, d.id, plan.id);
      const on = inSlot('dish', d.id);
      return `<button class="row ${on ? 'picked' : ''}" data-a="pickDish" data-id="${d.id}"><div class="main"><div class="title">${esc(d.name)}</div><div class="sub">${tagsText(d.tags)}</div><div class="meta">${surovin(d.items.length)}${last ? ` · naposledy ${D.fmtWeek(last)}` : ''}</div></div>${on ? `<span class="cb on">${I.check}</span>` : I.chev}</button>`;
    }).join('') + newBtn;
  }
  if (pick.tab === 'ing') {
    const items = D.searchIngredients(state, pick.query).slice(0, 60);
    const exact = pick.query.trim() && D.findExactIngredient(state, pick.query);
    const sim = pick.query.trim() && !exact ? D.findSimilarIngredients(state, pick.query).filter(i => !items.includes(i)).slice(0, 2) : [];
    let html = [...sim.map(i => ({ i, hint: true })), ...items.map(i => ({ i }))].map(({ i, hint }) => {
      const on = inSlot('ingredient', i.id);
      return `<button class="row ${on ? 'picked' : ''}" data-a="pickIng" data-id="${i.id}"><div class="main"><div class="title">${hint ? `Nemyslíš <b>${esc(i.name)}</b>?` : esc(i.name)}</div><div class="meta">${esc(i.category)} · ${esc(i.unit)}</div></div>${on ? `<span class="cb on">${I.check}</span>` : I.chev}</button>`;
    }).join('');
    if (pick.query.trim() && !exact) html += `<button class="btn btn-outline btn-block pick-new" data-a="pickNewIng">+ Vytvořit novou surovinu „${esc(pick.query.trim())}“</button>`;
    return html || '<div class="list-empty">Databáze surovin je prázdná. Napište název a vytvořte novou.</div>';
  }
  const items = state.frozen.filter(f => !f.deleted && (!pick.filter || f.tags.includes(pick.filter)) && (!q || D.normalize(f.name).includes(q))).sort(D.byName);
  if (!items.length) return '<div class="list-empty">V mrazáku nic neodpovídá.</div>';
  return items.map(f => {
    const on = inSlot('frozen', f.id);
    const out = f.qty <= 0 && !on;
    return `<button class="row ${out ? 'dim' : ''} ${on ? 'picked' : ''}" ${out ? 'disabled' : `data-a="pickFrozen" data-id="${f.id}"`}><div class="main"><div class="title">${esc(f.name)}</div><div class="frozen-tags">${tagsText(f.tags)}${out ? ' · došlo' : ''}</div><div class="meta">${out ? 'vyprodáno, nelze přiřadit' : `skladem ${num(f.qty)} ${esc(f.unit)}`}</div></div>${on ? `<span class="cb on">${I.check}</span>` : out ? '' : I.chev}</button>`;
  }).join('');
}

// 8 · Upozornění „Nákup již proběhl“
// Smazané (mám doma) položky, které jídelníček zase potřebuje: obnovit, nebo přidat jen nové?
async function askRestoreRemoved(planId) {
  const removed = D.removedForPlan(state, planId);
  if (!removed.length) return false;
  const names = removed.map(i => D.getIngredient(state, i.ingredientId)?.name).filter(Boolean);
  return confirmDialog({
    title: 'Obnovit smazané položky?',
    text: `Smazané položky, které jídelníček potřebuje: ${names.join(', ')}. Ano – vrátí se na seznam. Ne – přidají se jen nové položky.`,
    ok: 'Ano, obnovit', cancel: 'Ne',
  });
}
function openPurchaseDoneDialog(planId, kind) {
  openOverlay(() => `
    <span class="badge warn">${kind === 'update' ? 'Jídelníček se změnil' : 'Nový jídelníček'}</span>
    <h2>Nákup již proběhl</h2>
    <p class="lead">Nakoupený seznam se už nemění. Zkontrolujte stav zásob, nebo vytvořte nový nákupní seznam jen se změnami.</p>
    <div class="btns">
      <button class="btn btn-primary btn-block" data-a="syncForce" data-plan="${planId}" data-v="newList">Vytvořit nový nákupní seznam</button>
      ${kind === 'update'
        ? `<button class="btn btn-ghost btn-block" data-a="syncForce" data-plan="${planId}" data-v="haveAll">Všechno mám</button>`
        : `<button class="btn btn-ghost btn-block" data-a="syncForce" data-plan="${planId}" data-v="append">Přidat do současného seznamu</button>`}
    </div>`, { center: true });
}

// Sdílení jídelníčku jako PDF (A4)
function planPdfData(plan) {
  const year = D.parseIso(D.addDays(plan.weekStart, 6)).getFullYear();
  const week = `${D.fmtWeek(plan.weekStart)} ${year}`;
  const rows = [];
  for (let di = 0; di < 7; di++) {
    const cells = {};
    const slots = D.slotsForDay(di);
    for (const m of slots) cells[m] = D.slotItems(plan, D.slotKey(di, m)).map(e => entryInfo(e).name);
    rows.push({ label: D.DAY_NAMES[di], date: D.fmtDay(D.addDays(plan.weekStart, di)), slots, cells });
  }
  return {
    week,
    file: `jidelnicek-${plan.weekStart}.pdf`,
    title: 'Jídelníček',
    subtitle: `${week} · ${plan.status === 'current' ? 'aktuální týden' : plan.status === 'next' ? 'další týden' : 'archiv'}`,
    footer: `Vytvořeno v aplikaci Jídelníček · ${D.fmtDay(D.iso(new Date()))} ${new Date().getFullYear()}`,
    meals: D.TAGS,
    rows,
  };
}
function openShareSheet(planId) {
  const plan = D.getPlan(state, planId);
  const data = planPdfData(plan);
  const canvas = drawPlanCanvas(data);
  const o = openOverlay(() => `
    <h2>Sdílet jídelníček</h2>
    <p class="lead">${esc(data.week)} jako PDF ve formátu A4.</p>
    <img class="pdf-preview" src="${canvas.toDataURL('image/jpeg', 0.7)}" alt="Náhled PDF jídelníčku">
    <div style="display:grid;gap:6px">
      <button class="btn btn-primary btn-block" data-a="sharePdf">Odeslat PDF e-mailem</button>
      <button class="btn btn-ghost btn-block" data-a="downloadPdf">Stáhnout PDF</button>
    </div>`);
  Object.assign(o, { canvas, data });
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Nastavení
function openSettings() {
  openOverlay(() => `
    <h2>Další volby</h2>
    <div class="action-list">
      <button data-a="goto" data-v="#/archive">Archiv jídelníčků a seznamů</button>
      <button data-a="goto" data-v="#/ingredients">Správa surovin</button>
      <button data-a="addAllToList">Přidat vše na nákupní seznam</button>
      <button data-a="archiveWeek">Uzavřít aktuální týden ručně</button>
      <button data-a="syncNow">Synchronizovat teď</button>
      <button data-a="exportData">Exportovat data (záloha JSON)</button>
      <button data-a="importData">Importovat data ze zálohy</button>
      <button class="danger" data-a="wipeData">Smazat všechna data</button>
    </div>
    <p class="kv" style="margin-top:14px" id="sync-info">${syncText()}</p>`);
}

// =====================================================================
// 3 · Knihovna
// =====================================================================
function libraryItems() {
  const q = D.normalize(ui.libQuery);
  const f = ui.libFlags;
  return state.dishes.filter(d => {
    if (!!d.deleted !== ui.showDeleted) return false;
    if (ui.libTag !== 'all' && !d.tags.includes(ui.libTag)) return false;
    if (f.sladke && d.taste !== 'sladke') return false;
    if (f.slane && d.taste !== 'slane') return false;
    if (f.fruit && !d.contains?.fruit) return false;
    if (f.veg && !d.contains?.veg) return false;
    if (f.tm && !d.thermomix) return false;
    if (f.fix && !D.dishNeedsFix(state, d)) return false;
    return !q || D.normalize(d.name).includes(q);
  }).sort(D.byName);
}
function libraryListHtml() {
  const items = libraryItems();
  if (!items.length) {
    if (!state.dishes.length) return '<div class="list-empty">Knihovna je zatím prázdná.<br>Začněte tlačítkem <b>+ Pokrm</b>.</div>';
    return `<div class="list-empty">${ui.showDeleted ? 'Žádné smazané pokrmy.' : 'Žádný pokrm neodpovídá filtru.'}</div>`;
  }
  return items.map(d => `
    <a class="row ${d.deleted ? 'dim' : ''}" href="#/dish/${d.id}" style="text-decoration:none;color:inherit">
      <div class="main"><div class="title">${esc(d.name)}</div><div class="sub">${tagsText(d.tags)}</div>
      <div class="meta">${surovin(d.items.length)}${d.thermomix ? ' · Thermomix' : ''}${d.deleted ? ' · smazáno' : ''}${D.dishNeedsFix(state, d) ? ' · <span class="warn-text">k opravě jednotek</span>' : ''}</div></div>${I.chev}</a>`).join('');
}
function viewLibrary() {
  const tagChip = (k, l) => `<button class="chip ${ui.libTag === k ? 'on' : ''}" data-a="libTag" data-v="${k}">${l}</button>`;
  const flag = (k, l) => `<button class="chip small ${ui.libFlags[k] ? 'on' : ''} ${k === 'fix' ? 'warn' : ''}" data-a="libFlag" data-v="${k}">${l}</button>`;
  const fixCount = state.dishes.filter(d => !d.deleted && D.dishNeedsFix(state, d)).length;
  if (!fixCount) ui.libFlags.fix = false;
  return `
  <div class="top"><h1>Knihovna</h1><div class="actions"><a class="btn btn-primary" href="#/dish/new">+ Pokrm</a></div></div>
  <label class="search">${I.search}<input data-in="libQuery" data-keep="libQuery" placeholder="Hledat pokrm…" value="${esc(ui.libQuery)}" autocomplete="off"></label>
  <div class="chips">${tagChip('all', 'Vše')}${D.TAGS.map(t => tagChip(t.key, t.label)).join('')}</div>
  <div class="chips">${flag('sladke', 'Sladké')}${flag('slane', 'Slané')}${flag('fruit', 'Ovoce')}${flag('veg', 'Zelenina')}${flag('tm', 'Thermomix')}${fixCount ? flag('fix', `K opravě (${fixCount})`) : ''}</div>
  <div class="barrow" style="margin-bottom:10px">
    <a class="menu-link" href="#/ingredients">Suroviny (${state.ingredients.length}) ›</a>
    <button class="menu-link" data-a="toggleDeleted">${ui.showDeleted ? 'Zpět na pokrmy' : 'Smazané pokrmy'}</button>
  </div>
  <div id="lib-list">${libraryListHtml()}</div>`;
}

// =====================================================================
// 4 · Detail / editace pokrmu
// =====================================================================
function startDraft(id) {
  if (ui.draftFor === (id || 'new') && ui.draft) return;
  const d = id && id !== 'new' ? D.getDish(state, id) : null;
  const slotTag = !d && ui.slotReturn ? [ui.slotReturn.key.split('-')[1]] : [];
  ui.draft = d ? JSON.parse(JSON.stringify(d)) : { name: '', tags: slotTag, taste: null, contains: { fruit: false, veg: false }, items: [], restrictions: [], thermomix: false, recipe: '' };
  ui.draftFor = id || 'new';
  ui.draftDirty = false;
  ui.draftErrors = [];
  ui.acQuery = '';
}
function viewDish(id) {
  if (id !== 'new' && !D.getDish(state, id)) return `<div class="list-empty">Pokrm nenalezen. <a class="link" href="#/library">Zpět</a></div>`;
  startDraft(id);
  const d = ui.draft;
  const tagChip = t => `<button class="chip small ${d.tags.includes(t.key) ? 'on' : ''}" data-a="draftTag" data-v="${t.key}">${t.label}</button>`;
  const opt = (field, val, label) => {
    const on = field === 'taste' ? d.taste === val : d.contains?.[val];
    return `<button class="chip small ${on ? 'on' : ''}" data-a="draftOpt" data-f="${field}" data-v="${val}">${label}</button>`;
  };
  const rows = d.items.map((it, i) => {
    const ing = D.getIngredient(state, it.ingredientId);
    const q = it.qty != null && it.qty !== '' ? `${num(it.qty)} ${esc(it.unit || ing?.unit || '')}` : '—';
    const bad = D.itemUnitMismatch(state, it);
    return `<div class="ing-row ${bad ? 'bad' : ''}"><div class="nm">${esc(ing ? ing.name : '?')}${bad ? `<small>surovina je v jednotce „${esc(ing.unit)}“ – přepočítejte</small>` : ''}</div>
      <button class="qty-pill" data-a="editQty" data-i="${i}">${q}</button>
      <button class="x-btn" data-a="removeIng" data-i="${i}" aria-label="Odebrat">${I.x}</button></div>`;
  }).join('');
  const isNew = id === 'new';
  return `
  <div class="barrow"><button class="back" data-a="leaveDish">${I.back}${ui.slotReturn ? 'Jídelníček' : 'Knihovna'}</button><button class="link" data-a="saveDish">Uložit</button></div>
  <div class="top" style="margin-top:4px"><h1>${isNew ? 'Nový pokrm' : 'Upravit pokrm'}</h1></div>
  ${isNew && ui.slotReturn ? `<div class="note green">Po uložení se pokrm přidá do: <b>${esc(slotTitle(ui.slotReturn.planId, ui.slotReturn.key))}</b></div>` : ''}
  ${d.deleted ? `<div class="note amber">Pokrm je smazaný z knihovny. V naplánovaných dnech zůstává podle poslední verze receptu.</div>` : ''}
  ${D.dishNeedsFix(state, d) ? `<div class="note amber">Některé suroviny mají v receptu jinou jednotku než v seznamu surovin. Na nákupním seznamu by byly zvlášť – klepněte na množství a přepočítejte.</div>` : ''}
  ${ui.draftErrors.length ? `<div class="err">${ui.draftErrors.map(esc).join('<br>')}</div>` : ''}
  <div class="field"><label for="dn">Název *</label><input id="dn" class="input" data-in="draftName" value="${esc(d.name)}" placeholder="např. Ovesná kaše s ovocem"></div>
  <div class="field"><span class="field-label">Štítky * (lze vybrat více)</span><div class="chips" style="margin:0">${D.TAGS.map(tagChip).join('')}</div></div>
  <div class="two-col field">
    <div><span class="field-label">Chuť (jedna volba)</span><div class="chips" style="margin:0">${opt('taste', 'sladke', 'Sladké')}${opt('taste', 'slane', 'Slané')}</div></div>
    <div><span class="field-label">Obsahuje</span><div class="chips" style="margin:0">${opt('contains', 'fruit', 'Ovoce')}${opt('contains', 'veg', 'Zelenina')}</div></div>
  </div>
  <div class="field"><span class="field-label">Suroviny * <span class="hint">množství je volitelné</span></span>
    ${rows}
    <div class="ac">
      <label class="search" style="margin:0">${I.search}<input data-in="acQuery" data-keep="acQuery" placeholder="Přidat surovinu z databáze…" value="${esc(ui.acQuery || '')}" autocomplete="off"></label>
      <div id="ac-list">${acListHtml()}</div>
    </div>
  </div>
  <details class="more" ${d.prepTime || d.servings || d.recipe || d.thermomix || (d.restrictions || []).length ? 'open' : ''}>
    <summary>Další údaje (nepovinné) ›</summary>
    <div class="two-col field" style="margin-top:10px">
      <div><label class="field-label" for="pt">Čas přípravy (min)</label><input id="pt" class="input" inputmode="numeric" data-in="draftField" data-f="prepTime" value="${esc(d.prepTime ?? '')}"></div>
      <div><label class="field-label" for="sv">Počet porcí</label><input id="sv" class="input" inputmode="numeric" data-in="draftField" data-f="servings" value="${esc(d.servings ?? '')}"></div>
    </div>
    <label class="check"><input type="checkbox" data-a="draftThermo" ${d.thermomix ? 'checked' : ''}> Thermomix</label>
    <div class="field" style="margin-top:10px"><label class="field-label" for="rs">Omezení (oddělte čárkou, např. bez mléka)</label><input id="rs" class="input" data-in="draftRestr" value="${esc((d.restrictions || []).join(', '))}"></div>
    <div class="field"><label class="field-label" for="rc">Postup nebo odkaz na recept</label><textarea id="rc" class="input" data-in="draftField" data-f="recipe">${esc(d.recipe || '')}</textarea></div>
    ${/^https?:\/\//.test((d.recipe || '').trim()) ? `<a class="link" href="${esc(d.recipe.trim())}" target="_blank" rel="noopener">Otevřít recept ↗</a>` : ''}
  </details>
  <button class="btn btn-primary btn-block" data-a="saveDish">Uložit pokrm</button>
  ${isNew ? '' : d.deleted
    ? `<button class="btn btn-ghost btn-block" style="margin-top:8px" data-a="restoreDish">Obnovit pokrm do knihovny</button>`
    : `<button class="btn btn-danger" style="margin-top:12px;padding:0" data-a="deleteDish">Smazat pokrm</button>`}`;
}

// Našeptávač surovin (pokrm i nákupní seznam)
function acListHtml(ctx = 'dish') {
  const q = (ctx === 'dish' ? ui.acQuery : ui.shopAc?.query) || '';
  if (!q.trim()) return '';
  const used = ctx === 'dish' ? new Set(ui.draft.items.map(i => i.ingredientId)) : new Set();
  const found = D.searchIngredients(state, q).filter(i => !used.has(i.id)).slice(0, 6);
  const exact = D.findExactIngredient(state, q);
  let html = found.map(i => `<button class="ac-item" data-a="acPick" data-ctx="${ctx}" data-id="${i.id}"><span>${esc(i.name)}</span><small>${esc(i.category)}</small></button>`).join('');
  if (!exact) {
    const sim = D.findSimilarIngredients(state, q).filter(i => !found.includes(i) && !used.has(i.id)).slice(0, 2);
    html += sim.map(i => `<button class="ac-item hint" data-a="acPick" data-ctx="${ctx}" data-id="${i.id}"><span>Nemyslíš <b>${esc(i.name)}</b>?</span><small>${esc(i.category)}</small></button>`).join('');
    html += `<button class="ac-item create" data-a="acCreate" data-ctx="${ctx}">+ Vytvořit novou surovinu „${esc(q.trim())}“</button>`;
  } else if (used.has(exact.id)) {
    html += `<div class="ac-item"><small>„${esc(exact.name)}“ už v pokrmu je.</small></div>`;
  }
  return `<div class="ac-list">${html}</div>`;
}

function openQtySheet(i) {
  const it = ui.draft.items[i];
  const ing = D.getIngredient(state, it.ingredientId);
  const bad = D.itemUnitMismatch(state, it);
  openOverlay(() => `
    <h2>Množství – ${esc(ing.name)}</h2>
    <p class="lead">Nepovinné. Bez množství se na seznamu zobrazí jako „+ další“.</p>
    ${bad ? `<div class="note amber">V receptu bylo <b>${num(it.qty)} ${esc(it.unit)}</b>. Surovina se vede v jednotce „${esc(ing.unit)}“ – zadejte přepočtené množství.</div>` : ''}
    ${qtyFieldsHtml('qv', bad ? '' : it.qty, ing.unit, 'např. 200')}
    <div class="btns" style="display:grid;gap:6px">
      <button class="btn btn-primary btn-block" data-a="qtySave" data-i="${i}">Uložit</button>
      <button class="btn btn-ghost btn-block" data-a="qtyClear" data-i="${i}">Bez množství</button>
    </div>`);
  setTimeout(() => $('#qv')?.focus(), 50);
}
// Množství + pevná jednotka suroviny (jednotka se mění jen u suroviny ve Správě surovin)
const qtyFieldsHtml = (id, qty, unit, ph) => `<div class="field"><label class="field-label" for="${id}">Množství (${esc(unit)})</label>
  <div class="qty-unit"><input id="${id}" class="input" inputmode="decimal" value="${qty != null && qty !== '' ? num(qty) : ''}" placeholder="${esc(ph)}"><span>${esc(unit)}</span></div></div>`;
const unitOptions = (sel, list = D.UNITS) => [...new Set([...list, sel].filter(Boolean))].map(u => `<option ${u === sel ? 'selected' : ''}>${esc(u)}</option>`).join('');
const catOptions = sel => D.CATEGORIES.map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');

// 5 · Nová surovina + kontrola duplicit
function openNewIngredientSheet(name, onDone) {
  const guessUnit = 'ks';
  openOverlay(() => `
    <h2>Nová surovina</h2>
    <p class="lead">Zkontrolujeme, jestli už podobná v databázi není.</p>
    <div class="field"><label class="field-label" for="ni">Název</label><input id="ni" class="input" value="${esc(name)}"></div>
    <div class="two-col field">
      <div><label class="field-label" for="nu">Výchozí jednotka</label><select id="nu" class="input">${unitOptions(guessUnit)}</select></div>
      <div><label class="field-label" for="nc">Kategorie</label><select id="nc" class="input">${catOptions('Ostatní')}</select></div>
    </div>
    <button class="btn btn-primary btn-block" data-a="niSave">Uložit surovinu</button>`);
  overlays[overlays.length - 1].onDone = onDone;
}
function tryCreateIngredient(sheet, data, force) {
  const res = commit(s => D.createIngredient(s, data, { force }), { rerender: false });
  if (!res) return;
  if (res.ok) { closeOverlay(sheet); sheet.onDone(res.ingredient); toast(`Surovina „${res.ingredient.name}“ vytvořena`); return; }
  openDuplicateDialog(sheet, data, res);
}
function openDuplicateDialog(sheet, data, res) {
  const m = res.matches;
  const first = m[0];
  const uses = i => D.ingredientUsage(state, i.id).dishCount;
  const o = openOverlay(() => `
    <h2>${res.reason === 'exact' ? 'Surovina už existuje' : 'Podobná surovina už existuje'}</h2>
    <p class="lead">Zadáváš „${esc(data.name)}“. V databázi už je „${esc(first.name)}“ (${usedIn(uses(first))}). Použij existující, ať se nákupní seznam správně sčítá.</p>
    ${m.map(i => `<button class="match" data-a="dupUse" data-id="${i.id}"><b>${esc(i.name)}</b><small>${esc(i.category)}</small></button>`).join('')}
    <div class="btns">
      <button class="btn btn-primary btn-block" data-a="dupUse" data-id="${first.id}">Použít „${esc(first.name)}“</button>
      ${res.reason === 'exact' ? '' : `<button class="btn btn-ghost btn-block" data-a="dupForce">Přesto vytvořit „${esc(data.name)}“</button>`}
    </div>`, { center: true });
  o.sheet = sheet; o.data = data;
}

// =====================================================================
// 6 · Mražené zásoby
// =====================================================================
function frozenListHtml() {
  const q = D.normalize(ui.frozenQuery);
  const items = state.frozen.filter(f => !f.deleted && (ui.frozenTag === 'all' || f.tags.includes(ui.frozenTag)) && (!q || D.normalize(f.name).includes(q)))
    .sort((a, b) => (b.qty > 0) - (a.qty > 0) || D.byName(a, b));
  if (!items.length) return state.frozen.some(f => !f.deleted) ? '<div class="list-empty">Nic neodpovídá filtru.</div>' : '<div class="list-empty">Mrazák je prázdný. Přidejte zásoby tlačítkem <b>+ Přidat</b>.</div>';
  return items.map(f => {
    const out = f.qty <= 0;
    return `<div class="row ${out ? 'dim' : ''}" style="cursor:default">
      <button class="main" style="text-align:left" data-a="editFrozen" data-id="${f.id}"><div class="title">${esc(f.name)}</div><div class="frozen-tags">${tagsText(f.tags) || 'bez štítku'}${out ? ' · došlo' : ''}</div></button>
      <div class="stepper"><button class="minus" data-a="frozenStep" data-id="${f.id}" data-v="-1" ${out ? 'disabled style="opacity:.4"' : ''} aria-label="Ubrat">−</button>
      <span class="val">${num(f.qty)} ${esc(f.unit)}</span>
      <button class="plus" data-a="frozenStep" data-id="${f.id}" data-v="1" aria-label="Přidat">+</button></div></div>`;
  }).join('');
}
function viewFrozen() {
  const tagChip = (k, l) => `<button class="chip ${ui.frozenTag === k ? 'on' : ''}" data-a="frozenTag" data-v="${k}">${l}</button>`;
  return `
  <div class="top"><h1>Mražené</h1><div class="actions"><button class="btn btn-primary" data-a="editFrozen">+ Přidat</button></div></div>
  <label class="search">${I.search}<input data-in="frozenQuery" data-keep="frozenQuery" placeholder="Hledat v mrazáku…" value="${esc(ui.frozenQuery)}" autocomplete="off"></label>
  <div class="chips">${tagChip('all', 'Vše')}${D.TAGS.map(t => tagChip(t.key, t.label)).join('')}</div>
  <div class="note blue">Přiřazení do jídelníčku odečte 1, odebrání z jídelníčku ho vrátí.</div>
  <div id="frozen-list">${frozenListHtml()}</div>`;
}
function openFrozenSheet(id) {
  const f = id ? D.getFrozen(state, id) : null;
  const dr = f ? JSON.parse(JSON.stringify(f)) : { name: '', tags: [], qty: 1, unit: 'ks' };
  const o = openOverlay(() => `
    <h2>${f ? 'Upravit mražený pokrm' : 'Nový mražený pokrm'}</h2>
    <p class="lead">Mražené pokrmy do nákupního seznamu nic nepřidávají.</p>
    <div class="field"><label class="field-label" for="fn">Název</label><input id="fn" class="input" value="${esc(dr.name)}" placeholder="např. Perník"></div>
    <div class="field"><span class="field-label">Štítky</span><div class="chips" style="margin:0">${D.TAGS.map(t => `<button class="chip small ${dr.tags.includes(t.key) ? 'on' : ''}" data-a="frozenDraftTag" data-v="${t.key}">${t.label}</button>`).join('')}</div></div>
    <div class="two-col field">
      <div><label class="field-label" for="fq">Množství</label><input id="fq" class="input" inputmode="numeric" value="${dr.qty}"></div>
      <div><label class="field-label" for="fu">Jednotka</label><select id="fu" class="input">${unitOptions(dr.unit, D.FROZEN_UNITS)}</select></div>
    </div>
    <button class="btn btn-primary btn-block" data-a="frozenSave">Uložit</button>
    ${f ? '<button class="btn btn-danger btn-block" style="margin-top:6px" data-a="frozenDelete">Smazat z mrazáku</button>' : ''}`);
  o.draft = dr;
}

// =====================================================================
// 7 · Nákupní seznam
// =====================================================================
function shopItemHtml(it, { readonly = false } = {}) {
  const ing = D.getIngredient(state, it.ingredientId);
  const q = D.itemQty(it);
  const src = it.origin === 'manual' ? 'Ručně přidáno' : (D.itemDishes(it).join(', ') || 'z jídelníčku');
  const done = it.state === 'bought';
  const cb = `<span class="cb ${done ? 'on' : ''}">${done ? I.check : ''}</span>`;
  const row = `<div class="shop-item ${done ? 'done' : ''}">
    ${readonly ? cb : `<button data-a="toggleItem" data-id="${it.id}" aria-label="Nakoupeno">${cb}</button>`}
    <button class="main" ${readonly ? '' : `data-a="itemMenu" data-id="${it.id}"`}><div class="nm">${esc(ing ? ing.name : '?')}</div><div class="src">${it.carried ? 'Převedeno · ' : ''}${esc(src)}${D.itemAdjusted(it) ? ' · upraveno' : ''}</div></button>
    <div class="q">${fmtQty(q.qty, q.missing, it.unit)}</div></div>`;
  // přejetím doleva se položka smaže (= vyřadí, mám doma)
  return readonly ? row : `<div class="swipe" data-swipe="${it.id}"><div class="swipe-bg">Smazat · mám doma</div>${row}</div>`;
}

// Přejetí položky nákupního seznamu doleva: řádek zčervená, po přejetí přes polovinu se smaže.
let swipe = null;
document.addEventListener('pointerdown', e => {
  const wrap = e.target.closest('[data-swipe]');
  if (!wrap || e.button > 0) return;
  swipe = { wrap, row: wrap.querySelector('.shop-item'), x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
});
document.addEventListener('pointermove', e => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // svislé posouvání stránky
    if (dx > -10 || Math.abs(dx) < Math.abs(dy)) return;
    swipe.active = true;
    swipe.wrap.classList.add('swiping');
    try { swipe.wrap.setPointerCapture(e.pointerId); } catch { /* nic */ }
  }
  swipe.dx = Math.min(0, dx);
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
  swipe.wrap.classList.toggle('armed', -swipe.dx > swipe.wrap.offsetWidth * 0.45);
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe; swipe = null;
  if (!s.active) return;
  // kliknutí po tažení se nemá provést
  const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', block, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', block, { capture: true }), 50);
  const w = s.wrap.offsetWidth;
  s.row.style.transition = 'transform .18s ease';
  if (-s.dx > w * 0.45 && e.type === 'pointerup') {
    s.row.style.transform = `translateX(${-w}px)`;
    setTimeout(() => { commit(st => D.setItemState(st, s.wrap.dataset.swipe, 'removed')); toast('Smazáno – mám doma'); }, 170);
  } else {
    s.row.style.transform = '';
    s.wrap.classList.remove('swiping', 'armed');
  }
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
function groupedItemsHtml(items, opts) {
  const groups = {};
  for (const it of items) {
    const ing = D.getIngredient(state, it.ingredientId);
    const cat = ing ? ing.category : 'Ostatní';
    (groups[cat] = groups[cat] || []).push(it);
  }
  const cats = Object.keys(groups).sort((a, b) => (D.CATEGORIES.indexOf(a) + 1 || 99) - (D.CATEGORIES.indexOf(b) + 1 || 99));
  const nameOf = it => D.getIngredient(state, it.ingredientId)?.name || '';
  return cats.map(c => `<div class="section-title">${esc(c)}</div><div class="shop-group">${groups[c].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'cs')).map(it => shopItemHtml(it, opts)).join('')}</div>`).join('');
}
function viewShop() {
  const list = D.currentList(state);
  const active = list.items.filter(i => i.state !== 'removed');
  const removed = list.items.filter(i => i.state === 'removed');
  const done = D.isPurchaseDone(list);
  return `
  <div class="top"><h1>Nákup</h1><div class="actions">
    <a class="icon-btn" href="#/archive" data-a="archiveLists" aria-label="Archiv">${I.archive}</a>
    <button class="btn btn-outline" data-a="shopAdd">+ Surovina</button></div></div>
  <div class="shop-meta">Aktuální seznam · založen ${fmtDate(list.createdAt)}${done ? ' · <span class="badge green" style="margin:0">nakoupeno</span>' : ''}</div>
  ${active.length ? groupedItemsHtml(active) : '<div class="list-empty">Seznam je prázdný.<br>Přidejte suroviny z jídelníčku nebo ručně.</div>'}
  ${removed.length ? `<div class="removed-bar"><span>${plural(removed.length, 'vyřazená položka', 'vyřazené položky', 'vyřazených položek')} (mám doma)</span><button class="link" data-a="toggleRemoved">${ui.showRemoved ? 'Skrýt' : 'Zobrazit'}</button></div>` : ''}
  ${ui.showRemoved && removed.length ? `<div class="shop-group" style="margin-top:8px">${removed.map(it => {
    const ing = D.getIngredient(state, it.ingredientId); const q = D.itemQty(it);
    return `<div class="shop-item"><div class="main"><div class="nm" style="color:var(--muted)">${esc(ing?.name)}</div><div class="src">${fmtQty(q.qty, q.missing, it.unit)}</div></div><button class="link" data-a="restoreItem" data-id="${it.id}">Vrátit</button></div>`;
  }).join('')}</div>` : ''}
  <div class="sticky-actions"><div class="in">
    <button class="btn btn-outline" data-a="allBought" ${active.some(i => i.state === 'todo') ? '' : 'disabled'}>Nakoupeno</button>
    <button class="btn btn-primary" data-a="archiveList" ${list.items.length ? '' : 'disabled'}>Archivovat</button>
  </div></div>`;
}
function openItemMenu(id) {
  const list = D.currentList(state);
  const it = list.items.find(i => i.id === id);
  const ing = D.getIngredient(state, it.ingredientId);
  const q = D.itemQty(it);
  openOverlay(() => `
    <h2>${esc(ing?.name)}</h2>
    <p class="lead">${fmtQty(q.qty, q.missing, it.unit)} · ${it.origin === 'manual' ? 'ručně přidáno' : esc(D.itemDishes(it).join(', '))}</p>
    <div class="action-list">
      <button data-a="toggleItem" data-id="${id}" data-close="1">${it.state === 'bought' ? 'Vrátit mezi nenakoupené' : 'Označit jako nakoupené'}</button>
      <button data-a="itemQty" data-id="${id}">Upravit množství</button>
      <button class="danger" data-a="removeItem" data-id="${id}">Vyřadit – mám doma</button>
    </div>`);
}
function openShopAdd(prefIngId = null) {
  ui.shopAc = { query: '', ingId: prefIngId };
  openOverlay(shopAddHtml, { onClose: () => { ui.shopAc = null; } });
}
function shopAddHtml() {
  const s = ui.shopAc;
  const ing = s.ingId ? D.getIngredient(state, s.ingId) : null;
  if (!ing) {
    return `<h2>Přidat surovinu</h2><p class="lead">Ruční položka mimo jídelníček. Aktualizace ji nikdy nesmaže.</p>
      <label class="search" style="margin:0">${I.search}<input data-in="shopAcQuery" placeholder="Hledat v databázi surovin…" value="${esc(s.query)}" autocomplete="off"></label>
      <div id="shop-ac">${acListHtml('shop')}</div>`;
  }
  return `<h2>Přidat: ${esc(ing.name)}</h2><p class="lead">${esc(ing.category)}</p>
    ${qtyFieldsHtml('sq', null, ing.unit, 'nepovinné')}
    <button class="btn btn-primary btn-block" data-a="shopAddSave">Přidat na seznam</button>
    <button class="btn btn-ghost btn-block" data-a="shopAddBack">Vybrat jinou surovinu</button>`;
}

// =====================================================================
// 9 · Archiv
// =====================================================================
function viewArchive() {
  const tab = ui.archiveTab;
  let body = '';
  if (tab === 'plans') {
    const plans = state.plans.filter(p => p.status === 'archive').sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    body = plans.length ? plans.map(p => {
      const st = D.planStats(state, p);
      return `<a class="row" href="#/archive/plan/${p.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="title">${D.fmtWeek(p.weekStart)}</div><div class="sub">Jídelníček</div><div class="meta">${pokrmu(st.dishes)}${st.frozen ? ` · ${plural(st.frozen, 'mražený', 'mražené', 'mražených')}` : ''}${st.ingredients ? ` · ${surovin(st.ingredients)}` : ''}</div></div>${I.chev}</a>`;
    }).join('') : '<div class="list-empty">Zatím žádné archivované jídelníčky.<br>Týden se archivuje automaticky v pondělí.</div>';
  } else {
    const lists = state.lists.filter(l => l.status === 'archive').sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
    body = lists.length ? lists.map(l => {
      const bought = l.items.filter(i => i.state === 'bought').length;
      return `<a class="row" href="#/archive/list/${l.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="title">Seznam z ${fmtDate(l.createdAt)}</div><div class="sub">Nákupní seznam</div><div class="meta">archivováno ${fmtDate(l.archivedAt)} · ${plural(l.items.length, 'položka', 'položky', 'položek')} · nakoupeno ${bought}</div></div>${I.chev}</a>`;
    }).join('') : '<div class="list-empty">Zatím žádné archivované nákupní seznamy.</div>';
  }
  return `
  <div class="barrow"><a class="back" href="#/plan">${I.back}Jídelníček</a></div>
  <div class="top" style="margin-top:4px"><h1>Archiv</h1></div>
  <div class="seg">
    <button class="${tab === 'plans' ? 'on' : ''}" data-a="archiveTab" data-v="plans">Jídelníčky</button>
    <button class="${tab === 'lists' ? 'on' : ''}" data-a="archiveTab" data-v="lists">Nákupní seznamy</button>
  </div>
  ${body}
  <div class="note green">Archiv slouží k přehledu a k hlídání obměny pokrmů.</div>`;
}
function viewArchivePlan(id) {
  const p = D.getPlan(state, id);
  if (!p) return '<div class="list-empty">Nenalezeno.</div>';
  return `<div class="barrow"><a class="back" href="#/archive">${I.back}Archiv</a></div>
    <div class="top" style="margin-top:4px"><h1>${D.fmtWeek(p.weekStart)}</h1></div>
    <div class="readonly">${weekHtml(p, { readonly: true })}</div>`;
}
function viewArchiveList(id) {
  const l = state.lists.find(x => x.id === id);
  if (!l) return '<div class="list-empty">Nenalezeno.</div>';
  const active = l.items.filter(i => i.state !== 'removed');
  const removed = l.items.filter(i => i.state === 'removed');
  return `<div class="barrow"><a class="back" href="#/archive">${I.back}Archiv</a></div>
    <div class="top" style="margin-top:4px"><h1>Seznam z ${fmtDate(l.createdAt)}</h1></div>
    <p class="kv">Archivováno ${fmtDate(l.archivedAt)}${removed.length ? ` · vyřazeno (mám doma): ${removed.length}` : ''}</p>
    ${active.length ? groupedItemsHtml(active, { readonly: true }) : '<div class="list-empty">Prázdný seznam.</div>'}`;
}

// =====================================================================
// 10 · Správa surovin
// =====================================================================
function ingredientsListHtml() {
  const q = D.normalize(ui.ingQuery);
  const items = state.ingredients.filter(i => !q || i.norm.includes(q)).sort(D.byName);
  if (!items.length) return state.ingredients.length ? '<div class="list-empty">Nic neodpovídá.</div>' : '<div class="list-empty">Databáze surovin je prázdná. Suroviny přibudou při zakládání pokrmů, nebo tlačítkem <b>+ Nová</b>.</div>';
  return items.map(i => `<button class="row" data-a="editIng" data-id="${i.id}"><div class="main"><div class="title">${esc(i.name)}</div><div class="sub">${esc(i.category)} · ${esc(i.unit)}</div><div class="meta">${usedIn(D.ingredientUsage(state, i.id).dishCount)}</div></div>${I.chev}</button>`).join('');
}
function viewIngredients() {
  const pairs = D.duplicatePairs(state);
  const uses = i => D.ingredientUsage(state, i.id).dishCount;
  const dup = pairs.map(([a, b]) => {
    const [main, other] = uses(a) >= uses(b) ? [a, b] : [b, a];
    return `<div class="dup-box"><span class="badge warn" style="background:#fff">Možná duplicita</span>
      <div class="pair">${esc(main.name)} (${pokrmu(uses(main))}) · ${esc(other.name)} (${pokrmu(uses(other))})</div>
      <div class="row2"><button class="btn btn-outline" data-a="mergeIng" data-main="${main.id}" data-dup="${other.id}">Sloučit do „${esc(main.name)}“</button></div>
      <div class="row2" style="margin-top:6px"><button class="btn btn-ghost" style="background:none" data-a="mergeIng" data-main="${other.id}" data-dup="${main.id}">Sloučit do „${esc(other.name)}“</button><button class="btn btn-ghost" style="background:none;color:var(--muted)" data-a="dismissDup" data-a1="${a.id}" data-a2="${b.id}">Nejsou duplicity</button></div></div>`;
  }).join('');
  return `
  <div class="barrow"><a class="back" href="#/library">${I.back}Knihovna</a></div>
  <div class="top" style="margin-top:4px"><h1>Suroviny</h1><div class="actions"><button class="btn btn-primary" data-a="newIng">+ Nová</button></div></div>
  <label class="search">${I.search}<input data-in="ingQuery" data-keep="ingQuery" placeholder="Hledat surovinu…" value="${esc(ui.ingQuery)}" autocomplete="off"></label>
  ${dup}
  <div id="ing-list">${ingredientsListHtml()}</div>`;
}
function openIngredientSheet(id) {
  const ing = D.getIngredient(state, id);
  const usage = D.ingredientUsage(state, id);
  const o = openOverlay(() => `
    <h2>${esc(ing.name)}</h2>
    <p class="lead">${usedIn(usage.dishCount)}${usage.dishCount ? ': ' + esc(usage.dishes.map(d => d.name).join(', ')) : ''}</p>
    <div class="field"><label class="field-label" for="en">Název</label><input id="en" class="input" value="${esc(ing.name)}"></div>
    <div class="two-col field">
      <div><label class="field-label" for="eu">Výchozí jednotka</label><select id="eu" class="input">${unitOptions(ing.unit)}</select></div>
      <div><label class="field-label" for="ec">Kategorie</label><select id="ec" class="input">${catOptions(ing.category)}</select></div>
    </div>
    <button class="btn btn-primary btn-block" data-a="ingSave" data-id="${id}">Uložit</button>
    <button class="btn btn-ghost btn-block" data-a="ingMergeInto" data-id="${id}">Sloučit do jiné suroviny…</button>
    ${usage.dishCount === 0 ? `<button class="btn btn-danger btn-block" data-a="ingDelete" data-id="${id}">Smazat surovinu</button>` : ''}`);
  o.ingId = id;
}
function openMergeTarget(dupId) {
  const dup = D.getIngredient(state, dupId);
  const st = { q: '' };
  const o = openOverlay(() => `
    <h2>Sloučit „${esc(dup.name)}“ do…</h2>
    <p class="lead">Vybraná surovina nahradí „${esc(dup.name)}“ ve všech pokrmech i nákupních seznamech.</p>
    <label class="search">${I.search}<input data-in="mergeQuery" placeholder="Hledat hlavní surovinu…" value="${esc(st.q)}" autocomplete="off"></label>
    <div id="merge-list">${mergeListHtml(dupId, st.q)}</div>`);
  o.mergeState = st; o.dupId = dupId;
}
function mergeListHtml(dupId, q) {
  return D.searchIngredients(state, q).filter(i => i.id !== dupId).slice(0, 12)
    .map(i => `<button class="ac-item" data-a="mergeIng" data-main="${i.id}" data-dup="${dupId}"><span>${esc(i.name)}</span><small>${esc(i.category)}</small></button>`).join('') || '<div class="list-empty">Žádná jiná surovina.</div>';
}

// =====================================================================
// Akce (delegované události)
// =====================================================================
const topOverlay = () => overlays[overlays.length - 1];
// Výběr do slotu: v režimu přidávání klepnutí přidá/odebere a sheet zůstává otevřený
function pickToggle(type, id) {
  const p = pick;
  const plan = D.getPlan(state, p.planId);
  if (p.replaceIndex == null) {
    const idx = D.slotItems(plan, p.key).findIndex(e => e.type === type && e.refId === id);
    if (idx >= 0) { commit(s => D.removeFromSlot(s, p.planId, p.key, idx)); refreshPicker(); return; }
  }
  const r = commit(s => D.assignSlot(s, p.planId, p.key, { type, refId: id }, { replaceIndex: p.replaceIndex }));
  if (r && !r.ok) { toast(r.error); return; }
  const items = D.slotItems(D.getPlan(state, p.planId), p.key);
  const index = p.replaceIndex != null ? p.replaceIndex : items.length - 1;
  if (p.replaceIndex != null) closeOverlay(); else refreshPicker();
  if (type === 'ingredient') openSlotQtySheet(p.planId, p.key, index);
  if (type === 'frozen') openFrozenCountSheet(p.planId, p.key, index);
}
const A = {
  // obecné
  closeAll: el => { closeAllOverlays(); const h = el.getAttribute('href'); if (h) go(h); },
  goto: el => { closeAllOverlays(); go(el.dataset.v); },
  dlgOk: () => topOverlay().resolve(true),
  dlgCancel: () => topOverlay().resolve(false),

  // jídelníček
  planTab: el => { ui.planTab = el.dataset.v; render(); },
  settings: () => openSettings(),
  sharePlan: () => openShareSheet(planByTab().id),
  sharePdf: async () => {
    const o = topOverlay();
    const blob = await canvasToPdf(o.canvas, `Jídelníček ${o.data.week}`);
    const file = new File([blob], o.data.file, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        // otevře systémové sdílení – vyberte Mail / Gmail
        await navigator.share({ files: [file], title: `Jídelníček ${o.data.week}`, text: `Jídelníček na týden ${o.data.week}` });
        closeOverlay(o);
      } catch (e) {
        if (e.name !== 'AbortError') { downloadBlob(blob, o.data.file); toast('Sdílení se nepovedlo, PDF se stáhlo – přiložte ho k e-mailu.'); }
      }
    } else {
      downloadBlob(blob, o.data.file);
      toast('Tento prohlížeč neumí sdílet soubory. PDF se stáhlo – přiložte ho k e-mailu.');
    }
  },
  downloadPdf: async () => {
    const o = topOverlay();
    downloadBlob(await canvasToPdf(o.canvas, `Jídelníček ${o.data.week}`), o.data.file);
  },
  pickSlot: el => {
    const r = el.dataset.replace;
    if (r != null) closeOverlay();
    openPicker(el.dataset.plan, el.dataset.key, r != null ? +r : null);
  },
  slotItemMenu: el => openSlotItemMenu(el.dataset.plan, el.dataset.key, +el.dataset.i),
  removeFromSlot: el => { commit(s => D.removeFromSlot(s, el.dataset.plan, el.dataset.key, +el.dataset.i)); closeOverlay(); },
  openDishFromSlot: el => { closeAllOverlays(); go('#/dish/' + el.dataset.id); },
  pickTab: el => { pick.tab = el.dataset.v; pick.query = ''; rerenderTop(); },
  pickClearFilter: () => { pick.filter = null; rerenderTop(); },
  pickRestoreFilter: () => { pick.filter = pick.key.split('-')[1]; rerenderTop(); },
  pickNewDish: () => {
    ui.slotReturn = { planId: pick.planId, key: pick.key, replaceIndex: pick.replaceIndex };
    ui.draft = null; ui.draftFor = null;
    closeAllOverlays();
    go('#/dish/new');
  },
  pickDish: el => pickToggle('dish', el.dataset.id),
  pickIng: el => pickToggle('ingredient', el.dataset.id),
  pickNewIng: () => {
    const name = pick.query.trim();
    openNewIngredientSheet(name, ing => { pick.query = ''; const inp = $('[data-in="pickQuery"]'); if (inp) inp.value = ''; pickToggle('ingredient', ing.id); });
  },
  frozenCount: el => { closeOverlay(); openFrozenCountSheet(el.dataset.plan, el.dataset.key, +el.dataset.i); },
  countStep: el => {
    const o = topOverlay();
    const cur = Math.round(Number($('#fcv').value) || o.val);
    o.val = Math.min(o.max(), Math.max(1, cur + Number(el.dataset.v)));
    $('#fcv').value = o.val;
  },
  frozenCountSave: () => {
    const o = topOverlay();
    const n = Math.round(Number($('#fcv').value));
    if (!(n >= 1)) { toast('Zadejte počet 1 nebo více.'); return; }
    const r = commit(s => D.setFrozenCount(s, o.planId, o.key, o.index, n));
    if (r && !r.ok) { toast(r.error); return; }
    closeOverlay(o); refreshPicker();
    const f = D.getFrozen(state, D.slotItems(D.getPlan(state, o.planId), o.key)[o.index].refId);
    toast(`${f.name}: v mrazáku zbývá ${num(f.qty)} ${f.unit}`);
  },
  slotQty: el => { closeOverlay(); openSlotQtySheet(el.dataset.plan, el.dataset.key, +el.dataset.i); },
  slotQtySave: () => {
    const o = topOverlay(); const raw = $('#sqv').value; const q = parseNum(raw);
    if (raw.trim() && q == null) { toast('Zadejte kladné číslo.'); return; }
    commit(s => D.setSlotEntryQty(s, o.planId, o.key, o.index, q));
    closeOverlay(o); refreshPicker();
  },
  slotQtyClear: () => { const o = topOverlay(); commit(s => D.setSlotEntryQty(s, o.planId, o.key, o.index, null)); closeOverlay(o); refreshPicker(); },
  pickFrozen: el => pickToggle('frozen', el.dataset.id),
  syncList: async el => {
    const pid = el.dataset.plan;
    const st = D.planListStatus(state, D.getPlan(state, pid));
    if (D.isPurchaseDone(D.currentList(state)) && (st === 'add' || st === 'update')) { openPurchaseDoneDialog(pid, st); return; }
    const restore = await askRestoreRemoved(pid);
    const r = commit(s => D.syncPlanToList(s, pid, { restore }));
    if (r && r.needsDialog) openPurchaseDoneDialog(pid, r.kind);
    else if (r) toast('Nákupní seznam aktualizován');
  },
  syncForce: async el => {
    const v = el.dataset.v, pid = el.dataset.plan;
    closeOverlay();
    const restore = v === 'haveAll' ? false : await askRestoreRemoved(pid);
    commit(s => D.syncPlanToList(s, pid, { force: v, restore }));
    toast(v === 'newList' ? 'Vytvořen nový nákupní seznam se změnami' : v === 'haveAll' ? 'Beru na vědomí, seznam se nemění' : 'Přidáno na nákupní seznam');
  },
  addAllToList: async () => {
    closeAllOverlays();
    const plan = planByTab();
    if (!D.allEntries(plan).some(e => e.type === 'dish' || e.type === 'ingredient')) { toast('Jídelníček je prázdný.'); return; }
    const ok = await confirmDialog({ title: 'Přidat vše na nákupní seznam?', text: `Na seznam se přidají všechny suroviny z jídelníčku ${D.fmtWeek(plan.weekStart)} – i ty, které už byly nakoupené nebo smazané.`, ok: 'Přidat vše' });
    if (ok) { commit(s => D.addPlanFully(s, plan.id)); toast('Přidáno na nákupní seznam'); }
  },
  archiveWeek: async () => {
    closeAllOverlays();
    const ok = await confirmDialog({ title: 'Uzavřít aktuální týden?', text: 'Aktuální jídelníček se přesune do archivu a „další“ se stane aktuálním. Normálně se to děje automaticky v pondělí.', ok: 'Uzavřít týden' });
    if (ok) { commit(s => D.archiveWeekManually(s)); ui.planTab = 'current'; render(); toast('Týden archivován'); }
  },
  exportData: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jidelnicek-zaloha-${D.iso(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importData: () => { closeAllOverlays(); $('#import-file').click(); },
  syncNow: async () => { await syncNow(); const i = getSyncInfo(); toast(i.status === 'ok' ? 'Synchronizováno' : syncText()); },
  syncLogin: () => location.reload(),
  openProposals: () => openProposals(),
  acceptProposal: el => {
    const r = commit(s => P.acceptProposal(s, el.dataset.id));
    if (r) toast(r.messages.join(' '));
    // nový pokrm rovnou otevřít v editaci ke kontrole
    if (r && r.dishId) { closeAllOverlays(); go(`#/dish/${r.dishId}`); return; }
    if (P.pendingProposals(state).length) rerenderTop(); else closeOverlay();
  },
  rejectProposal: el => {
    commit(s => P.rejectProposal(s, el.dataset.id));
    toast('Návrh zamítnut');
    if (P.pendingProposals(state).length) rerenderTop(); else closeOverlay();
  },
  wipeData: async () => {
    closeAllOverlays();
    const ok = await confirmDialog({ title: 'Smazat všechna data?', text: 'Smaže pokrmy, suroviny, jídelníčky i seznamy na všech propojených zařízeních. Nejde vrátit – nejdřív si udělejte export.', ok: 'Smazat vše', danger: true });
    if (ok) { state = D.emptyState(); D.ensureWeeks(state); markReplace(); saveLocal(); ui.draft = null; render(); toast('Data smazána'); }
  },

  // knihovna
  libTag: el => { ui.libTag = el.dataset.v; render(); },
  libFlag: el => {
    const k = el.dataset.v;
    ui.libFlags[k] = !ui.libFlags[k];
    if (k === 'sladke' && ui.libFlags.sladke) ui.libFlags.slane = false;
    if (k === 'slane' && ui.libFlags.slane) ui.libFlags.sladke = false;
    render();
  },
  toggleDeleted: () => { ui.showDeleted = !ui.showDeleted; render(); },

  // editor pokrmu
  draftTag: el => { const t = ui.draft.tags, v = el.dataset.v; ui.draft.tags = t.includes(v) ? t.filter(x => x !== v) : [...t, v]; ui.draftDirty = true; render(); },
  draftOpt: el => {
    const d = ui.draft, v = el.dataset.v;
    if (el.dataset.f === 'taste') d.taste = d.taste === v ? null : v;
    else { d.contains = d.contains || {}; d.contains[v] = !d.contains[v]; }
    ui.draftDirty = true; render();
  },
  draftThermo: el => { ui.draft.thermomix = el.checked; ui.draftDirty = true; },
  removeIng: el => { ui.draft.items.splice(+el.dataset.i, 1); ui.draftDirty = true; render(); },
  editQty: el => openQtySheet(+el.dataset.i),
  qtySave: el => {
    const it = ui.draft.items[+el.dataset.i];
    const raw = $('#qv').value;
    const q = parseNum(raw);
    if (raw.trim() && q == null) { toast('Zadejte kladné číslo.'); return; }
    const ing = D.getIngredient(state, it.ingredientId);
    it.qty = q; it.unit = q == null ? null : ing.unit;
    ui.draftDirty = true; closeOverlay(); render();
  },
  qtyClear: el => { const it = ui.draft.items[+el.dataset.i]; it.qty = null; it.unit = null; ui.draftDirty = true; closeOverlay(); render(); },
  acPick: el => {
    if (el.dataset.ctx === 'shop') { ui.shopAc.ingId = el.dataset.id; rerenderTop(); setTimeout(() => $('#sq')?.focus(), 30); return; }
    ui.draft.items.push({ ingredientId: el.dataset.id, qty: null, unit: null });
    ui.acQuery = ''; ui.draftDirty = true; render();
    $('[data-keep="acQuery"]')?.focus();
  },
  acCreate: el => {
    const ctx = el.dataset.ctx;
    const name = (ctx === 'shop' ? ui.shopAc.query : ui.acQuery).trim();
    openNewIngredientSheet(name, ing => {
      if (ctx === 'shop') { ui.shopAc.ingId = ing.id; rerenderTop(); return; }
      ui.draft.items.push({ ingredientId: ing.id, qty: null, unit: null });
      ui.acQuery = ''; ui.draftDirty = true; render();
    });
  },
  niSave: () => {
    const sheet = topOverlay();
    tryCreateIngredient(sheet, { name: $('#ni').value, unit: $('#nu').value, category: $('#nc').value }, false);
  },
  dupUse: el => {
    const dlg = topOverlay();
    closeOverlay(dlg); closeOverlay(dlg.sheet);
    dlg.sheet.onDone(D.getIngredient(state, el.dataset.id));
  },
  dupForce: () => { const dlg = topOverlay(); closeOverlay(dlg); tryCreateIngredient(dlg.sheet, dlg.data, true); },
  saveDish: () => {
    const errs = D.validateDish(ui.draft);
    if (errs.length) { ui.draftErrors = errs; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const d = commit(s => D.saveDish(s, ui.draft), { rerender: false });
    if (!d) return;
    ui.draft = null; ui.draftFor = null;
    const ret = ui.slotReturn;
    if (ret && D.getPlan(state, ret.planId)) {
      commit(s => D.assignSlot(s, ret.planId, ret.key, { type: 'dish', refId: d.id }, { replaceIndex: ret.replaceIndex }), { rerender: false });
      ui.planTab = D.getPlan(state, ret.planId).status === 'next' ? 'next' : 'current';
      toast(`Uloženo a přidáno: ${slotTitle(ret.planId, ret.key)}`);
      go('#/plan');
      return;
    }
    toast(`Uloženo: ${d.name}`);
    go('#/library');
  },
  leaveDish: async () => {
    if (ui.draftDirty) {
      const ok = await confirmDialog({ title: 'Zahodit změny?', text: 'Neuložené úpravy pokrmu se ztratí.', ok: 'Zahodit', danger: true });
      if (!ok) return;
    }
    ui.draft = null; ui.draftFor = null; go(ui.slotReturn ? '#/plan' : '#/library');
  },
  deleteDish: async () => {
    const ok = await confirmDialog({ title: 'Smazat pokrm?', text: 'Naplánované dny ho dál zobrazí (přeškrtnutý) a nákupní seznam použije poslední verzi receptu. Pokrm jde později obnovit.', ok: 'Smazat', danger: true });
    if (!ok) return;
    const id = ui.draft.id;
    commit(s => D.deleteDish(s, id), { rerender: false });
    ui.draft = null; ui.draftFor = null; go('#/library'); toast('Pokrm smazán');
  },
  restoreDish: () => { const id = ui.draft.id; commit(s => D.restoreDish(s, id), { rerender: false }); ui.draft = null; ui.draftFor = null; ui.showDeleted = false; go('#/library'); toast('Pokrm obnoven'); },

  // mražené
  frozenTag: el => { ui.frozenTag = el.dataset.v; render(); },
  frozenStep: el => commit(s => D.adjustFrozen(s, el.dataset.id, +el.dataset.v)),
  editFrozen: el => openFrozenSheet(el.dataset.id),
  frozenDraftTag: el => {
    const o = topOverlay(); const v = el.dataset.v; const t = o.draft.tags;
    o.draft.name = $('#fn').value; o.draft.qty = $('#fq').value; o.draft.unit = $('#fu').value;
    o.draft.tags = t.includes(v) ? t.filter(x => x !== v) : [...t, v];
    rerenderTop();
  },
  frozenSave: () => {
    const o = topOverlay();
    const q = Number(String($('#fq').value).replace(',', '.'));
    if (!isFinite(q) || q < 0) { toast('Zadejte množství 0 nebo více.'); return; }
    const r = commit(s => D.saveFrozen(s, { ...o.draft, name: $('#fn').value, qty: q, unit: $('#fu').value }));
    if (r) closeOverlay(o);
  },
  frozenDelete: async () => {
    const o = topOverlay();
    const ok = await confirmDialog({ title: 'Smazat z mrazáku?', text: 'Naplánované dny ho dál zobrazí s označením.', ok: 'Smazat', danger: true });
    if (ok) { commit(s => D.deleteFrozen(s, o.draft.id)); closeOverlay(o); }
  },

  // nákup
  toggleItem: el => {
    const list = D.currentList(state);
    const it = list.items.find(i => i.id === el.dataset.id);
    commit(s => D.setItemState(s, it.id, it.state === 'bought' ? 'todo' : 'bought'));
    if (el.dataset.close) closeOverlay();
  },
  itemMenu: el => openItemMenu(el.dataset.id),
  removeItem: el => { commit(s => D.setItemState(s, el.dataset.id, 'removed')); closeOverlay(); toast('Vyřazeno – mám doma'); },
  restoreItem: el => commit(s => D.setItemState(s, el.dataset.id, 'todo')),
  toggleRemoved: () => { ui.showRemoved = !ui.showRemoved; render(); },
  itemQty: el => {
    closeOverlay();
    const it = D.currentList(state).items.find(i => i.id === el.dataset.id);
    const ing = D.getIngredient(state, it.ingredientId);
    const q = D.itemQty(it);
    const fromPlan = it.origin !== 'manual';
    const o = openOverlay(() => `<h2>Upravit množství – ${esc(ing?.name)}</h2>
      ${fromPlan ? `<p class="lead">Podle jídelníčku ${fmtQty(D.itemQty({ ...it, adjust: 0, missingSet: 0 }).qty, D.itemQty({ ...it, adjust: 0, missingSet: 0 }).missing, it.unit)}. Úprava platí i po dalších změnách jídelníčku – nové množství se k ní přičte.</p>` : ''}
      ${qtyFieldsHtml('mq', q.qty || '', it.unit, fromPlan ? '' : 'nepovinné')}
      <button class="btn btn-primary btn-block" data-a="itemQtySave">Uložit</button>
      ${fromPlan && D.itemAdjusted(it) ? '<button class="btn btn-ghost btn-block" data-a="itemQtyReset">Vrátit podle jídelníčku</button>' : ''}`);
    o.itemId = it.id; o.fromPlan = fromPlan;
    setTimeout(() => $('#mq')?.focus(), 50);
  },
  itemQtySave: () => {
    const o = topOverlay();
    const raw = $('#mq').value; const q = parseNum(raw);
    if (raw.trim() && q == null) { toast('Zadejte kladné číslo.'); return; }
    if (o.fromPlan && q == null) { toast('Zadejte množství, nebo položku smažte (mám doma).'); return; }
    commit(s => D.setItemQty(s, o.itemId, q));
    closeOverlay(o);
  },
  itemQtyReset: () => { const o = topOverlay(); commit(s => D.setItemQty(s, o.itemId, null)); closeOverlay(o); toast('Množství podle jídelníčku'); },
  shopAdd: () => openShopAdd(),
  shopAddBack: () => { ui.shopAc.ingId = null; ui.shopAc.query = ''; rerenderTop(); },
  shopAddSave: () => {
    const raw = $('#sq').value; const q = parseNum(raw);
    if (raw.trim() && q == null) { toast('Zadejte kladné číslo.'); return; }
    const ingId = ui.shopAc.ingId;
    const r = commit(s => D.addManualItem(s, ingId, q));
    if (r) { closeOverlay(); toast('Přidáno na seznam'); }
  },
  allBought: () => { commit(s => D.markAllBought(s)); toast('Vše označeno jako nakoupené'); },
  archiveList: async () => {
    const list = D.currentList(state);
    const todo = list.items.filter(i => i.state === 'todo').length;
    const ok = await confirmDialog({ title: 'Archivovat nákupní seznam?', text: todo ? `Nenakoupené položky (${todo}) se převedou do nového aktuálního seznamu.` : 'Založí se nový prázdný nákupní seznam.', ok: 'Archivovat' });
    if (ok) { commit(s => D.archiveList(s)); ui.showRemoved = false; toast('Seznam archivován'); }
  },
  archiveLists: () => { ui.archiveTab = 'lists'; },

  // archiv
  archiveTab: el => { ui.archiveTab = el.dataset.v; render(); },

  // suroviny
  newIng: () => openNewIngredientSheet('', () => render()),
  editIng: el => openIngredientSheet(el.dataset.id),
  ingSave: el => {
    const r = commit(s => D.updateIngredient(s, el.dataset.id, { name: $('#en').value, unit: $('#eu').value, category: $('#ec').value }));
    if (!r) return;
    if (!r.ok) { toast(`Surovina „${r.matches[0].name}“ už existuje – použijte Sloučit.`); return; }
    closeOverlay();
  },
  ingDelete: async el => {
    const ok = await confirmDialog({ title: 'Smazat surovinu?', ok: 'Smazat', danger: true });
    if (ok) { const r = commit(s => { D.deleteIngredient(s, el.dataset.id); return true; }); if (r) closeAllOverlays(); render(); }
  },
  ingMergeInto: el => { const id = el.dataset.id; closeOverlay(); openMergeTarget(id); },
  mergeIng: async el => {
    const main = D.getIngredient(state, el.dataset.main), dup = D.getIngredient(state, el.dataset.dup);
    const ok = await confirmDialog({ title: `Sloučit do „${main.name}“?`, text: `„${esc(dup.name)}“ se nahradí surovinou „${esc(main.name)}“ ve všech pokrmech, zásobách i seznamech a pak se smaže.`, ok: 'Sloučit' });
    if (!ok) return;
    commit(s => D.mergeIngredients(s, main.id, dup.id));
    closeAllOverlays();
    toast(`Sloučeno do „${main.name}“`);
  },
  dismissDup: el => commit(s => D.dismissDuplicate(s, el.dataset.a1, el.dataset.a2)),
};

// Vstupní pole (bez překreslení celé obrazovky)
const IN = {
  libQuery: v => { ui.libQuery = v; $('#lib-list').innerHTML = libraryListHtml(); },
  frozenQuery: v => { ui.frozenQuery = v; $('#frozen-list').innerHTML = frozenListHtml(); },
  ingQuery: v => { ui.ingQuery = v; $('#ing-list').innerHTML = ingredientsListHtml(); },
  pickQuery: (v, el) => {
    pick.query = v;
    $('#pick-list').innerHTML = pickerListHtml();
    el.closest('.picker')?.classList.toggle('searching', !!v.trim());
  },
  draftName: v => { ui.draft.name = v; ui.draftDirty = true; },
  draftField: (v, el) => { ui.draft[el.dataset.f] = v; ui.draftDirty = true; },
  draftRestr: v => { ui.draft.restrictions = v.split(',').map(x => x.trim()).filter(Boolean); ui.draftDirty = true; },
  acQuery: v => { ui.acQuery = v; $('#ac-list').innerHTML = acListHtml('dish'); },
  shopAcQuery: v => { ui.shopAc.query = v; $('#shop-ac').innerHTML = acListHtml('shop'); },
  mergeQuery: v => { const o = topOverlay(); o.mergeState.q = v; $('#merge-list').innerHTML = mergeListHtml(o.dupId, v); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (!fn) return;
  if (el.tagName === 'A' && el.dataset.a !== 'archiveLists') e.preventDefault();
  if (el.type === 'checkbox') { fn(el, e); return; }
  fn(el, e);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-in]');
  if (el && IN[el.dataset.in]) IN[el.dataset.in](el.value, el);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && overlays.length) closeOverlay();
  if (e.key === 'Enter' && e.target.matches('[data-in="acQuery"],[data-in="shopAcQuery"]')) {
    const first = document.querySelector(e.target.dataset.in === 'acQuery' ? '#ac-list .ac-item[data-a]' : '#shop-ac .ac-item[data-a]');
    if (first) { e.preventDefault(); first.click(); }
  }
});
window.addEventListener('hashchange', () => {
  closeAllOverlays();
  const r = route();
  if (r.name !== 'dish') { ui.draft = null; ui.draftFor = null; ui.slotReturn = null; }
  window.scrollTo(0, 0);
  render();
});

// Import
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const obj = D.validateImport(JSON.parse(await file.text()));
    const ok = await confirmDialog({ title: 'Nahradit data zálohou?', text: `Soubor obsahuje ${pokrmu(obj.dishes.length)} a ${surovin(obj.ingredients.length)}. Současná data se přepíšou na všech propojených zařízeních.`, ok: 'Importovat' });
    if (!ok) return;
    state = D.migrateState(obj); D.ensureWeeks(state); D.currentList(state); markReplace(); saveLocal(); render(); toast('Data importována');
  } catch (err) { toast('Import se nepovedl: ' + err.message); }
});

// Nový den / týden při návratu do aplikace
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state && D.ensureWeeks(state)) { persist(); render(); }
});

// ---------- Start ----------
(async function init() {
  state = D.migrateState((await loadState()) || D.emptyState());
  const weeksChanged = D.ensureWeeks(state);
  D.currentList(state);
  saveLocal();
  requestPersistence();
  render();
  initSync({ getState: () => state, setState: replaceState, onStatus: renderSyncStatus }).then(() => { if (weeksChanged) markDirty(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline režim nedostupný */ });
  }
  // Pro ladění a budoucí externí zápis: window.jidelnicek.domain + stav
  window.jidelnicek = { domain: D, get state() { return state; }, commit, render };
})();
