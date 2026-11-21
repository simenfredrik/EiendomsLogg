/* ============================================================
   EiendomsLogga — app logic
   Backend: Supabase (Postgres database + Auth + Storage).
   Fyll inn din egen prosjekt-URL og anon-nøkkel under før du
   tar i bruk siden — se README-notatene fra Claude i chatten
   for hvor du finner disse i Supabase-dashbordet.
   ============================================================ */

(function () {
  'use strict';

  /* ================================================================
     SUPABASE CONFIG — fyll inn dine egne verdier her
     Project Settings → API i Supabase-dashbordet.
     ================================================================ */
  var SUPABASE_URL = 'https://kvbnmdjrdgeqfaagmjgt.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_MNuDMBcXuYAa1PmpYKcMHg_s_timlb3';

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var DB = { properties: [], entries: [], maintenance: [], inspections: [] };
  var currentUser = null; // { id, email, name, subscribed }
  var phase = 'landing'; // 'landing' | 'login' | 'signup' | 'paywall' | 'app'

  function emptyData() {
    return { properties: [], entries: [], maintenance: [], inspections: [] };
  }

  /* ---------------- Row <-> app object mapping ----------------
     Supabase/Postgres columns are snake_case; the app's render
     code (unchanged from the local-storage version) expects the
     camelCase shape below, so every table has a small mapper. */

  function mapProperty(row) {
    return { id: row.id, name: row.name, address: row.address, rooms: row.rooms, tenantName: row.tenant_name, createdAt: row.created_at };
  }
  function propertyToRow(obj) {
    var row = {};
    if (obj.name !== undefined) row.name = obj.name;
    if (obj.address !== undefined) row.address = obj.address;
    if (obj.rooms !== undefined) row.rooms = obj.rooms;
    if (obj.tenantName !== undefined) row.tenant_name = obj.tenantName;
    return row;
  }

  function mapEntry(row) {
    return { id: row.id, propertyId: row.property_id, type: row.type, title: row.title, description: row.description, date: row.date, status: row.status, cost: row.cost, photos: row.photos || [], documents: row.documents || [], createdAt: row.created_at };
  }
  function entryToRow(obj) {
    var row = {};
    if (obj.propertyId !== undefined) row.property_id = obj.propertyId;
    if (obj.type !== undefined) row.type = obj.type;
    if (obj.title !== undefined) row.title = obj.title;
    if (obj.description !== undefined) row.description = obj.description;
    if (obj.date !== undefined) row.date = obj.date;
    if (obj.status !== undefined) row.status = obj.status;
    if (obj.cost !== undefined) row.cost = obj.cost;
    if (obj.photos !== undefined) row.photos = obj.photos;
    if (obj.documents !== undefined) row.documents = obj.documents;
    return row;
  }

  function mapMaintenance(row) {
    return { id: row.id, propertyId: row.property_id, title: row.title, dueDate: row.due_date, recurring: row.recurring, notes: row.notes, status: row.status };
  }
  function maintenanceToRow(obj) {
    var row = {};
    if (obj.propertyId !== undefined) row.property_id = obj.propertyId;
    if (obj.title !== undefined) row.title = obj.title;
    if (obj.dueDate !== undefined) row.due_date = obj.dueDate;
    if (obj.recurring !== undefined) row.recurring = obj.recurring;
    if (obj.notes !== undefined) row.notes = obj.notes;
    if (obj.status !== undefined) row.status = obj.status;
    return row;
  }

  function mapInspection(row) {
    return { id: row.id, propertyId: row.property_id, type: row.type, tenantName: row.tenant_name, date: row.date, rooms: row.rooms || [], tenantSignature: row.tenant_signature, landlordSignature: row.landlord_signature, createdAt: row.created_at };
  }
  function inspectionToRow(obj) {
    var row = {};
    if (obj.propertyId !== undefined) row.property_id = obj.propertyId;
    if (obj.type !== undefined) row.type = obj.type;
    if (obj.tenantName !== undefined) row.tenant_name = obj.tenantName;
    if (obj.date !== undefined) row.date = obj.date;
    if (obj.rooms !== undefined) row.rooms = obj.rooms;
    if (obj.tenantSignature !== undefined) row.tenant_signature = obj.tenantSignature;
    if (obj.landlordSignature !== undefined) row.landlord_signature = obj.landlordSignature;
    return row;
  }

  /* ---------------- Load everything for a logged-in user ---------------- */

  async function loadAllDataForUser(userId) {
    var results = await Promise.all([
      sb.from('properties').select('*').order('name'),
      sb.from('entries').select('*').order('date', { ascending: false }),
      sb.from('maintenance').select('*').order('due_date'),
      sb.from('inspections').select('*').order('date', { ascending: false })
    ]);
    var errs = results.filter(function (r) { return r.error; });
    if (errs.length) {
      console.error('Feil ved lasting av data', errs);
      showToast('Klarte ikke å laste alle data. Prøv å laste siden på nytt.', 'danger');
    }
    return {
      properties: (results[0].data || []).map(mapProperty),
      entries: (results[1].data || []).map(mapEntry),
      maintenance: (results[2].data || []).map(mapMaintenance),
      inspections: (results[3].data || []).map(mapInspection)
    };
  }

  /* ---------------- File uploads (Supabase Storage) ----------------
     Buckets "photos" and "documents" must exist — see setup notes.
     Files are stored under {userId}/{propertyId}/{randomName}. */

  async function uploadFiles(bucket, items, propertyId) {
    if (!items || !items.length) return [];
    var uploaded = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var path = currentUser.id + '/' + (propertyId || 'diverse') + '/' + uid('f') + '_' + safeName;
      var res = await sb.storage.from(bucket).upload(path, item.file, { upsert: false });
      if (res.error) {
        showToast('Klarte ikke å laste opp ' + item.name + ': ' + res.error.message, 'danger');
        throw res.error;
      }
      var pub = sb.storage.from(bucket).getPublicUrl(path);
      uploaded.push({ name: item.name, url: pub.data.publicUrl });
    }
    return uploaded;
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDateNO(iso) {
    if (!iso) return '—';
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    var num = Number(n) || 0;
    return num.toLocaleString('nb-NO') + ' kr';
  }

  /* ---------------- Dato-hjelpere (gjentakende vedlikehold, frister) ---------------- */

  var RECUR_MONTHS = { 'Kvartalsvis': 3, 'Halvårlig': 6, 'Årlig': 12 };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Legger måneder til en ISO-dato (åååå-mm-dd). 31. jan + 1 mnd blir 28./29. feb, ikke 3. mars.
  function addMonthsISO(iso, months) {
    var p = iso.split('-').map(Number);
    var total = p[1] - 1 + months;
    var y = p[0] + Math.floor(total / 12);
    var m = ((total % 12) + 12) % 12;
    var lastDay = new Date(y, m + 1, 0).getDate();
    return y + '-' + pad2(m + 1) + '-' + pad2(Math.min(p[2], lastDay));
  }

  // Neste forfallsdato for en gjentakende oppgave. Hopper over datoer som allerede er passert.
  function nextDueDate(dueISO, recurring) {
    var step = RECUR_MONTHS[recurring];
    if (!step || !dueISO) return null;
    var today = todayISO();
    var k = 1;
    var next = addMonthsISO(dueISO, step * k);
    while (next < today && k < 400) { k++; next = addMonthsISO(dueISO, step * k); }
    return next;
  }

  function daysBetween(fromISO, toISO) {
    var a = Date.UTC.apply(null, fromISO.split('-').map(function (v, i) { return i === 1 ? Number(v) - 1 : Number(v); }));
    var b = Date.UTC.apply(null, toISO.split('-').map(function (v, i) { return i === 1 ? Number(v) - 1 : Number(v); }));
    return Math.round((b - a) / 86400000);
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function daysLabel(n) {
    if (n === 0) return 'i dag';
    return plural(Math.abs(n), 'dag', 'dager');
  }

  /* ---------------- CRUD helpers (Supabase-backed) ----------------
     Each module keeps a synchronous in-memory copy (DB.*) so the
     existing render functions can read it instantly, and writes
     through to Supabase, updating the local copy once saved. */

  var Properties = {
    all: function () { return DB.properties.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'no'); }); },
    get: function (id) { return DB.properties.find(function (p) { return p.id === id; }); },
    add: async function (obj) {
      var row = propertyToRow(obj);
      row.user_id = currentUser.id;
      var res = await sb.from('properties').insert(row).select().single();
      if (res.error) { showToast('Klarte ikke å lagre bolig: ' + res.error.message, 'danger'); throw res.error; }
      var mapped = mapProperty(res.data);
      DB.properties.push(mapped);
      return mapped;
    },
    update: async function (id, patch) {
      var row = propertyToRow(patch);
      var res = await sb.from('properties').update(row).eq('id', id).select().single();
      if (res.error) { showToast('Klarte ikke å oppdatere bolig: ' + res.error.message, 'danger'); throw res.error; }
      var idx = DB.properties.findIndex(function (p) { return p.id === id; });
      if (idx > -1) DB.properties[idx] = mapProperty(res.data);
    },
    remove: async function (id) {
      var res = await sb.from('properties').delete().eq('id', id);
      if (res.error) { showToast('Klarte ikke å slette bolig: ' + res.error.message, 'danger'); throw res.error; }
      DB.properties = DB.properties.filter(function (p) { return p.id !== id; });
      DB.entries = DB.entries.filter(function (e) { return e.propertyId !== id; });
      DB.maintenance = DB.maintenance.filter(function (m) { return m.propertyId !== id; });
      DB.inspections = DB.inspections.filter(function (i) { return i.propertyId !== id; });
    }
  };

  var Entries = {
    all: function () { return DB.entries.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }); },
    forProperty: function (propertyId) { return Entries.all().filter(function (e) { return e.propertyId === propertyId; }); },
    get: function (id) { return DB.entries.find(function (e) { return e.id === id; }); },
    add: async function (obj) {
      var row = entryToRow(obj);
      row.user_id = currentUser.id;
      var res = await sb.from('entries').insert(row).select().single();
      if (res.error) { showToast('Klarte ikke å lagre hendelse: ' + res.error.message, 'danger'); throw res.error; }
      var mapped = mapEntry(res.data);
      DB.entries.push(mapped);
      return mapped;
    },
    update: async function (id, patch) {
      var row = entryToRow(patch);
      var res = await sb.from('entries').update(row).eq('id', id).select().single();
      if (res.error) { showToast('Klarte ikke å oppdatere hendelse: ' + res.error.message, 'danger'); throw res.error; }
      var idx = DB.entries.findIndex(function (e) { return e.id === id; });
      if (idx > -1) DB.entries[idx] = mapEntry(res.data);
    },
    remove: async function (id) {
      var res = await sb.from('entries').delete().eq('id', id);
      if (res.error) { showToast('Klarte ikke å slette hendelse: ' + res.error.message, 'danger'); throw res.error; }
      DB.entries = DB.entries.filter(function (e) { return e.id !== id; });
    }
  };

  var Maintenance = {
    all: function () { return DB.maintenance.slice().sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); }); },
    forProperty: function (propertyId) { return Maintenance.all().filter(function (m) { return m.propertyId === propertyId; }); },
    get: function (id) { return DB.maintenance.find(function (m) { return m.id === id; }); },
    add: async function (obj) {
      var row = maintenanceToRow(obj);
      row.user_id = currentUser.id;
      row.status = 'planlagt';
      var res = await sb.from('maintenance').insert(row).select().single();
      if (res.error) { showToast('Klarte ikke å lagre vedlikehold: ' + res.error.message, 'danger'); throw res.error; }
      var mapped = mapMaintenance(res.data);
      DB.maintenance.push(mapped);
      return mapped;
    },
    update: async function (id, patch) {
      var row = maintenanceToRow(patch);
      var res = await sb.from('maintenance').update(row).eq('id', id).select().single();
      if (res.error) { showToast('Klarte ikke å oppdatere vedlikehold: ' + res.error.message, 'danger'); throw res.error; }
      var idx = DB.maintenance.findIndex(function (m) { return m.id === id; });
      if (idx > -1) DB.maintenance[idx] = mapMaintenance(res.data);
    },
    remove: async function (id) {
      var res = await sb.from('maintenance').delete().eq('id', id);
      if (res.error) { showToast('Klarte ikke å slette vedlikehold: ' + res.error.message, 'danger'); throw res.error; }
      DB.maintenance = DB.maintenance.filter(function (m) { return m.id !== id; });
    }
  };

  // Setter en vedlikeholdsoppgave til utført. Er den gjentakende, planlegges neste runde automatisk.
  // Returnerer neste forfallsdato (eller null hvis oppgaven ikke gjentas).
  async function completeMaintenance(m, recurringOverride) {
    var recurring = recurringOverride !== undefined ? recurringOverride : m.recurring;
    await Maintenance.update(m.id, { status: 'utført' });
    var next = nextDueDate(m.dueDate, recurring);
    if (!next) return null;
    var exists = DB.maintenance.some(function (o) {
      return o.id !== m.id && o.propertyId === m.propertyId && o.title === m.title && o.dueDate === next && o.status !== 'utført';
    });
    if (!exists) {
      await Maintenance.add({ propertyId: m.propertyId, title: m.title, dueDate: next, recurring: recurring, notes: m.notes || '' });
    }
    return next;
  }

  var Inspections = {
    all: function () { return DB.inspections.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }); },
    forProperty: function (propertyId) { return Inspections.all().filter(function (i) { return i.propertyId === propertyId; }); },
    get: function (id) { return DB.inspections.find(function (i) { return i.id === id; }); },
    add: async function (obj) {
      var row = inspectionToRow(obj);
      row.user_id = currentUser.id;
      var res = await sb.from('inspections').insert(row).select().single();
      if (res.error) { showToast('Klarte ikke å lagre inspeksjon: ' + res.error.message, 'danger'); throw res.error; }
      var mapped = mapInspection(res.data);
      DB.inspections.push(mapped);
      return mapped;
    },
    remove: async function (id) {
      var res = await sb.from('inspections').delete().eq('id', id);
      if (res.error) { showToast('Klarte ikke å slette rapport: ' + res.error.message, 'danger'); throw res.error; }
      DB.inspections = DB.inspections.filter(function (i) { return i.id !== id; });
    }
  };

  /* ---------------- App state ---------------- */

  var state = {
    view: 'dashboard',
    selectedPropertyId: null,
    selectedReportId: null,
    logFilter: { propertyId: '', type: '', status: '', year: '', q: '' },
    wizard: null
  };

  /* ---------------- DOM refs ---------------- */

  var headerWrap = document.getElementById('headerWrap');
  var viewWrap = document.getElementById('viewWrap');
  var modalOverlay = document.getElementById('modalOverlay');
  var modalEl = document.getElementById('modal');
  var toastEl = document.getElementById('toast');

  /* ---------------- Toast ---------------- */

  var toastTimer = null;
  function showToast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (kind === 'danger' ? ' toast-danger' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  /* ---------------- Modal ---------------- */

  function openModal(html) {
    modalEl.innerHTML = html;
    modalOverlay.hidden = false;
    var firstInput = modalEl.querySelector('input, select, textarea');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 30);
  }
  function closeModal() {
    modalOverlay.hidden = true;
    modalEl.innerHTML = '';
  }
  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modalOverlay.hidden) closeModal();
  });

  /* ---------------- Navigation ---------------- */

  function setView(view, opts) {
    opts = opts || {};
    state.view = view;
    if (opts.propertyId !== undefined) state.selectedPropertyId = opts.propertyId;
    if (opts.reportId !== undefined) state.selectedReportId = opts.reportId;
    renderHeader();
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function applyViewWrapClass() {
    if (phase === 'app') viewWrap.classList.remove('landing-wrap');
    else viewWrap.classList.add('landing-wrap');
  }

  function setPhase(newPhase) {
    phase = newPhase;
    applyViewWrapClass();
    renderHeader();
    renderPhaseView();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderPhaseView() {
    if (phase === 'landing') return renderLanding();
    if (phase === 'login') return renderLogin();
    if (phase === 'signup') return renderSignup();
    if (phase === 'paywall') return renderPaywall();
    if (phase === 'app') return render();
  }

  function getCheckoutStatusFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get('checkout'); // 'success' | 'cancel' | null
  }

  function clearCheckoutParamFromUrl() {
    var url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  async function refetchSubscriptionStatus() {
    var profileRes = await sb.from('profiles').select('subscribed').eq('id', currentUser.id).single();
    if (profileRes.data) currentUser.subscribed = !!profileRes.data.subscribed;
    return currentUser.subscribed;
  }

  async function waitForSubscriptionConfirmation() {
    for (var i = 0; i < 8; i++) {
      if (await refetchSubscriptionStatus()) return true;
      await new Promise(function (resolve) { setTimeout(resolve, 1500); });
    }
    return false;
  }

  async function afterAuthSuccess() {
    var userRes = await sb.auth.getUser();
    var authUser = userRes.data && userRes.data.user;
    if (!authUser) { setPhase('login'); return; }
    var profileRes = await sb.from('profiles').select('*').eq('id', authUser.id).single();
    var profile = profileRes.data || {};
    var metaName = authUser.user_metadata && authUser.user_metadata.name;
    currentUser = {
      id: authUser.id,
      email: authUser.email,
      name: profile.name || metaName || authUser.email,
      subscribed: !!profile.subscribed
    };

    var checkoutStatus = getCheckoutStatusFromUrl();
    if (checkoutStatus === 'success' && !currentUser.subscribed) {
      viewWrap.classList.add('landing-wrap');
      viewWrap.innerHTML = '<div class="paywall-wrap"><p class="lp-lede">Bekrefter betalingen din, ett øyeblikk…</p></div>';
      await waitForSubscriptionConfirmation();
      clearCheckoutParamFromUrl();
    } else if (checkoutStatus) {
      clearCheckoutParamFromUrl();
    }

    DB = await loadAllDataForUser(authUser.id);
    state.view = 'dashboard';
    state.selectedPropertyId = null;
    state.selectedReportId = null;
    state.wizard = null;
    showToast('Velkommen, ' + currentUser.name + '.');
    setPhase(currentUser.subscribed ? 'app' : 'paywall');
  }

  async function handleLogout() {
    await sb.auth.signOut();
    currentUser = null;
    DB = emptyData();
    state.view = 'dashboard';
    state.selectedPropertyId = null;
    state.selectedReportId = null;
    state.wizard = null;
    showToast('Logget ut.');
    setPhase('landing');
  }

  /* ---------------- Header rendering ---------------- */

  function renderHeader() {
    if (phase === 'app') {
      headerWrap.innerHTML = appHeaderHtml();
      bindAppHeaderEvents();
    } else {
      headerWrap.innerHTML = marketingHeaderHtml();
      bindMarketingHeaderEvents();
    }
  }

  function tabButtonHtml(view, label) {
    return '<button class="tab-btn' + (state.view === view ? ' active' : '') + '" data-view="' + view + '">' + label + '</button>';
  }

  function appHeaderHtml() {
    var initials = currentUser && currentUser.name ? currentUser.name.trim().charAt(0).toUpperCase() : '?';
    return '' +
      '<header class="app-header">' +
        '<div class="app-header-inner">' +
          '<div class="brand"><span class="logo-mark">EL</span><span class="logo-word">Eiendoms<em>Logga</em></span></div>' +
          '<div class="header-actions">' +
            '<button class="btn btn-ghost btn-small hide-mobile" id="exportBtn" type="button"><span class="full-label">Eksporter data</span></button>' +
            '<button class="btn btn-primary btn-small" id="quickAddBtn" type="button">+ Ny hendelse</button>' +
            '<span class="account-pill"><span class="account-avatar">' + escapeHtml(initials) + '</span><span class="account-name">' + escapeHtml(currentUser ? currentUser.name : '') + '</span></span>' +
            '<button class="btn btn-ghost btn-small hide-mobile" id="manageSubBtn" type="button"><span class="full-label">Administrer abonnement</span></button>' +
            '<button class="btn btn-ghost btn-small" id="logoutBtn" type="button">Logg ut</button>' +
          '</div>' +
        '</div>' +
        '<nav class="tab-nav" aria-label="Hovedmeny">' +
          tabButtonHtml('dashboard', 'Oversikt') +
          tabButtonHtml('properties', 'Boliger') +
          tabButtonHtml('log', 'Logg') +
          tabButtonHtml('maintenance', 'Vedlikehold') +
          tabButtonHtml('inspection', 'Inspeksjon') +
          tabButtonHtml('reports', 'Rapporter') +
        '</nav>' +
      '</header>';
  }

  function bindAppHeaderEvents() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.wizard = null;
        setView(btn.dataset.view);
      });
    });
    var quickAdd = document.getElementById('quickAddBtn');
    if (quickAdd) quickAdd.addEventListener('click', function () { openEntryForm({}); });
    var exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportDataHandler);
    var manageSubBtn = document.getElementById('manageSubBtn');
    if (manageSubBtn) manageSubBtn.addEventListener('click', openBillingPortal);
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  }

  async function openBillingPortal() {
    var btn = document.getElementById('manageSubBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Åpner...'; }
    var res = await sb.functions.invoke('create-portal-session');
    if (res.error || !res.data || !res.data.url) {
      showToast('Klarte ikke å åpne abonnementssiden. Prøv igjen.', 'danger');
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="full-label">Administrer abonnement</span>'; }
      return;
    }
    window.location.href = res.data.url;
  }

  function marketingHeaderHtml() {
    var showLogout = phase === 'paywall';
    return '' +
      '<header class="marketing-header">' +
        '<div class="marketing-header-inner">' +
          '<div class="brand" id="brandHome" style="cursor:pointer;"><span class="logo-mark">EL</span><span class="logo-word">Eiendoms<em>Logga</em></span></div>' +
          '<nav class="marketing-nav-links">' +
            (phase === 'landing' ? '<a class="nav-anchor" href="#slik-fungerer-det">Slik fungerer det</a><a class="nav-anchor" href="#priser">Priser</a><a class="nav-anchor" href="#sporsmal">Spørsmål</a>' : '') +
            (showLogout
              ? '<a id="navLogout">Logg ut</a>'
              : '<a id="navLogin">Logg inn</a><a class="btn btn-primary btn-small" id="navSignup">Kom i gang</a>') +
          '</nav>' +
        '</div>' +
      '</header>';
  }

  function bindMarketingHeaderEvents() {
    var brand = document.getElementById('brandHome');
    if (brand) brand.addEventListener('click', function () { if (!currentUser) setPhase('landing'); });
    var navLogin = document.getElementById('navLogin');
    if (navLogin) navLogin.addEventListener('click', function () { setPhase('login'); });
    var navSignup = document.getElementById('navSignup');
    if (navSignup) navSignup.addEventListener('click', function () { setPhase('signup'); });
    var navLogout = document.getElementById('navLogout');
    if (navLogout) navLogout.addEventListener('click', handleLogout);
  }

  function exportDataHandler() {
    var blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'eiendomslogga-data-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Data eksportert som JSON.');
  }

  /* ---------------- Signature pad ---------------- */

  function attachSignaturePad(canvas) {
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var hasDrawn = false;
    var ratio = window.devicePixelRatio || 1;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#131E33';
    }
    resize();

    function pos(evt) {
      var rect = canvas.getBoundingClientRect();
      var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      var clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function start(evt) {
      evt.preventDefault();
      drawing = true;
      hasDrawn = true;
      var p = pos(evt);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function move(evt) {
      if (!drawing) return;
      evt.preventDefault();
      var p = pos(evt);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    function end() { drawing = false; }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    return {
      clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); hasDrawn = false; },
      isEmpty: function () { return !hasDrawn; },
      toDataURL: function () { return canvas.toDataURL('image/png'); }
    };
  }

  /* ================================================================
     ICONS (small inline SVGs, currentColor)
     ================================================================ */

  function iconHome() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>'; }
  function iconClipboard() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M8 11h8M8 15h5"/></svg>'; }
  function iconCamera() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="4"/><path d="M8.5 7l1.2-2h4.6l1.2 2"/></svg>'; }
  function iconDoc() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h6"/></svg>'; }
  function iconCameraSmall() { return '<svg viewBox="0 0 48 48" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="12" width="36" height="26" rx="2"/><circle cx="24" cy="25" r="7"/><path d="M17 12l2.5-4h9L31 12"/></svg>'; }
  function iconLock() { return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'; }
  function iconImage() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16.5l-5.5-5.5L7 19"/></svg>'; }
  function iconCalendar() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'; }
  function iconClock() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>'; }
  function stampSvg() {
    return '<svg viewBox="0 0 100 100" width="72" height="72"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<text x="50" y="44" text-anchor="middle" font-family="\'JetBrains Mono\', monospace" font-size="10.5" font-weight="600" fill="currentColor">GODKJENT</text>' +
      '<text x="50" y="64" text-anchor="middle" font-family="\'JetBrains Mono\', monospace" font-size="8" fill="currentColor">' + todayISO().split('-').reverse().join('.') + '</text></svg>';
  }

  /* ================================================================
     LANDING PAGE (marketing homepage)
     ================================================================ */

  function heroIllustrationHtml() {
    return '<div class="plan-visual" aria-hidden="true">' +
      '<div class="plan-frame">' +
        '<div class="plan-canvas">' +
          '<svg class="plan-svg" viewBox="0 0 480 380" xmlns="http://www.w3.org/2000/svg">' +
            '<line x1="40" y1="26" x2="440" y2="26" stroke="var(--plan-line)" stroke-width="1"/>' +
            '<line x1="40" y1="22" x2="40" y2="30" stroke="var(--plan-line)" stroke-width="1"/>' +
            '<line x1="440" y1="22" x2="440" y2="30" stroke="var(--plan-line)" stroke-width="1"/>' +
            '<text class="plan-dim-text" x="240" y="18">10,0 M</text>' +
            '<line x1="24" y1="40" x2="24" y2="340" stroke="var(--plan-line)" stroke-width="1"/>' +
            '<line x1="20" y1="40" x2="28" y2="40" stroke="var(--plan-line)" stroke-width="1"/>' +
            '<line x1="20" y1="340" x2="28" y2="340" stroke="var(--plan-line)" stroke-width="1"/>' +
            '<text class="plan-dim-text" x="14" y="193" transform="rotate(-90 14 193)">7,5 M</text>' +
            '<rect x="40" y="40" width="220" height="160" fill="none" stroke="var(--plan-line)" stroke-width="1.2"/>' +
            '<rect x="260" y="40" width="180" height="160" fill="none" stroke="var(--plan-line)" stroke-width="1.2"/>' +
            '<rect x="40" y="200" width="400" height="60" fill="none" stroke="var(--plan-line)" stroke-width="1.2"/>' +
            '<rect x="40" y="260" width="180" height="80" fill="none" stroke="var(--plan-line)" stroke-width="1.2"/>' +
            '<rect x="220" y="260" width="220" height="80" fill="none" stroke="var(--plan-line)" stroke-width="1.2"/>' +
            '<rect x="40" y="40" width="400" height="300" fill="none" stroke="var(--plan-line)" stroke-width="2.4"/>' +
            '<text class="plan-room-label" x="150" y="66">STUE</text>' +
            '<text class="plan-room-label" x="350" y="66">KJØKKEN</text>' +
            '<text class="plan-room-label" x="240" y="234">GANG</text>' +
            '<text class="plan-room-label" x="130" y="286">BAD</text>' +
            '<text class="plan-room-label" x="330" y="286">SOVEROM</text>' +
          '</svg>' +
          '<div class="plan-tag" style="left:26%; top:80%; transform:translate(-50%,0);"><span class="plan-tag-dot"></span>Inspeksjon fullført</div>' +
          '<div class="plan-tag" style="left:76%; top:25%; transform:translate(-50%,0);"><span class="plan-tag-dot warn"></span>Lekkasje meldt · 12.03</div>' +
          '<div class="plan-tag" style="left:74%; top:84%; transform:translate(-50%,0);"><span class="plan-tag-dot"></span>Signert av begge parter</div>' +
        '</div>' +
      '</div>' +
      '<p class="plan-caption">H0304 · Storgata 12 · registrert i EiendomsLogga</p>' +
    '</div>';
  }

  // Fyll inn en e-postadresse her, så vises den i bunnteksten på forsiden. Tom = vises ikke.
  var CONTACT_EMAIL = '';

  function howStep(num, title, body, iconHtml) {
    return '<div class="how-step"><div class="how-step-icon">' + iconHtml + '</div><p class="how-step-num mono">STEG ' + num + '</p><h3>' + title + '</h3><p>' + body + '</p></div>';
  }

  function lpFeature(title, body, iconHtml) {
    return '<div class="lp-feature-card"><div class="lp-feature-icon">' + iconHtml + '</div><h3>' + title + '</h3><p>' + body + '</p></div>';
  }

  function iconDownload() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>'; }
  function iconCoins() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>'; }
  function iconAlert() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/></svg>'; }
  function iconMail() { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>'; }
  function iconChat() { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>'; }
  function iconScale() { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M6 21h12"/><path d="M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/></svg>'; }

  function painCard(icon, title, body) {
    return '<div class="pain-card"><div class="pain-icon">' + icon + '</div><h3>' + title + '</h3><p>' + body + '</p></div>';
  }

  // Eksempeldata i forhåndsvisningene er laget for illustrasjon og er ikke ekte kunder.
  function previewDashboardHtml() {
    function row(tone, label, text, meta) {
      return '<div class="mock-row"><span class="attention-dot ' + tone + '"></span><span class="mock-row-main"><em>' + label + '</em>' + text + '</span><span class="mock-row-meta">' + meta + '</span></div>';
    }
    return '<div class="mock-window" id="liveDash" aria-hidden="true">' +
      '<div class="mock-bar"><span></span><span></span><span></span><i>eiendomslogga.no</i></div>' +
      '<div class="mock-body">' +
        '<div class="mock-stats">' +
          '<div><small>BOLIGER</small><b data-count="4">4</b></div><div><small>ÅPNE FEIL</small><b class="o" id="liveOpen" data-count="2">2</b></div>' +
          '<div><small>VEDLIKEHOLD SNART</small><b class="a" data-count="3">3</b></div><div><small>INSPEKSJONER</small><b data-count="6">6</b></div>' +
        '</div>' +
        '<p class="mock-title">KREVER OPPMERKSOMHET</p>' +
        '<div class="mock-list">' +
          row('late', 'Forfalt', 'Røykvarsler', 'Storgata 12 · 9 dager siden') +
          row('late', 'Åpen feil', 'Vannlekkasje ved kjøkkenvask', 'Storgata 12 · åpen i 3 dager').replace('class="mock-row"', 'class="mock-row" id="liveRow"') +
          row('soon', 'Forfaller snart', 'Rens av takrenner', 'Kystveien 87 · om 12 dager') +
        '</div>' +
      '</div>' +
      '<p class="mock-caption">Eksempeldata</p></div>';
  }

  function previewReportHtml() {
    function r(name, cond, cls) { return '<div class="mock-room"><span>' + name + '</span><b class="' + cls + '">' + cond + '</b></div>'; }
    return '<div class="mock-report" id="liveReport" aria-hidden="true">' +
      '<p class="mock-report-eyebrow">EIENDOMSLOGGA · INNFLYTTINGSRAPPORT</p>' +
      '<h3>Storgata 12</h3><p class="mock-report-meta">12.03.2026 · Leietaker: Kari Nordmann</p>' +
      r('Stue', 'GOD', 'g') + r('Kjøkken', 'OK', 'o') + r('Bad', 'GOD', 'g') + r('Soverom', 'GOD', 'g') +
      '<div class="mock-sign">' +
        '<svg viewBox="0 0 160 50"><path class="sig-path" pathLength="1" d="M6 36 C16 6 26 46 36 22 S56 8 66 32 S92 14 100 28 S128 24 152 18" fill="none" stroke="#26364A" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<svg viewBox="0 0 160 50"><path class="sig-path sig2" pathLength="1" d="M6 32 C20 10 30 44 46 24 S74 10 84 30 S116 18 152 26" fill="none" stroke="#26364A" stroke-width="2" stroke-linecap="round"/></svg>' +
      '</div><div class="mock-sign-labels"><span>LEIETAKER</span><span>UTLEIER</span></div>' +
      '<div class="mock-stamp"><span>GODKJENT</span></div>' +
    '</div>';
  }


  function compareHtml() {
    function row(topic, before, after) {
      return '<div class="cmp-row" role="row"><div class="cmp-topic" role="rowheader">' + topic + '</div>' +
        '<div class="cmp-before" role="cell"><span class="cmp-x" aria-hidden="true">✕</span>' + before + '</div>' +
        '<div class="cmp-after" role="cell"><span class="cmp-ok" aria-hidden="true">✓</span>' + after + '</div></div>';
    }
    return '<div class="cmp" role="table" aria-label="Sammenligning av hvordan det ofte er i dag og med EiendomsLogga">' +
      '<div class="cmp-head" role="row"><div role="columnheader"></div><div role="columnheader">Slik er det ofte</div><div role="columnheader">Med EiendomsLogga</div></div>' +
      row('Kvitteringer', 'Spredt mellom e-post, mapper og bilder på telefonen', 'Lagt til hendelsen, med bilde og beløp') +
      row('Feil fra leietaker', 'En tekstmelding som lett forsvinner', 'Logget med dato og status fra meldt til utbedret') +
      row('Vedlikehold', 'Du må huske at takrennene skal renses', 'Plan med neste dato. Gjentakende oppgaver fornyes selv') +
      row('Innflytting', 'Noen bilder og minnet ditt', 'Rom for rom, med bilder og signatur fra begge parter') +
      row('Regnskap og skatt', 'Lete i bunker når året skal gjøres opp', 'Kostnader per bolig og år, som CSV') +
    '</div>';
  }

  function tourHtml() {
    function tab(id, label, selected) {
      return '<button class="tour-tab" role="tab" id="tourTab-' + id + '" aria-controls="tourPanel-' + id + '" aria-selected="' + (selected ? 'true' : 'false') + '" tabindex="' + (selected ? '0' : '-1') + '" data-tour="' + id + '">' + label + '</button>';
    }
    function tl(type, tone, title, meta, extra) {
      return '<div class="tl-item"><span class="tl-badge ' + tone + '">' + type + '</span><div class="tl-main"><b>' + title + '</b><small>' + meta + '</small></div>' + (extra || '') + '</div>';
    }
    function mt(title, meta, tag, late) {
      return '<div class="mt-item' + (late ? ' late' : '') + '"><span class="attention-dot ' + (late ? 'late' : 'soon') + '"></span><div class="tl-main"><b>' + title + '</b><small>' + meta + '</small></div>' + (tag ? '<span class="mt-tag">' + tag + '</span>' : '') + '</div>';
    }
    var bars = [['jan', 30], ['feb', 12], ['mar', 62], ['apr', 20], ['mai', 8], ['jun', 44], ['jul', 16], ['aug', 28], ['sep', 100], ['okt', 36], ['nov', 52]];
    var barsHtml = bars.map(function (b) { return '<div class="bar"><i style="--h:' + b[1] + '%"></i><span>' + b[0] + '</span></div>'; }).join('');
    return '<div class="tour" id="tour">' +
      '<div class="tour-tabs" role="tablist" aria-label="Utforsk appen">' + tab('logg', 'Logg', true) + tab('vedlikehold', 'Vedlikehold', false) + tab('kostnader', 'Kostnader', false) + '</div>' +
      '<div class="tour-stage">' +
        '<div class="tour-panel" role="tabpanel" id="tourPanel-logg" aria-labelledby="tourTab-logg">' +
          '<div class="mock-window" aria-hidden="true"><div class="mock-bar"><span></span><span></span><span></span><i>Storgata 12 · Logg</i></div><div class="tour-body">' +
            '<div class="tour-chips"><span class="chip on">Alle</span><span class="chip">Feil</span><span class="chip">Vedlikehold</span><span class="chip">Dokument</span></div>' +
            tl('FEIL', 'o', 'Vannlekkasje ved kjøkkenvask', '18.11.2026 · 2 bilder · åpen', '<span class="tl-state o">ÅPEN</span>') +
            tl('VEDL.', 'a', 'Service varmepumpe', '02.03.2026 · 1 450 kr', '<span class="tl-state g">LØST</span>') +
            tl('DOK.', 'b', 'Kvittering røykvarslere', '05.12.2025 · 800 kr · kvittering.pdf', '<span class="tl-state g">LØST</span>') +
            '<p class="tour-sum">3 hendelser · <b>2 250 kr</b></p>' +
          '</div><p class="mock-caption">Eksempeldata</p></div>' +
          '<div class="tour-note"><h3>Alt som skjer med boligen, i rekkefølge</h3><p>Søk, filtrer på år og type, og rediger i etterkant. Bilder og kvitteringer ligger på hendelsen de hører til.</p></div>' +
        '</div>' +
        '<div class="tour-panel" role="tabpanel" id="tourPanel-vedlikehold" aria-labelledby="tourTab-vedlikehold" hidden>' +
          '<div class="mock-window" aria-hidden="true"><div class="mock-bar"><span></span><span></span><span></span><i>Vedlikeholdsplan</i></div><div class="tour-body">' +
            mt('Røykvarsler, bytt batteri', 'Storgata 12 · forfalt for 9 dager siden', 'Kvartalsvis', true) +
            mt('Rens av takrenner', 'Kystveien 87 · om 12 dager', 'Årlig', false) +
            mt('Ettersyn tak', 'Storgata 12 · 30.11.2026', '', false) +
            '<div class="mt-done" id="mtDone"><button class="mt-btn" tabindex="-1">Merk utført</button><span>Neste runde planlegges automatisk: <b>12.02.2027</b></span></div>' +
          '</div><p class="mock-caption">Eksempeldata</p></div>' +
          '<div class="tour-note"><h3>Vedlikehold som planlegger seg selv</h3><p>Velg kvartalsvis, halvårlig eller årlig. Når du merker oppgaven utført, lages neste automatisk, og det som haster havner øverst på oversikten.</p></div>' +
        '</div>' +
        '<div class="tour-panel" role="tabpanel" id="tourPanel-kostnader" aria-labelledby="tourTab-kostnader" hidden>' +
          '<div class="mock-window" aria-hidden="true"><div class="mock-bar"><span></span><span></span><span></span><i>Kostnader · 2026</i></div><div class="tour-body">' +
            '<div class="tour-chips"><span class="chip on">Alle boliger</span><span class="chip">2026</span><span class="chip csv">Last ned CSV</span></div>' +
            '<div class="bars" aria-hidden="true">' + barsHtml + '</div>' +
            '<p class="tour-sum">Sum hittil i år · <b>12 450 kr</b></p>' +
          '</div><p class="mock-caption">Eksempeldata</p></div>' +
          '<div class="tour-note"><h3>Tallene klare når året skal gjøres opp</h3><p>Filtrer på bolig og år, se summen, og last ned som CSV til regneark eller regnskap.</p></div>' +
        '</div>' +
      '</div></div>';
  }

  function faqItem(q, a) {
    return '<details class="faq-item"><summary>' + q + '</summary><p>' + a + '</p></details>';
  }

  function pricingCardHtml(buttonId, buttonLabel) {
    return '<div class="pricing-wrap"><div class="pricing-card">' +
      '<span class="pricing-badge">ABONNEMENT</span>' +
      '<p class="pricing-price">499 kr<span> / måned</span></p>' +
      '<p class="pricing-sub">Ubegrenset antall boliger. Avslutt når du vil.</p>' +
      '<ul class="pricing-features">' +
        '<li>Ubegrenset feilregistrering og logg</li>' +
        '<li>Bilder, dokumenter og kvitteringer</li>' +
        '<li>Digitale inspeksjoner med signatur</li>' +
        '<li>Rapporter du kan skrive ut eller lagre som PDF</li>' +
        '<li>Vedlikeholdsplan med gjentakende oppgaver</li>' +
        '<li>Kostnadsoversikt med CSV-eksport</li>' +
      '</ul>' +
      '<button class="btn btn-primary btn-block" id="' + buttonId + '">' + buttonLabel + '</button>' +
      '<p class="pricing-fine">Ingen bindingstid. Du avslutter selv under «Administrer abonnement».</p>' +
    '</div></div>';
  }

  function renderLanding() {
    var html = '';

    html += '<section class="lp-section lp-hero has-video">' +
      '<video class="hero-video" autoplay muted loop playsinline preload="metadata" poster="hero-poster.jpg" aria-hidden="true" tabindex="-1">' +
        '<source src="hero.webm" type="video/webm"><source src="hero.mp4" type="video/mp4"></video>' +
      '<div class="hero-video-shade"></div>' +
      '<div class="lp-inner lp-hero-grid">' +
      '<div>' +
        '<p class="eyebrow">FOR SMÅ OG MELLOMSTORE UTLEIERE</p>' +
        '<h1>Slutt å lete etter kvitteringen i en e‑posttråd.</h1>' +
        '<p class="lp-hero-lede">EiendomsLogga samler feil, bilder, kvitteringer, vedlikehold og inspeksjoner for hver bolig på ett sted — med dato, historikk og signatur, klart når noen spør.</p>' +
        '<div class="lp-hero-actions">' +
          '<button class="btn btn-primary btn-lg" id="heroCta">Kom i gang</button>' +
          '<a class="btn btn-ghost btn-lg" href="#slik-fungerer-det">Se hvordan det fungerer</a>' +
        '</div>' +
        '<ul class="trust-row">' +
          '<li>499 kr i måneden — ubegrenset antall boliger</li>' +
          '<li>Ingen bindingstid</li>' +
          '<li>Dataene dine kan eksporteres når som helst</li>' +
        '</ul>' +
      '</div>' +
      heroIllustrationHtml() +
    '</div></section>';

    html += '<section class="lp-section tinted reveal" id="problemet"><div class="lp-inner">' +
      '<p class="eyebrow">SLIK ER DET OFTE I DAG</p>' +
      '<h2>Det du trenger, ligger alltid et annet sted</h2>' +
      '<p class="lp-lede">Det går fint så lenge alt er rolig. Problemet kommer når noen spør hva som faktisk ble gjort, og når.</p>' +
      '<div class="pain-grid">' +
        painCard(iconMail(), 'Kvitteringen er et sted i e-posten', 'Rørleggeren sendte regningen for et halvt år siden. Du vet den finnes — men ikke i hvilken tråd.') +
        painCard(iconChat(), 'Leietaker sa det på tekstmelding', 'Meldingen om fukten på badet forsvant mellom alt annet. Nå er det uenighet om når du fikk vite det.') +
        painCard(iconScale(), 'Uenighet om depositum', 'Ved utflytting står du med bare hukommelsen din, uten bilder, dato eller signatur fra innflyttingen.') +
      '</div>' +
    '</div></section>';

    html += '<section class="lp-section reveal" id="sammenligning"><div class="lp-inner">' +
      '<p class="eyebrow">FØR OG ETTER</p><h2>Samme jobb, mindre leting</h2>' +
      '<p class="lp-lede">Du gjør allerede mye av dette i dag. Forskjellen er at det havner samme sted, med dato.</p>' +
      compareHtml() +
    '</div></section>';

    html += '<section class="lp-section reveal" id="slik-fungerer-det"><div class="lp-inner">' +
      '<p class="eyebrow">SLIK FUNGERER DET</p>' +
      '<h2>Fra registrert bolig til ferdig rapport</h2>' +
      '<p class="lp-lede">Fire steg som dekker det meste en utleier trenger å holde styr på gjennom hele leieforholdet.</p>' +
      '<div class="how-steps">' +
        howStep('01', 'Registrer boligen', 'Legg inn adresse, rom og leietaker. Dette blir startpunktet for boligens egen logg.', iconHome()) +
        howStep('02', 'Loggfør det som skjer', 'Feil, vedlikehold, kvitteringer og bilder registreres fortløpende, på PC eller mobil.', iconClipboard()) +
        howStep('03', 'Gjennomfør inspeksjon', 'Ved inn- eller utflytting fylles en digital befaring ut med bilder og signatur fra begge parter.', iconCamera()) +
        howStep('04', 'Få ferdig rapport', 'Inspeksjonen blir til en rapport du kan skrive ut eller lagre som PDF.', iconDoc()) +
      '</div>' +
    '</div></section>';

    html += '<section class="lp-section tinted reveal" id="se-appen"><div class="lp-inner">' +
      '<p class="eyebrow">SLIK SER DET UT</p>' +
      '<h2>Oversikt over det som trenger deg, og rapport som holder</h2>' +
      '<p class="lp-lede">Oversikten viser hva som er forfalt, hva som forfaller snart og hvilke feil som er åpne. Inspeksjonene ender som en ferdig rapport med signatur fra begge parter.</p>' +
      '<div class="preview-grid">' + previewDashboardHtml() + previewReportHtml() + '</div>' +
    '</div></section>';

    html += '<section class="lp-section reveal" id="omvisning"><div class="lp-inner">' +
      '<p class="eyebrow">PRØV DEG FRAM</p><h2>Se hva du får i hverdagen</h2>' +
      '<p class="lp-lede">Bla mellom logg, vedlikehold og kostnader for å se hvordan det ser ut i bruk.</p>' +
      tourHtml() +
    '</div></section>';

    html += '<section class="lp-section reveal"><div class="lp-inner">' +
      '<p class="eyebrow">ALT PÅ ETT STED</p><h2>Bygget rundt hvordan en bolig faktisk driftes</h2>' +
      '<p class="lp-lede">Det du trenger for å holde orden, uten at det blir et stort system å sette seg inn i.</p>' +
      '<div class="lp-feature-grid">' +
        lpFeature('Feilregistrering', 'Det leietaker melder om forsvinner ikke i en tekstmelding du ikke finner igjen — skriv det inn på et minutt, med status fra meldt til utbedret.', iconClipboard()) +
        lpFeature('Bilder og dokumenter', 'Last opp bilder, kontrakter og kvitteringer til hver hendelse, og finn dem igjen med søk.', iconImage()) +
        lpFeature('Vedlikeholdsplan', 'Planlegg service og sesongvedlikehold. Gjentakende oppgaver planlegger neste runde selv når du merker dem utført.', iconCalendar()) +
        lpFeature('Krever oppmerksomhet', 'Oversikten viser forfalt vedlikehold, oppgaver som forfaller de neste 30 dagene og feil som fortsatt er åpne.', iconAlert()) +
        lpFeature('Digital inspeksjon', 'Gjennomfør inn- og utflyttingskontroller på mobilen, rom for rom, med signatur på stedet.', iconCamera()) +
        lpFeature('Rapporter', 'Inspeksjoner blir til ferdige rapporter du kan skrive ut eller lagre som PDF.', iconDoc()) +
        lpFeature('Historikk per bolig', 'Se hele livsløpet til hver leilighet — hva som er gjort, når, og hva det kostet. Skriv ut hele historikken om noen ber om den.', iconClock()) +
        lpFeature('Kostnader og CSV', 'Filtrer på bolig og år, se summen av kostnadene og last ned som CSV. Greit å ha når skattemeldingen skal fylles ut.', iconCoins()) +
        lpFeature('Dataene dine er dine', 'Eksporter alt som JSON når du vil. Du kan avslutte abonnementet selv, uten å ringe noen.', iconDownload()) +
      '</div>' +
    '</div></section>';

    html += '<section class="lp-section tinted reveal" id="depositum"><div class="lp-inner depositum">' +
      '<div><p class="eyebrow">NÅR NOEN SPØR</p><h2>Dokumentasjon er mye enklere å ha før du trenger den</h2></div>' +
      '<div><p class="lp-lede" style="margin-bottom:16px;">Ved innflytting dokumenterer du tilstanden rom for rom, med bilder og signatur fra begge parter. Underveis loggfører du feil og vedlikehold med dato. Ved utflytting gjør du det samme, og har noe konkret å sammenligne med.</p>' +
      '<p class="fine-print">EiendomsLogga er et dokumentasjonsverktøy og gir ikke juridisk rådgivning. Ved en konkret tvist bør du kontakte jurist eller Husleietvistutvalget.</p></div>' +
    '</div></section>';

    html += '<section class="lp-section reveal" id="priser"><div class="lp-inner" style="text-align:center;">' +
      '<p class="eyebrow" style="text-align:center;">PRISER</p><h2 style="margin-left:auto;margin-right:auto;">Ett abonnement, alt inkludert</h2>' +
      '<p class="lp-lede" style="margin-left:auto;margin-right:auto;text-align:center;">Ingen skjulte kostnader. Legg til så mange boliger du trenger.</p>' +
      pricingCardHtml('pricingCta', 'Kom i gang') +
      '<div class="calc"><label for="calcRange">Hvor mange boliger har du?</label>' +
        '<input id="calcRange" type="range" min="1" max="20" value="3">' +
        '<p class="calc-out"><b id="calcN">3</b> <span id="calcUnit">boliger</span> gir <b id="calcPer">166 kr</b> per bolig i måneden</p></div>' +
    '</div></section>';

    html += '<section class="lp-section tinted reveal" id="sporsmal"><div class="lp-inner faq-wrap">' +
      '<p class="eyebrow">SPØRSMÅL</p><h2>Ofte stilte spørsmål</h2>' +
      '<div class="faq-list">' +
        faqItem('Hva koster det?', '499 kr i måneden, for alle boligene dine. Det er ingen ekstra pris per bolig.') +
        faqItem('Er det bindingstid?', 'Nei. Du kan avslutte abonnementet selv under «Administrer abonnement» i appen.') +
        faqItem('Fungerer det på mobil?', 'Ja. EiendomsLogga kjører i nettleseren på mobil, nettbrett og PC, så du kan ta bilder og fylle ut inspeksjonen mens du er i boligen.') +
        faqItem('Må leietaker ha konto?', 'Nei. Leietaker trenger ikke gjøre noe på forhånd. Ved inspeksjonen signerer begge parter direkte på skjermen din.') +
        faqItem('Hvem eier dataene mine?', 'Du. Du kan eksportere alt som JSON, og laste ned loggen som CSV. Slettes en bolig, slettes loggen for den også.') +
        faqItem('Er rapportene juridisk bindende?', 'Rapportene er dokumentasjon med dato og signaturer fra begge parter. EiendomsLogga gir ikke juridisk rådgivning, og hvor mye en rapport veier i en tvist avhenger av saken.') +
        faqItem('Hvor lagres dataene, og hva med betalingen?', 'Data lagres hos Supabase. Betalingen håndteres av Stripe, og kortopplysningene dine lagres aldri hos oss. Les mer i <a href="personvern.html">personvernerklæringen</a>.') +
        faqItem('Hvem står bak?', 'EiendomsLogga drives av Enkel Orden AS i Kristiansand (org.nr. 838 591 892).') +
      '</div>' +
    '</div></section>';

    html += '<section class="lp-section cta-band reveal"><div class="lp-inner" style="text-align:center;">' +
      '<h2 style="margin-left:auto;margin-right:auto;max-width:26ch;">Få orden på boligene før noen spør om dokumentasjon</h2>' +
      '<p class="lp-lede" style="margin:0 auto 26px;text-align:center;">Registrer den første boligen på noen minutter.</p>' +
      '<button class="btn btn-primary btn-lg" id="ctaBandBtn">Kom i gang</button>' +
    '</div></section>';

    html += '<footer class="lp-footer"><div class="lp-inner lp-footer-inner">' +
      '<span>© 2026 Enkel Orden AS · Org.nr. 838 591 892 · Videoklipp: RDNE Stock project / Pexels</span>' +
      '<span class="lp-footer-links"><a href="personvern.html">Personvern</a><a href="vilkar.html">Vilkår</a>' +
        (CONTACT_EMAIL ? '<a href="mailto:' + escapeHtml(CONTACT_EMAIL) + '">' + escapeHtml(CONTACT_EMAIL) + '</a>' : '') + '</span>' +
      '<span class="mono">LOGGET I KRISTIANSAND</span>' +
    '</div></footer>';

    html += '<div class="sticky-cta" id="stickyCta" hidden><button class="btn btn-primary btn-block" id="stickyCtaBtn">Kom i gang — 499 kr/mnd</button></div>';

    viewWrap.innerHTML = html;

    function goSignup() { setPhase(currentUser ? 'paywall' : 'signup'); }
    ['heroCta', 'pricingCta', 'ctaBandBtn', 'stickyCtaBtn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', goSignup);
    });

    var range = document.getElementById('calcRange');
    if (range) {
      var updateCalc = function () {
        var n = Number(range.value) || 1;
        document.getElementById('calcN').textContent = n;
        document.getElementById('calcUnit').textContent = n === 1 ? 'bolig' : 'boliger';
        document.getElementById('calcPer').textContent = Math.round(499 / n) + ' kr';
        range.style.setProperty('--fill', ((n - 1) / 19 * 100) + '%');
      };
      range.addEventListener('input', updateCalc);
      updateCalc();
    }

    // Vis den faste knappen på mobil når hero-knappen har scrollet ut av bildet.
    var heroCtaEl = document.getElementById('heroCta');
    var stickyEl = document.getElementById('stickyCta');
    if (heroCtaEl && stickyEl && 'IntersectionObserver' in window) {
      var stickyObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { stickyEl.hidden = en.isIntersecting || en.boundingClientRect.top > 0; });
      });
      stickyObserver.observe(heroCtaEl);
    }

    initRevealObserver();
    initLivePreview();
    initTour();
  }

  // «Levende» forhåndsvisning: animasjonene starter når eksemplene kommer til syne, og stopper når de forsvinner.
  function initLivePreview() {
    var dash = document.getElementById('liveDash');
    var report = document.getElementById('liveReport');
    if (!dash && !report) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;

    var dashTimers = [], reportTimers = [];
    function laterIn(list, fn, ms) { list.push(setTimeout(fn, ms)); }
    function clearList(list) { list.forEach(clearTimeout); list.length = 0; }

    function countUp(el, to) {
      var start = null, dur = 900;
      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(step);
      }
      el.textContent = '0';
      requestAnimationFrame(step);
    }

    function runDash() {
      clearList(dashTimers);
      var row = document.getElementById('liveRow');
      var open = document.getElementById('liveOpen');
      var label = row && row.querySelector('em');
      var dot = row && row.querySelector('.attention-dot');
      var meta = row && row.querySelector('.mock-row-meta');
      var main = row && row.querySelector('.mock-row-main');
      // Nullstill
      dash.classList.remove('live');
      void dash.offsetWidth;
      dash.classList.add('live');
      dash.querySelectorAll('[data-count]').forEach(function (b) { countUp(b, Number(b.getAttribute('data-count'))); });
      if (row) {
        row.classList.remove('resolved');
        if (dot) dot.className = 'attention-dot late';
        if (label) label.textContent = 'Åpen feil';
        if (meta) meta.textContent = 'Storgata 12 · åpen i 3 dager';
      }
      // Etter 3,5 s: feilen blir løst, og tallet går ned
      laterIn(dashTimers, function () {
        if (!row) return;
        row.classList.add('resolved');
        if (dot) dot.className = 'attention-dot ok';
        if (label) label.textContent = 'Løst nå';
        if (meta) meta.textContent = 'Storgata 12 · registrert av deg';
        if (open) { open.textContent = '1'; open.classList.remove('bump'); void open.offsetWidth; open.classList.add('bump'); }
      }, 3500);
      laterIn(dashTimers, runDash, 9000);
    }

    function runReport() {
      clearList(reportTimers);
      report.classList.remove('live');
      void report.offsetWidth;
      report.classList.add('live');
      laterIn(reportTimers, runReport, 11000);
    }

    var seen = { dash: false, report: false };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var key = en.target === dash ? 'dash' : 'report';
        if (en.isIntersecting && !seen[key]) {
          seen[key] = true;
          if (key === 'dash') runDash(); else runReport();
        } else if (!en.isIntersecting && seen[key]) {
          seen[key] = false;
          if (key === 'dash') { clearList(dashTimers); dash.classList.remove('live'); }
          else { clearList(reportTimers); report.classList.remove('live'); }
        }
      });
    }, { threshold: 0.4 });
    if (dash) io.observe(dash);
    if (report) io.observe(report);
  }


  // Fanene i omvisningen: tastaturstyrt (piltaster), og de bytter selv til brukeren tar over.
  function initTour() {
    var root = document.getElementById('tour');
    if (!root) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll('.tour-tab'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('.tour-panel'));
    var touched = false, timer = null, visible = false;

    function select(i, focus) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panels[k].hidden = !on;
        if (on) { panels[k].classList.remove('tour-in'); void panels[k].offsetWidth; panels[k].classList.add('tour-in'); }
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { touched = true; stop(); select(i, false); });
      t.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') n = (i + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = tabs.length - 1;
        if (n !== null) { e.preventDefault(); touched = true; stop(); select(n, true); }
      });
    });
    function current() { return tabs.findIndex(function (t) { return t.getAttribute('aria-selected') === 'true'; }); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (timer || touched) return;
      timer = setInterval(function () { select((current() + 1) % tabs.length, false); }, 6000);
    }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) start(); else stop();
    }, { threshold: 0.5 }).observe(root);
  }

  function initRevealObserver() {
    var targets = viewWrap.querySelectorAll('.reveal');
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('reveal-visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    targets.forEach(function (el) { observer.observe(el); });
  }

  /* ================================================================
     AUTH: login / signup
     ================================================================ */

  function renderLogin(errorMsg) {
    viewWrap.innerHTML =
      '<div class="auth-wrap"><div class="auth-card">' +
        '<h1>Logg inn</h1>' +
        '<p class="lp-lede">Logg inn for å administrere boligene dine.</p>' +
        (errorMsg ? '<div class="auth-error">' + escapeHtml(errorMsg) + '</div>' : '') +
        '<form id="loginForm">' +
          '<div class="form-field"><label for="li-email">E-post</label><input id="li-email" type="email" name="email" required autocomplete="email"></div>' +
          '<div class="form-field"><label for="li-password">Passord</label><input id="li-password" type="password" name="password" required autocomplete="current-password"></div>' +
          '<button type="submit" class="btn btn-primary btn-block">Logg inn</button>' +
        '</form>' +
        '<p class="auth-switch">Ny hos EiendomsLogga? <a id="toSignup">Opprett konto</a></p>' +
      '</div></div>';

    document.getElementById('toSignup').addEventListener('click', function () { setPhase('signup'); });
    document.getElementById('loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var email = (fd.get('email') || '').toString().trim();
      var password = (fd.get('password') || '').toString();
      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true; submitBtn.textContent = 'Logger inn…';
      var res = await sb.auth.signInWithPassword({ email: email, password: password });
      if (res.error) { renderLogin(res.error.message); return; }
      await afterAuthSuccess();
    });
  }

  function renderSignup(errorMsg) {
    viewWrap.innerHTML =
      '<div class="auth-wrap"><div class="auth-card">' +
        '<h1>Opprett konto</h1>' +
        '<p class="lp-lede">Registrer deg for å sette opp abonnementet ditt.</p>' +
        (errorMsg ? '<div class="auth-error">' + escapeHtml(errorMsg) + '</div>' : '') +
        '<form id="signupForm">' +
          '<div class="form-field"><label for="su-name">Navn</label><input id="su-name" name="name" required autocomplete="name"></div>' +
          '<div class="form-field"><label for="su-email">E-post</label><input id="su-email" type="email" name="email" required autocomplete="email"></div>' +
          '<div class="form-field"><label for="su-password">Passord</label><input id="su-password" type="password" name="password" required minlength="6" autocomplete="new-password"></div>' +
          '<button type="submit" class="btn btn-primary btn-block">Opprett konto</button>' +
          '<p class="auth-terms">Ved å opprette konto godtar du <a href="vilkar.html" target="_blank" rel="noopener">vilkårene</a> og <a href="personvern.html" target="_blank" rel="noopener">personvernerklæringen</a>.</p>' +
        '</form>' +
        '<p class="auth-switch">Har du allerede en konto? <a id="toLogin">Logg inn</a></p>' +
      '</div></div>';

    document.getElementById('toLogin').addEventListener('click', function () { setPhase('login'); });
    document.getElementById('signupForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var name = (fd.get('name') || '').toString().trim();
      var email = (fd.get('email') || '').toString().trim();
      var password = (fd.get('password') || '').toString();
      if (!name || !email || password.length < 6) {
        renderSignup('Fyll ut alle felt. Passord må ha minst 6 tegn.');
        return;
      }
      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true; submitBtn.textContent = 'Oppretter konto…';
      var res = await sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name } }
      });
      if (res.error) {
        renderSignup(res.error.message);
        return;
      }
      if (!res.data.session) {
        // E-postbekreftelse er påslått i Supabase-prosjektet — bruker må bekrefte før innlogging fungerer.
        viewWrap.innerHTML = '<div class="auth-wrap"><div class="auth-card">' +
          '<h1>Sjekk e-posten din</h1>' +
          '<p class="lp-lede">Vi har sendt en bekreftelseslenke til ' + escapeHtml(email) + '. Klikk på lenken for å aktivere kontoen, og logg deretter inn.</p>' +
          '<p class="auth-switch"><a id="toLoginConfirm">Til innlogging</a></p>' +
        '</div></div>';
        document.getElementById('toLoginConfirm').addEventListener('click', function () { setPhase('login'); });
        return;
      }
      await afterAuthSuccess();
    });
  }

  /* ================================================================
     PAYWALL
     ================================================================ */

  function renderPaywall() {
    viewWrap.innerHTML =
      '<div class="paywall-wrap">' +
        '<div class="paywall-lock">' + iconLock() + '</div>' +
        '<h1>Fullfør abonnementet for å låse opp EiendomsLogga</h1>' +
        '<p class="lp-lede">Hei ' + escapeHtml(currentUser ? currentUser.name : '') + '! Kontoen din er opprettet. Aktiver abonnementet for å få tilgang til boliger, logg, vedlikehold og inspeksjoner.</p>' +
        pricingCardReplace() +
      '</div>';

    document.getElementById('activateSub').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Sender deg til betaling…';
      var res = await sb.functions.invoke('create-checkout-session');
      if (res.error || !res.data || !res.data.url) {
        showToast('Klarte ikke å starte betaling. Prøv igjen.', 'danger');
        btn.disabled = false; btn.textContent = 'Gå til betaling';
        return;
      }
      window.location.href = res.data.url;
    });
  }

  function pricingCardReplace() {
    return '<div class="pricing-wrap"><div class="pricing-card">' +
      '<span class="pricing-badge">ABONNEMENT</span>' +
      '<p class="pricing-price">499 kr<span> / måned</span></p>' +
      '<p class="pricing-sub">Ubegrenset antall boliger. Avslutt når du vil.</p>' +
      '<ul class="pricing-features">' +
        '<li>Ubegrenset feilregistrering og logg</li>' +
        '<li>Bilder, dokumenter og kvitteringer</li>' +
        '<li>Digitale inspeksjoner med signatur</li>' +
        '<li>Rapporter du kan skrive ut eller lagre som PDF</li>' +
        '<li>Vedlikeholdsplan med gjentakende oppgaver</li>' +
      '</ul>' +
      '<button class="btn btn-primary btn-block" id="activateSub">Gå til betaling</button>' +
      '<p class="demo-note">Du sendes til Stripes sikre betalingsside. Kortopplysninger lagres aldri hos oss.</p>' +
    '</div></div>';
  }

  /* ================================================================
     RENDER: router
     ================================================================ */

  function render() {
    if (state.view === 'dashboard') return renderDashboard();
    if (state.view === 'properties') return renderProperties();
    if (state.view === 'property-detail') return renderPropertyDetail();
    if (state.view === 'log') return renderLog();
    if (state.view === 'maintenance') return renderMaintenance();
    if (state.view === 'inspection') return renderInspection();
    if (state.view === 'reports') return renderReports();
    if (state.view === 'report-detail') return renderReportDetail();
  }

  /* ---------------- Dashboard ---------------- */

  function renderDashboard() {
    var properties = Properties.all();
    var entries = Entries.all();
    var openIssues = entries.filter(function (e) { return e.type === 'feil' && e.status !== 'løst'; });
    var thisMonth = todayISO().slice(0, 7);
    var maintDue = Maintenance.all().filter(function (m) { return m.status !== 'utført' && m.dueDate.slice(0, 7) <= thisMonth; });
    var inspections = Inspections.all();

    if (properties.length === 0) {
      viewWrap.innerHTML =
        '<div class="view-head"><div><h1>Oversikt</h1><p>Registrer boliger for å komme i gang med logg, vedlikehold og inspeksjoner.</p></div></div>' +
        '<div class="empty-state">' +
          '<p class="empty-title">Ingen boliger registrert ennå</p>' +
          '<p class="empty-body">Legg til den første boligen din, eller last inn eksempeldata for å se hvordan EiendomsLogga fungerer.</p>' +
          '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">' +
            '<button class="btn btn-primary" data-action="add-property">+ Registrer bolig</button>' +
            '<button class="btn btn-ghost" data-action="seed-demo">Last inn eksempeldata</button>' +
          '</div>' +
        '</div>';
      bindDashboardActions();
      return;
    }

    var recent = entries.slice(0, 6);

    var html = '';
    html += '<div class="view-head"><div><h1>Oversikt</h1><p>Status for alle boligene dine, samlet ett sted.</p></div>' +
      '<div class="view-actions"><button class="btn btn-primary" data-action="add-property">+ Ny bolig</button></div></div>';

    html += onboardingChecklistHtml(properties, entries, Maintenance.all(), inspections);

    html += '<div class="stat-grid">' +
      statCard('BOLIGER', properties.length, '') +
      statCard('ÅPNE FEIL', openIssues.length, openIssues.length ? 'stamp-color' : 'sage-color') +
      statCard('VEDLIKEHOLD SNART', maintDue.length, maintDue.length ? 'amber-color' : 'sage-color') +
      statCard('INSPEKSJONER', inspections.length, '') +
      '</div>';

    html += attentionPanelHtml();

    html += '<p class="section-title">SISTE HENDELSER</p>';
    if (recent.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen hendelser registrert</p><p class="empty-body">Feil, vedlikehold og dokumenter du legger inn dukker opp her.</p></div>';
    } else {
      html += '<div class="card" style="padding:8px 12px;"><table class="data-table"><thead><tr><th>Dato</th><th>Bolig</th><th>Type</th><th>Tittel</th><th>Status</th></tr></thead><tbody>';
      recent.forEach(function (e) {
        var prop = Properties.get(e.propertyId);
        html += '<tr>' +
          '<td class="num">' + formatDateNO(e.date) + '</td>' +
          '<td>' + escapeHtml(prop ? prop.name : '—') + '</td>' +
          '<td><span class="type-tag">' + typeLabel(e.type) + '</span></td>' +
          '<td>' + escapeHtml(e.title) + '</td>' +
          '<td>' + statusBadge(e.status) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    viewWrap.innerHTML = html;
    bindDashboardActions();
    bindAttentionActions();
  }

  /* ---- Krever oppmerksomhet: forfalt/kommende vedlikehold og åpne feil ---- */

  function attentionItems() {
    var today = todayISO();
    var items = [];
    Maintenance.all().forEach(function (m) {
      if (m.status === 'utført') return;
      var prop = Properties.get(m.propertyId);
      var diff = daysBetween(today, m.dueDate); // negativ = forfalt
      if (diff < 0) {
        items.push({ rank: 0, sort: diff, tone: 'late', label: 'Forfalt', text: m.title, where: prop ? prop.name : '', meta: daysLabel(diff) + ' siden', go: 'maintenance' });
      } else if (diff <= 30) {
        items.push({ rank: 2, sort: diff, tone: 'soon', label: 'Forfaller snart', text: m.title, where: prop ? prop.name : '', meta: diff === 0 ? 'i dag' : 'om ' + daysLabel(diff), go: 'maintenance' });
      }
    });
    Entries.all().forEach(function (e) {
      if (e.type !== 'feil' || e.status === 'løst') return;
      var prop = Properties.get(e.propertyId);
      var age = Math.max(0, daysBetween(e.date, today));
      items.push({ rank: 1, sort: -age, tone: 'late', label: 'Åpen feil', text: e.title, where: prop ? prop.name : '', meta: 'åpen i ' + daysLabel(age), go: 'property', propertyId: e.propertyId });
    });
    items.sort(function (a, b) { return a.rank - b.rank || a.sort - b.sort; });
    return items;
  }

  function attentionPanelHtml() {
    var items = attentionItems();
    var html = '<p class="section-title">KREVER OPPMERKSOMHET</p>';
    if (items.length === 0) {
      return html + '<div class="card attention-ok"><span class="attention-check">✓</span><div><p class="entry-row-title">Alt er i orden</p><p class="entry-row-desc">Ingen forfalt vedlikehold, ingenting som forfaller de neste 30 dagene, og ingen åpne feil.</p></div></div>';
    }
    var max = 6;
    html += '<div class="card attention-list">';
    items.slice(0, max).forEach(function (it, i) {
      html += '<button type="button" class="attention-row" data-attention="' + i + '">' +
        '<span class="attention-dot ' + it.tone + '"></span>' +
        '<span class="attention-main"><span class="attention-label">' + escapeHtml(it.label) + '</span><span class="attention-text">' + escapeHtml(it.text) + '</span></span>' +
        '<span class="attention-meta">' + (it.where ? escapeHtml(it.where) + ' · ' : '') + escapeHtml(it.meta) + '</span>' +
      '</button>';
    });
    if (items.length > max) html += '<p class="attention-more">+ ' + (items.length - max) + ' til. Se Vedlikehold og Logg for alt.</p>';
    html += '</div>';
    attentionCache = items.slice(0, max);
    return html;
  }

  var attentionCache = [];

  function bindAttentionActions() {
    viewWrap.querySelectorAll('[data-attention]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var it = attentionCache[Number(btn.dataset.attention)];
        if (!it) return;
        if (it.go === 'property' && it.propertyId) setView('property-detail', { propertyId: it.propertyId });
        else setView('maintenance');
      });
    });
  }

  /* ---- Kom i gang-sjekkliste (forsvinner når alt er gjort) ---- */

  function onboardingChecklistHtml(properties, entries, maint, inspections) {
    var steps = [
      { done: properties.length > 0, label: 'Registrer en bolig', hint: 'Adresse, rom og leietaker.', action: 'add-property', btn: '+ Ny bolig' },
      { done: entries.length > 0, label: 'Loggfør en hendelse', hint: 'En feil, en kvittering eller et dokument, gjerne med bilde.', action: 'add-entry', btn: '+ Ny hendelse' },
      { done: maint.length > 0, label: 'Planlegg vedlikehold', hint: 'F.eks. røykvarsler eller takrenner, med gjentakelse.', action: 'add-maintenance', btn: 'Planlegg' },
      { done: inspections.length > 0, label: 'Gjennomfør en inspeksjon', hint: 'Inn- eller utflytting med signatur fra begge parter.', action: 'start-inspection', btn: 'Start' }
    ];
    var doneCount = steps.filter(function (st) { return st.done; }).length;
    if (doneCount === steps.length) return '';
    var html = '<div class="card onboarding"><div class="onboarding-head"><p class="section-title" style="margin:0;">KOM I GANG</p><span class="mono onboarding-count">' + doneCount + ' / ' + steps.length + '</span></div>' +
      '<div class="onboarding-bar"><span style="width:' + Math.round(doneCount / steps.length * 100) + '%"></span></div><ul class="onboarding-steps">';
    steps.forEach(function (st) {
      html += '<li class="' + (st.done ? 'done' : '') + '"><span class="onboarding-tick">' + (st.done ? '✓' : '') + '</span>' +
        '<span class="onboarding-text"><b>' + st.label + '</b><small>' + st.hint + '</small></span>' +
        (st.done ? '' : '<button type="button" class="btn btn-ghost btn-small" data-onboard="' + st.action + '">' + st.btn + '</button>') + '</li>';
    });
    html += '</ul></div>';
    return html;
  }

  function statCard(label, value, colorClass) {
    return '<div class="stat-card"><p class="stat-label">' + label + '</p><p class="stat-value ' + colorClass + '">' + value + '</p></div>';
  }

  function typeLabel(type) {
    if (type === 'feil') return 'Feil';
    if (type === 'vedlikehold') return 'Vedlikehold';
    if (type === 'dokument') return 'Dokument';
    return type;
  }

  function statusBadge(status) {
    if (status === 'løst' || status === 'utført') return '<span class="badge badge-done">' + escapeHtml(status) + '</span>';
    if (status === 'pågår') return '<span class="badge badge-progress">pågår</span>';
    if (status === 'åpen' || status === 'planlagt') return '<span class="badge badge-open">' + escapeHtml(status) + '</span>';
    return '<span class="badge badge-neutral">' + escapeHtml(status || '—') + '</span>';
  }

  function bindDashboardActions() {
    viewWrap.querySelectorAll('[data-onboard]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.dataset.onboard;
        if (a === 'add-property') openPropertyForm();
        else if (a === 'add-entry') openEntryForm({});
        else if (a === 'add-maintenance') openMaintenanceForm({});
        else if (a === 'start-inspection') { setView('inspection'); startInspectionWizard(); }
      });
    });
    var addBtn = viewWrap.querySelector('[data-action="add-property"]');
    if (addBtn) addBtn.addEventListener('click', function () { openPropertyForm(); });
    var seedBtn = viewWrap.querySelector('[data-action="seed-demo"]');
    if (seedBtn) seedBtn.addEventListener('click', seedDemoData);
  }

  /* ---------------- Properties list ---------------- */

  function renderProperties() {
    var properties = Properties.all();
    var html = '<div class="view-head"><div><h1>Boliger</h1><p>Oversikt over alle boligene du forvalter.</p></div>' +
      '<div class="view-actions"><button class="btn btn-primary" data-action="add-property">+ Ny bolig</button></div></div>';

    if (properties.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen boliger ennå</p><p class="empty-body">Registrer den første boligen for å starte loggen.</p>' +
        '<button class="btn btn-primary" data-action="add-property">+ Registrer bolig</button></div>';
      viewWrap.innerHTML = html;
      bindDashboardActions();
      return;
    }

    html += '<div class="property-grid">';
    properties.forEach(function (p) {
      var openCount = Entries.forProperty(p.id).filter(function (e) { return e.type === 'feil' && e.status !== 'løst'; }).length;
      html += '<button class="property-card" data-action="open-property" data-id="' + p.id + '">' +
        '<h3>' + escapeHtml(p.name) + '</h3>' +
        '<p class="property-address">' + escapeHtml(p.address || '') + (p.rooms ? ' · ' + escapeHtml(p.rooms) + ' rom' : '') + '</p>' +
        '<div class="property-meta-row">' +
          '<span class="property-tenant">' + (p.tenantName ? 'Leietaker: ' + escapeHtml(p.tenantName) : 'Ingen leietaker registrert') + '</span>' +
          '<span class="property-open-count ' + (openCount ? 'stamp-color' : 'sage-color') + '" style="color:' + (openCount ? 'var(--stamp)' : 'var(--sage)') + '">' + openCount + ' åpen</span>' +
        '</div>' +
      '</button>';
    });
    html += '</div>';

    viewWrap.innerHTML = html;
    bindDashboardActions();
    viewWrap.querySelectorAll('[data-action="open-property"]').forEach(function (btn) {
      btn.addEventListener('click', function () { setView('property-detail', { propertyId: btn.dataset.id }); });
    });
  }

  /* ---------------- Property detail ---------------- */

  function renderPropertyDetail() {
    var p = Properties.get(state.selectedPropertyId);
    if (!p) { setView('properties'); return; }

    var entries = Entries.forProperty(p.id);
    var maint = Maintenance.forProperty(p.id);
    var inspections = Inspections.forProperty(p.id);
    var openCount = entries.filter(function (e) { return e.type === 'feil' && e.status !== 'løst'; }).length;

    var html = '<button class="detail-back" data-action="back-to-properties">&larr; Alle boliger</button>';
    html += '<div class="view-head"><div><h1>' + escapeHtml(p.name) + '</h1>' +
      '<p>' + escapeHtml(p.address || 'Ingen adresse registrert') + (p.rooms ? ' · ' + escapeHtml(p.rooms) + ' rom' : '') +
      (p.tenantName ? ' · Leietaker: ' + escapeHtml(p.tenantName) : '') + '</p></div>' +
      '<div class="view-actions">' +
        '<button class="btn btn-ghost btn-small" data-action="edit-property">Rediger bolig</button>' +
        '<button class="btn btn-danger btn-small" data-action="delete-property">Slett bolig</button>' +
      '</div></div>';

    html += '<div class="stat-grid">' +
      statCard('ÅPNE FEIL', openCount, openCount ? 'stamp-color' : 'sage-color') +
      statCard('VEDLIKEHOLD', maint.filter(function (m) { return m.status !== 'utført'; }).length, '') +
      statCard('INSPEKSJONER', inspections.length, '') +
      statCard('HENDELSER TOTALT', entries.length, '') +
      '</div>';

    html += '<div class="detail-quick-actions">' +
      '<button class="btn btn-secondary btn-small" data-action="quick-feil">+ Registrer feil</button>' +
      '<button class="btn btn-ghost btn-small" data-action="quick-dokument">+ Legg til dokument</button>' +
      '<button class="btn btn-ghost btn-small" data-action="quick-vedlikehold">+ Planlegg vedlikehold</button>' +
      '<button class="btn btn-ghost btn-small" data-action="quick-inspeksjon">+ Start inspeksjon</button>' +
    '</div>';

    html += '<div class="section-title-row"><p class="section-title" style="margin:0;">HISTORIKK FOR BOLIGEN</p>' +
      (entries.length ? '<button class="btn btn-ghost btn-small no-print" data-action="print-history">Skriv ut / lagre som PDF</button>' : '') + '</div>';
    if (entries.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen hendelser registrert</p><p class="empty-body">Feil, vedlikehold og dokumenter for denne boligen vises her.</p></div>';
    } else {
      html += '<div id="printArea" class="history-print">' +
        '<div class="print-only history-print-head"><p class="doc-eyebrow">EIENDOMSLOGGA · HISTORIKK</p><h2>' + escapeHtml(p.name) + '</h2>' +
        '<p>' + escapeHtml(p.address || '') + (p.tenantName ? ' · Leietaker: ' + escapeHtml(p.tenantName) : '') + ' · Utskrift ' + formatDateNO(todayISO()) + '</p></div>' +
        '<div class="card">';
      entries.forEach(function (e) {
        html += timelineItem(e);
      });
      html += '</div></div>';
    }

    viewWrap.innerHTML = html;

    viewWrap.querySelector('[data-action="back-to-properties"]').addEventListener('click', function () { setView('properties'); });
    viewWrap.querySelector('[data-action="edit-property"]').addEventListener('click', function () { openPropertyForm(p); });
    viewWrap.querySelector('[data-action="delete-property"]').addEventListener('click', function () { confirmDeleteProperty(p); });
    var printHistoryBtn = viewWrap.querySelector('[data-action="print-history"]');
    if (printHistoryBtn) printHistoryBtn.addEventListener('click', function () { window.print(); });
    viewWrap.querySelector('[data-action="quick-feil"]').addEventListener('click', function () { openEntryForm({ propertyId: p.id, type: 'feil' }); });
    viewWrap.querySelector('[data-action="quick-dokument"]').addEventListener('click', function () { openEntryForm({ propertyId: p.id, type: 'dokument' }); });
    viewWrap.querySelector('[data-action="quick-vedlikehold"]').addEventListener('click', function () { openMaintenanceForm({ propertyId: p.id }); });
    viewWrap.querySelector('[data-action="quick-inspeksjon"]').addEventListener('click', function () { startInspectionWizard(p.id); });

    bindTimelineActions();
  }

  function timelineItem(e, showProperty) {
    var propPrefix = '';
    if (showProperty) {
      var tp = Properties.get(e.propertyId);
      propPrefix = escapeHtml(tp ? tp.name : '—') + ' · ';
    }
    var html = '<div class="timeline-item" data-entry-id="' + e.id + '">' +
      '<div class="timeline-date mono">' + formatDateNO(e.date) + '</div>' +
      '<div class="timeline-body">' +
        '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">' +
          '<div><span class="type-tag">' + propPrefix + typeLabel(e.type) + '</span><p class="entry-row-title">' + escapeHtml(e.title) + '</p></div>' +
          '<div style="display:flex; align-items:center; gap:8px;">' + statusBadge(e.status) + '</div>' +
        '</div>' +
        (e.description ? '<p class="entry-row-desc">' + escapeHtml(e.description) + '</p>' : '') +
        (e.cost ? '<p class="entry-row-desc mono">Kostnad: ' + money(e.cost) + '</p>' : '');

    if (e.photos && e.photos.length) {
      html += '<div class="thumb-strip">';
      e.photos.forEach(function (ph) {
        html += '<img class="thumb" src="' + ph.url + '" alt="Bilde: ' + escapeHtml(ph.name) + '" data-action="view-photo">';
      });
      html += '</div>';
    }
    if (e.documents && e.documents.length) {
      e.documents.forEach(function (doc) {
        html += '<a class="doc-chip" href="' + doc.url + '" target="_blank" rel="noopener">' + escapeHtml(doc.name) + '</a>';
      });
    }

    html += '<div class="row-actions" style="margin-top:10px;">';
    if (e.type === 'feil') {
      if (e.status !== 'løst') {
        html += '<button class="btn btn-ghost btn-small" data-action="mark-resolved" data-id="' + e.id + '">Marker som løst</button>';
      } else {
        html += '<button class="btn btn-ghost btn-small" data-action="mark-unresolved" data-id="' + e.id + '">Gjenåpne</button>';
      }
    }
    html += '<button class="btn btn-ghost btn-small" data-action="edit-entry" data-id="' + e.id + '">Rediger</button>';
    html += '<button class="btn btn-ghost btn-small" data-action="delete-entry" data-id="' + e.id + '">Slett</button>';
    html += '</div>';

    html += '</div></div>';
    return html;
  }

  function bindTimelineActions() {
    viewWrap.querySelectorAll('[data-action="mark-resolved"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
          await Entries.update(btn.dataset.id, { status: 'løst' });
          showToast('Merket som løst.');
          render();
        } catch (err) { btn.disabled = false; }
      });
    });
    viewWrap.querySelectorAll('[data-action="mark-unresolved"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
          await Entries.update(btn.dataset.id, { status: 'åpen' });
          showToast('Gjenåpnet.');
          render();
        } catch (err) { btn.disabled = false; }
      });
    });
    viewWrap.querySelectorAll('[data-action="edit-entry"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var entry = Entries.get(btn.dataset.id);
        if (entry) openEntryForm({ existing: entry });
      });
    });
    viewWrap.querySelectorAll('[data-action="delete-entry"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (confirm('Slette denne hendelsen? Dette kan ikke angres.')) {
          try {
            await Entries.remove(btn.dataset.id);
            showToast('Hendelse slettet.');
            render();
          } catch (err) { /* toast already shown */ }
        }
      });
    });
    viewWrap.querySelectorAll('[data-action="view-photo"]').forEach(function (img) {
      img.addEventListener('click', function () { window.open(img.src, '_blank'); });
    });
  }

  function confirmDeleteProperty(p) {
    if (confirm('Slette "' + p.name + '"? All logg, vedlikehold og inspeksjoner for boligen slettes samtidig.')) {
      Properties.remove(p.id).then(function () {
        showToast('Bolig slettet.');
        setView('properties');
      }).catch(function () { /* toast already shown */ });
    }
  }

  /* ---------------- Property form ---------------- */

  function openPropertyForm(existing) {
    var isEdit = !!existing;
    var p = existing || {};
    var html =
      '<div class="modal-head"><h2>' + (isEdit ? 'Rediger bolig' : 'Registrer ny bolig') + '</h2>' +
        '<button class="modal-close" data-action="close-modal" aria-label="Lukk">&times;</button></div>' +
      '<form id="propertyForm">' +
        '<div class="form-field"><label for="pf-name">Navn på bolig</label>' +
          '<input id="pf-name" name="name" placeholder="H0304 — Storgata 12" value="' + escapeHtml(p.name || '') + '" required></div>' +
        '<div class="form-field"><label for="pf-address">Adresse</label>' +
          '<input id="pf-address" name="address" placeholder="Storgata 12, 4611 Kristiansand" value="' + escapeHtml(p.address || '') + '"></div>' +
        '<div class="form-grid">' +
          '<div class="form-field"><label for="pf-rooms">Antall rom</label>' +
            '<input id="pf-rooms" name="rooms" type="number" min="0" value="' + escapeHtml(p.rooms || '') + '"></div>' +
          '<div class="form-field"><label for="pf-tenant">Leietaker</label>' +
            '<input id="pf-tenant" name="tenantName" placeholder="Navn (valgfritt)" value="' + escapeHtml(p.tenantName || '') + '"></div>' +
        '</div>' +
        '<div class="form-actions">' +
          (isEdit ? '<button type="button" class="btn btn-ghost" data-action="close-modal">Avbryt</button>' : '<button type="button" class="btn btn-ghost" data-action="close-modal">Avbryt</button>') +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? 'Lagre endringer' : 'Registrer bolig') + '</button>' +
        '</div>' +
      '</form>';
    openModal(html);
    modalEl.querySelector('[data-action="close-modal"]').addEventListener('click', closeModal);
    modalEl.querySelectorAll('[data-action="close-modal"]').forEach(function (b) { b.addEventListener('click', closeModal); });

    modalEl.querySelector('#propertyForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var name = (fd.get('name') || '').toString().trim();
      if (!name) { showToast('Navn på boligen må fylles ut.', 'danger'); return; }
      var payload = {
        name: name,
        address: (fd.get('address') || '').toString().trim(),
        rooms: (fd.get('rooms') || '').toString().trim(),
        tenantName: (fd.get('tenantName') || '').toString().trim()
      };
      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true; submitBtn.textContent = 'Lagrer…';
      try {
        if (isEdit) {
          await Properties.update(p.id, payload);
          showToast('Bolig oppdatert.');
          closeModal();
          render();
        } else {
          var created = await Properties.add(payload);
          showToast('Bolig registrert.');
          closeModal();
          setView('property-detail', { propertyId: created.id });
        }
      } catch (err) {
        submitBtn.disabled = false; submitBtn.textContent = isEdit ? 'Lagre endringer' : 'Registrer bolig';
      }
    });
  }

  /* ---------------- Log entry form (feil / vedlikehold / dokument) ---------------- */

  var pendingPhotos = [];
  var pendingDocs = [];

  // Ny hendelse:  openEntryForm({}) eller openEntryForm({ propertyId, type })
  // Rediger:      openEntryForm({ existing: <hendelse> })
  function openEntryForm(defaults) {
    defaults = defaults || {};
    var existing = defaults.existing || null;
    var isEdit = !!existing;
    var x = existing || {};
    pendingPhotos = [];
    pendingDocs = [];
    var keptPhotos = isEdit ? (x.photos || []).slice() : [];
    var keptDocs = isEdit ? (x.documents || []).slice() : [];
    if (isEdit) defaults = { propertyId: x.propertyId, type: x.type };
    var properties = Properties.all();

    if (properties.length === 0) {
      showToast('Registrer en bolig først.', 'danger');
      openPropertyForm();
      return;
    }

    var propertyOptions = properties.map(function (p) {
      var selected = p.id === defaults.propertyId ? ' selected' : '';
      return '<option value="' + p.id + '"' + selected + '>' + escapeHtml(p.name) + '</option>';
    }).join('');

    var type = defaults.type || 'feil';

    var html =
      '<div class="modal-head"><h2>' + (isEdit ? 'Rediger hendelse' : 'Ny hendelse') + '</h2><button class="modal-close" data-action="close-modal" aria-label="Lukk">&times;</button></div>' +
      '<form id="entryForm">' +
        '<div class="form-grid">' +
          '<div class="form-field"><label for="ef-property">Bolig</label>' +
            '<select id="ef-property" name="propertyId">' + propertyOptions + '</select></div>' +
          '<div class="form-field"><label for="ef-type">Type</label>' +
            '<select id="ef-type" name="type">' +
              '<option value="feil"' + (type === 'feil' ? ' selected' : '') + '>Feil</option>' +
              '<option value="vedlikehold"' + (type === 'vedlikehold' ? ' selected' : '') + '>Vedlikehold utført</option>' +
              '<option value="dokument"' + (type === 'dokument' ? ' selected' : '') + '>Dokument / kvittering</option>' +
            '</select></div>' +
        '</div>' +
        '<div class="form-field"><label for="ef-title">Tittel</label>' +
          '<input id="ef-title" name="title" value="' + escapeHtml(x.title || '') + '" placeholder="F.eks. Vannlekkasje under kjøkkenvask" required></div>' +
        '<div class="form-field"><label for="ef-desc">Beskrivelse</label>' +
          '<textarea id="ef-desc" name="description" placeholder="Hva gjelder saken? Hva er gjort eller må gjøres?">' + escapeHtml(x.description || '') + '</textarea></div>' +
        '<div class="form-grid">' +
          '<div class="form-field"><label for="ef-date">Dato</label>' +
            '<input id="ef-date" name="date" type="date" value="' + escapeHtml(x.date || todayISO()) + '"></div>' +
          '<div class="form-field"><label for="ef-cost">Kostnad (valgfritt)</label>' +
            '<input id="ef-cost" name="cost" type="number" min="0" value="' + (x.cost ? escapeHtml(String(x.cost)) : '') + '" placeholder="kr"></div>' +
        '</div>' +
        '<div class="form-field"><label for="ef-status">Status</label>' +
          '<select id="ef-status" name="status">' +
            '<option value="åpen"' + (x.status === 'åpen' ? ' selected' : '') + '>Åpen</option>' +
            '<option value="pågår"' + (x.status === 'pågår' ? ' selected' : '') + '>Pågår</option>' +
            '<option value="løst"' + (x.status === 'løst' ? ' selected' : '') + '>Løst</option>' +
          '</select></div>' +
        '<div class="form-field"><label>Bilder</label>' +
          '<label class="file-drop" for="ef-photos">Klikk for å laste opp bilder<input id="ef-photos" type="file" accept="image/*" multiple></label>' +
          '<div class="thumb-strip" id="ef-photo-preview"></div>' +
        '</div>' +
        '<div class="form-field"><label>Dokumenter / kvitteringer</label>' +
          '<label class="file-drop" for="ef-docs">Klikk for å laste opp filer<input id="ef-docs" type="file" multiple></label>' +
          '<div id="ef-doc-preview"></div>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-ghost" data-action="close-modal">Avbryt</button>' +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? 'Lagre endringer' : 'Lagre hendelse') + '</button>' +
        '</div>' +
      '</form>';

    openModal(html);
    modalEl.querySelectorAll('[data-action="close-modal"]').forEach(function (b) { b.addEventListener('click', closeModal); });

    modalEl.querySelector('#ef-photos').addEventListener('change', function (e) {
      Array.prototype.forEach.call(e.target.files, function (file) {
        if (file.type.indexOf('image') !== 0) return;
        pendingPhotos.push({ file: file, name: file.name, previewUrl: URL.createObjectURL(file) });
      });
      renderPhotoPreview();
      e.target.value = '';
    });
    modalEl.querySelector('#ef-docs').addEventListener('change', function (e) {
      Array.prototype.forEach.call(e.target.files, function (file) {
        pendingDocs.push({ file: file, name: file.name });
      });
      renderDocPreview();
      e.target.value = '';
    });

    function renderPhotoPreview() {
      var el = modalEl.querySelector('#ef-photo-preview');
      if (!el) return;
      el.innerHTML = keptPhotos.map(function (p, i) {
        return '<span class="thumb-wrap"><img class="thumb" src="' + escapeHtml(p.url) + '" alt="' + escapeHtml(p.name) + '">' +
          '<button type="button" class="thumb-remove" data-action="remove-kept-photo" data-idx="' + i + '" aria-label="Fjern bilde">&times;</button></span>';
      }).join('') + pendingPhotos.map(function (p, i) {
        return '<span class="thumb-wrap"><img class="thumb" src="' + p.previewUrl + '" alt="' + escapeHtml(p.name) + '">' +
          '<button type="button" class="thumb-remove" data-action="remove-photo" data-idx="' + i + '" aria-label="Fjern bilde">&times;</button></span>';
      }).join('');
      el.querySelectorAll('[data-action="remove-photo"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          pendingPhotos.splice(Number(btn.dataset.idx), 1);
          renderPhotoPreview();
        });
      });
      el.querySelectorAll('[data-action="remove-kept-photo"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          keptPhotos.splice(Number(btn.dataset.idx), 1);
          renderPhotoPreview();
        });
      });
    }
    function renderDocPreview() {
      var el = modalEl.querySelector('#ef-doc-preview');
      if (!el) return;
      el.innerHTML = keptDocs.map(function (d, i) {
        return '<span class="doc-chip">' + escapeHtml(d.name) +
          '<button type="button" class="doc-chip-remove" data-action="remove-kept-doc" data-idx="' + i + '" aria-label="Fjern dokument">&times;</button></span>';
      }).join('') + pendingDocs.map(function (d, i) {
        return '<span class="doc-chip">' + escapeHtml(d.name) +
          '<button type="button" class="doc-chip-remove" data-action="remove-doc" data-idx="' + i + '" aria-label="Fjern dokument">&times;</button></span>';
      }).join('');
      el.querySelectorAll('[data-action="remove-doc"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          pendingDocs.splice(Number(btn.dataset.idx), 1);
          renderDocPreview();
        });
      });
      el.querySelectorAll('[data-action="remove-kept-doc"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          keptDocs.splice(Number(btn.dataset.idx), 1);
          renderDocPreview();
        });
      });
    }
    renderPhotoPreview();
    renderDocPreview();

    modalEl.querySelector('#entryForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var title = (fd.get('title') || '').toString().trim();
      if (!title) { showToast('Tittel må fylles ut.', 'danger'); return; }
      var propertyId = fd.get('propertyId');
      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true; submitBtn.textContent = 'Laster opp…';
      try {
        var uploadedPhotos = await uploadFiles('photos', pendingPhotos, propertyId);
        var uploadedDocs = await uploadFiles('documents', pendingDocs, propertyId);
        var payload = {
          propertyId: propertyId,
          type: fd.get('type'),
          title: title,
          description: (fd.get('description') || '').toString().trim(),
          date: fd.get('date') || todayISO(),
          cost: fd.get('cost') ? Number(fd.get('cost')) : 0,
          status: fd.get('status'),
          photos: keptPhotos.concat(uploadedPhotos),
          documents: keptDocs.concat(uploadedDocs)
        };
        if (isEdit) {
          await Entries.update(x.id, payload);
          showToast('Hendelse oppdatert.');
        } else {
          await Entries.add(payload);
          showToast('Hendelse lagret.');
        }
        closeModal();
        render();
      } catch (err) {
        submitBtn.disabled = false; submitBtn.textContent = isEdit ? 'Lagre endringer' : 'Lagre hendelse';
      }
    });
  }

  /* ---------------- Log view (all entries) ---------------- */

  function filteredLogEntries() {
    var f = state.logFilter;
    var q = (f.q || '').trim().toLowerCase();
    return Entries.all().filter(function (e) {
      if (f.propertyId && e.propertyId !== f.propertyId) return false;
      if (f.type && e.type !== f.type) return false;
      if (f.status && e.status !== f.status) return false;
      if (f.year && String(e.date || '').slice(0, 4) !== f.year) return false;
      if (q) {
        var prop = Properties.get(e.propertyId);
        var hay = ((e.title || '') + ' ' + (e.description || '') + ' ' + (prop ? prop.name : '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function csvCell(v) {
    if (typeof v === 'number') return String(v);
    var t = String(v === undefined || v === null ? '' : v);
    // Tekst som starter med = + - @ kan tolkes som formel i Excel; legg på apostrof.
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }

  // Semikolon-separert med BOM, slik at norsk Excel åpner æøå og kolonner riktig.
  function exportLogCsv(list) {
    var rows = [['Dato', 'Bolig', 'Type', 'Tittel', 'Beskrivelse', 'Status', 'Kostnad (kr)']];
    list.forEach(function (e) {
      var prop = Properties.get(e.propertyId);
      rows.push([e.date, prop ? prop.name : '', typeLabel(e.type), e.title, e.description || '', e.status || '', e.cost ? Number(e.cost) : 0]);
    });
    var csv = '﻿' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'eiendomslogga-logg-' + todayISO() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Loggen er lastet ned som CSV.');
  }

  function renderLog() {
    var properties = Properties.all();
    var html = '<div class="view-head"><div><h1>Logg</h1><p>Alle registrerte hendelser på tvers av boligene dine.</p></div>' +
      '<div class="view-actions"><button class="btn btn-primary" data-action="add-entry">+ Ny hendelse</button></div></div>';

    var propOptions = '<option value="">Alle boliger</option>' + properties.map(function (p) {
      return '<option value="' + p.id + '"' + (state.logFilter.propertyId === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
    }).join('');

    var years = {};
    Entries.all().forEach(function (e) { if (e.date) years[String(e.date).slice(0, 4)] = true; });
    var yearOptions = '<option value="">Alle år</option>' + Object.keys(years).sort().reverse().map(function (y) {
      return '<option value="' + y + '"' + (state.logFilter.year === y ? ' selected' : '') + '>' + y + '</option>';
    }).join('');

    html += '<div class="filter-bar">' +
      '<input type="search" id="filter-q" class="filter-search" placeholder="Søk i logg…" value="' + escapeHtml(state.logFilter.q || '') + '" aria-label="Søk i logg">' +
      '<select id="filter-property">' + propOptions + '</select>' +
      '<select id="filter-type">' +
        '<option value="">Alle typer</option>' +
        '<option value="feil"' + (state.logFilter.type === 'feil' ? ' selected' : '') + '>Feil</option>' +
        '<option value="vedlikehold"' + (state.logFilter.type === 'vedlikehold' ? ' selected' : '') + '>Vedlikehold</option>' +
        '<option value="dokument"' + (state.logFilter.type === 'dokument' ? ' selected' : '') + '>Dokument</option>' +
      '</select>' +
      '<select id="filter-status">' +
        '<option value="">Alle statuser</option>' +
        '<option value="åpen"' + (state.logFilter.status === 'åpen' ? ' selected' : '') + '>Åpen</option>' +
        '<option value="pågår"' + (state.logFilter.status === 'pågår' ? ' selected' : '') + '>Pågår</option>' +
        '<option value="løst"' + (state.logFilter.status === 'løst' ? ' selected' : '') + '>Løst</option>' +
      '</select>' +
      '<select id="filter-year">' + yearOptions + '</select>' +
    '</div>';

    var entries = filteredLogEntries();

    if (properties.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen boliger registrert</p><p class="empty-body">Legg til en bolig for å begynne å loggføre.</p><button class="btn btn-primary" data-action="add-property">+ Registrer bolig</button></div>';
    } else if (entries.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen hendelser funnet</p><p class="empty-body">Prøv å endre filtrene, eller registrer en ny hendelse.</p></div>';
    } else {
      var totalCost = entries.reduce(function (sum, e) { return sum + (Number(e.cost) || 0); }, 0);
      html += '<div class="log-summary"><span><b>' + entries.length + '</b> ' + (entries.length === 1 ? 'hendelse' : 'hendelser') + '</span>' +
        '<span>Kostnader: <b data-role="log-total">' + money(totalCost) + '</b></span>' +
        '<button type="button" class="btn btn-ghost btn-small" data-action="export-log-csv">Last ned som CSV</button></div>';
      html += '<div class="card">';
      entries.forEach(function (e) { html += timelineItem(e, true); });
      html += '</div>';
    }

    viewWrap.innerHTML = html;

    var addBtn = viewWrap.querySelector('[data-action="add-entry"]');
    if (addBtn) addBtn.addEventListener('click', function () { openEntryForm({}); });
    var addPropBtn = viewWrap.querySelector('[data-action="add-property"]');
    if (addPropBtn) addPropBtn.addEventListener('click', function () { openPropertyForm(); });
    var csvBtn = viewWrap.querySelector('[data-action="export-log-csv"]');
    if (csvBtn) csvBtn.addEventListener('click', function () { exportLogCsv(filteredLogEntries()); });

    var fp = viewWrap.querySelector('#filter-property');
    var ft = viewWrap.querySelector('#filter-type');
    var fs = viewWrap.querySelector('#filter-status');
    var fy = viewWrap.querySelector('#filter-year');
    var fq = viewWrap.querySelector('#filter-q');
    if (fp) fp.addEventListener('change', function () { state.logFilter.propertyId = fp.value; render(); });
    if (ft) ft.addEventListener('change', function () { state.logFilter.type = ft.value; render(); });
    if (fs) fs.addEventListener('change', function () { state.logFilter.status = fs.value; render(); });
    if (fy) fy.addEventListener('change', function () { state.logFilter.year = fy.value; render(); });
    if (fq) {
      var qTimer = null;
      fq.addEventListener('input', function () {
        clearTimeout(qTimer);
        qTimer = setTimeout(function () {
          state.logFilter.q = fq.value;
          render();
          var again = viewWrap.querySelector('#filter-q');
          if (again) { again.focus(); try { again.setSelectionRange(again.value.length, again.value.length); } catch (err) {} }
        }, 220);
      });
    }

    bindTimelineActions();
  }

  /* ---------------- Maintenance view ---------------- */

  function renderMaintenance() {
    var properties = Properties.all();
    var tasks = Maintenance.all();
    var html = '<div class="view-head"><div><h1>Vedlikehold</h1><p>Planlagte kontroller og service for boligene dine.</p></div>' +
      '<div class="view-actions"><button class="btn btn-primary" data-action="add-maintenance">+ Planlegg vedlikehold</button></div></div>';

    if (properties.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen boliger registrert</p><p class="empty-body">Legg til en bolig før du planlegger vedlikehold.</p><button class="btn btn-primary" data-action="add-property">+ Registrer bolig</button></div>';
      viewWrap.innerHTML = html;
      bindDashboardActions();
      var mAdd = viewWrap.querySelector('[data-action="add-maintenance"]');
      if (mAdd) mAdd.addEventListener('click', function () { openMaintenanceForm({}); });
      return;
    }

    if (tasks.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen vedlikehold planlagt</p><p class="empty-body">Planlegg service, kontroller eller sesongvedlikehold for en bolig.</p><button class="btn btn-primary" data-action="add-maintenance">+ Planlegg vedlikehold</button></div>';
    } else {
      html += '<div class="card" style="padding:8px 12px;"><table class="data-table"><thead><tr><th>Forfaller</th><th>Bolig</th><th>Oppgave</th><th>Gjentakelse</th><th>Status</th><th></th></tr></thead><tbody>';
      var today = todayISO();
      tasks.forEach(function (m) {
        var prop = Properties.get(m.propertyId);
        var overdue = m.status !== 'utført' && m.dueDate < today;
        html += '<tr>' +
          '<td class="num" style="' + (overdue ? 'color:var(--stamp);' : '') + '">' + formatDateNO(m.dueDate) + (overdue ? ' (forfalt)' : '') + '</td>' +
          '<td>' + escapeHtml(prop ? prop.name : '—') + '</td>' +
          '<td><div class="entry-row-title">' + escapeHtml(m.title) + '</div>' + (m.notes ? '<div class="entry-row-desc">' + escapeHtml(m.notes) + '</div>' : '') + '</td>' +
          '<td class="type-tag">' + escapeHtml(m.recurring || 'Ingen') + '</td>' +
          '<td>' + statusBadge(m.status) + '</td>' +
          '<td class="row-actions">' +
            (m.status !== 'utført' ? '<button class="btn btn-ghost btn-small" data-action="complete-maint" data-id="' + m.id + '">Merk utført</button>' : '') +
            '<button class="btn btn-ghost btn-small" data-action="edit-maint" data-id="' + m.id + '">Rediger</button>' +
            '<button class="btn btn-ghost btn-small" data-action="delete-maint" data-id="' + m.id + '">Slett</button>' +
          '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    viewWrap.innerHTML = html;
    var addBtn = viewWrap.querySelector('[data-action="add-maintenance"]');
    if (addBtn) addBtn.addEventListener('click', function () { openMaintenanceForm({}); });

    viewWrap.querySelectorAll('[data-action="complete-maint"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
          var next = await completeMaintenance(Maintenance.get(btn.dataset.id));
          showToast(next ? 'Utført. Neste er planlagt ' + formatDateNO(next) + '.' : 'Vedlikehold merket som utført.');
          render();
        } catch (err) { btn.disabled = false; }
      });
    });
    viewWrap.querySelectorAll('[data-action="edit-maint"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var task = Maintenance.get(btn.dataset.id);
        if (task) openMaintenanceForm({ existing: task });
      });
    });
    viewWrap.querySelectorAll('[data-action="delete-maint"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (confirm('Slette denne vedlikeholdsoppgaven?')) {
          try {
            await Maintenance.remove(btn.dataset.id);
            showToast('Slettet.');
            render();
          } catch (err) { /* toast already shown */ }
        }
      });
    });
  }

  // Brukes både til å planlegge nytt vedlikehold og til å redigere et eksisterende.
  // Ny:        openMaintenanceForm({}) eller openMaintenanceForm({ propertyId: ... })
  // Rediger:   openMaintenanceForm({ existing: <vedlikeholdsobjekt> })
  function openMaintenanceForm(defaults) {
    defaults = defaults || {};
    var existing = defaults.existing || null;
    var isEdit = !!existing;
    var m = existing || {};
    var properties = Properties.all();
    if (properties.length === 0) { showToast('Registrer en bolig først.', 'danger'); openPropertyForm(); return; }

    var selectedPropertyId = isEdit ? m.propertyId : defaults.propertyId;
    var propertyOptions = properties.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === selectedPropertyId ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
    }).join('');

    var recurValues = ['Ingen', 'Kvartalsvis', 'Halvårlig', 'Årlig'];
    var currentRecur = m.recurring || 'Ingen';
    // Har en eldre oppgave en verdi som ikke finnes i listen, tar vi den med slik at den ikke endres ved et uhell.
    if (recurValues.indexOf(currentRecur) === -1) recurValues.push(currentRecur);
    var recurOptions = recurValues.map(function (r) {
      return '<option value="' + escapeHtml(r) + '"' + (r === currentRecur ? ' selected' : '') + '>' + escapeHtml(r) + '</option>';
    }).join('');

    // Status kan bare endres ved redigering. Da kan en oppgave som ved en feil er merket utført, settes tilbake til planlagt.
    var statusField = isEdit
      ? '<div class="form-field"><label for="mf-status">Status</label><select id="mf-status" name="status">' +
          '<option value="planlagt"' + (m.status !== 'utført' ? ' selected' : '') + '>Planlagt</option>' +
          '<option value="utført"' + (m.status === 'utført' ? ' selected' : '') + '>Utført</option>' +
        '</select></div>'
      : '';

    var html =
      '<div class="modal-head"><h2>' + (isEdit ? 'Rediger vedlikehold' : 'Planlegg vedlikehold') + '</h2><button class="modal-close" data-action="close-modal" aria-label="Lukk">&times;</button></div>' +
      '<form id="maintForm">' +
        '<div class="form-field"><label for="mf-property">Bolig</label><select id="mf-property" name="propertyId">' + propertyOptions + '</select></div>' +
        '<div class="form-field"><label for="mf-title">Oppgave</label><input id="mf-title" name="title" value="' + escapeHtml(m.title || '') + '" placeholder="F.eks. Rens av takrenner" required></div>' +
        '<div class="form-grid">' +
          '<div class="form-field"><label for="mf-date">Forfallsdato</label><input id="mf-date" name="dueDate" type="date" value="' + escapeHtml(m.dueDate || todayISO()) + '"></div>' +
          '<div class="form-field"><label for="mf-recur">Gjentakelse</label><select id="mf-recur" name="recurring">' + recurOptions + '</select></div>' +
        '</div>' +
        statusField +
        '<div class="form-field"><label for="mf-notes">Notat</label><textarea id="mf-notes" name="notes" placeholder="Detaljer om oppgaven">' + escapeHtml(m.notes || '') + '</textarea></div>' +
        '<div class="form-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Avbryt</button><button type="submit" class="btn btn-primary">' + (isEdit ? 'Lagre endringer' : 'Lagre') + '</button></div>' +
      '</form>';
    openModal(html);
    modalEl.querySelectorAll('[data-action="close-modal"]').forEach(function (b) { b.addEventListener('click', closeModal); });
    modalEl.querySelector('#maintForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var title = (fd.get('title') || '').toString().trim();
      if (!title) { showToast('Oppgave må fylles ut.', 'danger'); return; }
      var submitBtn = e.target.querySelector('button[type="submit"]');
      var idleLabel = isEdit ? 'Lagre endringer' : 'Lagre';
      submitBtn.disabled = true; submitBtn.textContent = 'Lagrer…';
      var payload = {
        propertyId: fd.get('propertyId'),
        title: title,
        dueDate: fd.get('dueDate') || m.dueDate || todayISO(),
        recurring: fd.get('recurring'),
        notes: (fd.get('notes') || '').toString().trim()
      };
      try {
        if (isEdit) {
          payload.status = fd.get('status');
          var wasOpen = m.status !== 'utført';
          var nextPlanned = null;
          if (payload.status === 'utført' && wasOpen) {
            // Redigert fra planlagt til utført: lagre feltene først, og planlegg så neste runde hvis oppgaven gjentas.
            payload.status = 'planlagt';
            await Maintenance.update(m.id, payload);
            nextPlanned = await completeMaintenance(Maintenance.get(m.id), payload.recurring);
          } else {
            await Maintenance.update(m.id, payload);
          }
          showToast(nextPlanned ? 'Utført. Neste er planlagt ' + formatDateNO(nextPlanned) + '.' : 'Vedlikehold oppdatert.');
        } else {
          await Maintenance.add(payload);
          showToast('Vedlikehold planlagt.');
        }
        closeModal();
        render();
      } catch (err) {
        submitBtn.disabled = false; submitBtn.textContent = idleLabel;
      }
    });
  }

  /* ---------------- Inspection wizard ---------------- */

  var DEFAULT_ROOMS = ['Stue', 'Kjøkken', 'Bad', 'Soverom', 'Entré'];

  function startInspectionWizard(propertyId) {
    state.wizard = {
      step: 1,
      propertyId: propertyId || '',
      type: 'innflytting',
      tenantName: '',
      date: todayISO(),
      rooms: DEFAULT_ROOMS.map(function (name) { return { name: name, condition: '', notes: '', photos: [] }; }),
      tenantSignature: null,
      landlordSignature: null
    };
    setView('inspection');
  }

  function renderInspection() {
    var properties = Properties.all();
    if (properties.length === 0) {
      viewWrap.innerHTML = '<div class="view-head"><div><h1>Inspeksjon</h1><p>Registrer en bolig før du kan starte en digital inspeksjon.</p></div></div>' +
        '<div class="empty-state"><p class="empty-title">Ingen boliger registrert</p><p class="empty-body">Legg til boligen din først.</p><button class="btn btn-primary" data-action="add-property">+ Registrer bolig</button></div>';
      bindDashboardActions();
      return;
    }
    if (!state.wizard) {
      viewWrap.innerHTML = '<div class="view-head"><div><h1>Inspeksjon</h1><p>Gjennomfør en digital inn- eller utflyttingskontroll med bilder og signatur.</p></div></div>' +
        '<div class="empty-state"><p class="empty-title">Start en ny inspeksjon</p><p class="empty-body">Velg bolig og kom i gang med befaringen.</p>' +
        '<button class="btn btn-primary" data-action="start-inspection">+ Start inspeksjon</button></div>';
      viewWrap.querySelector('[data-action="start-inspection"]').addEventListener('click', function () { startInspectionWizard(); });
      return;
    }

    var w = state.wizard;
    var html = '<div class="view-head"><div><h1>Digital inspeksjon</h1><p>Steg ' + w.step + ' av 3</p></div></div>';
    html += '<div class="wizard-steps">' +
      [1, 2, 3].map(function (n) {
        var cls = n < w.step ? 'done' : (n === w.step ? 'active' : '');
        return '<div class="wizard-step-dot ' + cls + '"></div>';
      }).join('') + '</div>';

    html += '<div class="card">';
    if (w.step === 1) html += wizardStep1(w, properties);
    if (w.step === 2) html += wizardStep2(w);
    if (w.step === 3) html += wizardStep3(w);
    html += '</div>';

    viewWrap.innerHTML = html;
    bindWizardEvents();
  }

  function wizardStep1(w, properties) {
    var propertyOptions = properties.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === w.propertyId ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
    }).join('');
    return '<p class="section-title">STEG 1 — OM INSPEKSJONEN</p>' +
      '<div class="form-grid">' +
        '<div class="form-field"><label for="w-property">Bolig</label><select id="w-property">' + propertyOptions + '</select></div>' +
        '<div class="form-field"><label for="w-type">Type inspeksjon</label><select id="w-type">' +
          '<option value="innflytting"' + (w.type === 'innflytting' ? ' selected' : '') + '>Innflytting</option>' +
          '<option value="utflytting"' + (w.type === 'utflytting' ? ' selected' : '') + '>Utflytting</option>' +
        '</select></div>' +
        '<div class="form-field"><label for="w-tenant">Leietaker</label><input id="w-tenant" value="' + escapeHtml(w.tenantName) + '" placeholder="Navn"></div>' +
        '<div class="form-field"><label for="w-date">Dato</label><input id="w-date" type="date" value="' + w.date + '"></div>' +
      '</div>' +
      '<div class="form-actions"><span></span><button class="btn btn-primary" data-action="wizard-next">Neste: rom &rarr;</button></div>';
  }

  function wizardStep2(w) {
    var html = '<p class="section-title">STEG 2 — GÅ GJENNOM ROMMENE</p>';
    w.rooms.forEach(function (room, idx) {
      html += '<div class="room-block" data-room-idx="' + idx + '">' +
        '<div class="room-block-head"><h4>' + escapeHtml(room.name) + '</h4>' +
          '<button type="button" class="btn btn-ghost btn-icon" data-action="remove-room" data-idx="' + idx + '" aria-label="Fjern rom">&times;</button></div>' +
        '<div class="condition-select-row">' +
          conditionPill(idx, 'god', room.condition, 'God') +
          conditionPill(idx, 'ok', room.condition, 'OK') +
          conditionPill(idx, 'darlig', room.condition, 'Dårlig') +
        '</div>' +
        '<div class="form-field"><textarea data-action="room-notes" data-idx="' + idx + '" placeholder="Notater om tilstand, skader eller merknader">' + escapeHtml(room.notes) + '</textarea></div>' +
        '<label class="file-drop" for="room-photo-' + idx + '">Last opp bilde<input id="room-photo-' + idx + '" type="file" accept="image/*" multiple data-action="room-photo" data-idx="' + idx + '"></label>' +
        '<div class="thumb-strip">' + room.photos.map(function (p, pidx) {
          return '<span class="thumb-wrap"><img class="thumb" src="' + p.previewUrl + '" alt="">' +
            '<button type="button" class="thumb-remove" data-action="remove-room-photo" data-room-idx="' + idx + '" data-photo-idx="' + pidx + '" aria-label="Fjern bilde">&times;</button></span>';
        }).join('') + '</div>' +
      '</div>';
    });
    html += '<div style="margin:14px 0;"><input type="text" id="new-room-name" placeholder="Nytt rom, f.eks. Bod" style="background:rgba(255,255,255,0.04); border:1px solid var(--line-strong); color:var(--text-light); border-radius:6px; padding:9px 12px; font-family:var(--font-body); font-size:14px; margin-right:8px;">' +
      '<button type="button" class="btn btn-ghost btn-small" data-action="add-room">+ Legg til rom</button></div>';
    html += '<div class="form-actions"><button class="btn btn-ghost" data-action="wizard-back">&larr; Tilbake</button><button class="btn btn-primary" data-action="wizard-next">Neste: signatur &rarr;</button></div>';
    return html;
  }

  function conditionPill(idx, value, current, label) {
    var selected = current === value ? ' selected cond-' + value : '';
    return '<button type="button" class="condition-pill' + selected + '" data-action="set-condition" data-idx="' + idx + '" data-value="' + value + '">' + label + '</button>';
  }

  function wizardStep3(w) {
    return '<p class="section-title">STEG 3 — SIGNATUR</p>' +
      '<p style="color:var(--muted); font-size:14.5px;">Begge parter signerer på stedet for å bekrefte at inspeksjonen er korrekt.</p>' +
      '<div class="signature-pad-wrap">' +
        '<p class="signature-label">LEIETAKERS SIGNATUR</p>' +
        '<canvas class="signature-pad" id="sig-tenant"></canvas>' +
        '<button type="button" class="btn btn-ghost btn-small" style="margin-top:8px;" data-action="clear-sig" data-target="tenant">Tøm</button>' +
      '</div>' +
      '<div class="signature-pad-wrap" style="margin-top:22px;">' +
        '<p class="signature-label">UTLEIERS SIGNATUR</p>' +
        '<canvas class="signature-pad" id="sig-landlord"></canvas>' +
        '<button type="button" class="btn btn-ghost btn-small" style="margin-top:8px;" data-action="clear-sig" data-target="landlord">Tøm</button>' +
      '</div>' +
      '<div class="form-actions"><button class="btn btn-ghost" data-action="wizard-back">&larr; Tilbake</button><button class="btn btn-primary" data-action="wizard-finish">Fullfør og generer rapport</button></div>';
  }

  var sigPads = {};

  function bindWizardEvents() {
    var w = state.wizard;

    var backBtn = viewWrap.querySelector('[data-action="wizard-back"]');
    if (backBtn) backBtn.addEventListener('click', function () { w.step -= 1; render(); });

    if (w.step === 1) {
      var nextBtn = viewWrap.querySelector('[data-action="wizard-next"]');
      nextBtn.addEventListener('click', function () {
        var propSel = viewWrap.querySelector('#w-property');
        if (!propSel.value) { showToast('Velg en bolig.', 'danger'); return; }
        w.propertyId = propSel.value;
        w.type = viewWrap.querySelector('#w-type').value;
        w.tenantName = viewWrap.querySelector('#w-tenant').value.trim();
        w.date = viewWrap.querySelector('#w-date').value || todayISO();
        w.step = 2;
        render();
      });
    }

    if (w.step === 2) {
      viewWrap.querySelectorAll('[data-action="set-condition"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          w.rooms[Number(btn.dataset.idx)].condition = btn.dataset.value;
          render();
        });
      });
      viewWrap.querySelectorAll('[data-action="room-notes"]').forEach(function (ta) {
        ta.addEventListener('input', function () { w.rooms[Number(ta.dataset.idx)].notes = ta.value; });
      });
      viewWrap.querySelectorAll('[data-action="room-photo"]').forEach(function (input) {
        input.addEventListener('change', function () {
          var idx = Number(input.dataset.idx);
          Array.prototype.forEach.call(input.files, function (file) {
            if (file.type.indexOf('image') !== 0) return;
            w.rooms[idx].photos.push({ file: file, name: file.name, previewUrl: URL.createObjectURL(file) });
          });
          render();
        });
      });
      viewWrap.querySelectorAll('[data-action="remove-room"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          w.rooms.splice(Number(btn.dataset.idx), 1);
          render();
        });
      });
      viewWrap.querySelectorAll('[data-action="remove-room-photo"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var roomIdx = Number(btn.dataset.roomIdx);
          var photoIdx = Number(btn.dataset.photoIdx);
          w.rooms[roomIdx].photos.splice(photoIdx, 1);
          render();
        });
      });
      var addRoomBtn = viewWrap.querySelector('[data-action="add-room"]');
      if (addRoomBtn) addRoomBtn.addEventListener('click', function () {
        var input = viewWrap.querySelector('#new-room-name');
        var name = input.value.trim();
        if (!name) { showToast('Skriv inn navn på rommet.', 'danger'); return; }
        w.rooms.push({ name: name, condition: '', notes: '', photos: [] });
        render();
      });
      var nextBtn2 = viewWrap.querySelector('[data-action="wizard-next"]');
      nextBtn2.addEventListener('click', function () {
        if (w.rooms.length === 0) { showToast('Legg til minst ett rom.', 'danger'); return; }
        var missing = w.rooms.some(function (r) { return !r.condition; });
        if (missing) { showToast('Sett tilstand for alle rom før du går videre.', 'danger'); return; }
        w.step = 3;
        render();
      });
    }

    if (w.step === 3) {
      sigPads.tenant = attachSignaturePad(viewWrap.querySelector('#sig-tenant'));
      sigPads.landlord = attachSignaturePad(viewWrap.querySelector('#sig-landlord'));
      viewWrap.querySelectorAll('[data-action="clear-sig"]').forEach(function (btn) {
        btn.addEventListener('click', function () { sigPads[btn.dataset.target].clear(); });
      });
      viewWrap.querySelector('[data-action="wizard-finish"]').addEventListener('click', async function () {
        if (sigPads.tenant.isEmpty() || sigPads.landlord.isEmpty()) {
          showToast('Begge signaturer må fylles ut.', 'danger');
          return;
        }
        var btn = this;
        btn.disabled = true; btn.textContent = 'Lagrer inspeksjon…';
        try {
          w.tenantSignature = sigPads.tenant.toDataURL();
          w.landlordSignature = sigPads.landlord.toDataURL();
          var roomsForSave = [];
          for (var i = 0; i < w.rooms.length; i++) {
            var room = w.rooms[i];
            var uploadedPhotos = await uploadFiles('photos', room.photos, w.propertyId);
            roomsForSave.push({ name: room.name, condition: room.condition, notes: room.notes, photos: uploadedPhotos });
          }
          var saved = await Inspections.add({
            propertyId: w.propertyId,
            type: w.type,
            tenantName: w.tenantName,
            date: w.date,
            rooms: roomsForSave,
            tenantSignature: w.tenantSignature,
            landlordSignature: w.landlordSignature
          });
          state.wizard = null;
          showToast('Inspeksjon fullført. Rapport generert.');
          setView('report-detail', { reportId: saved.id });
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Fullfør og generer rapport';
        }
      });
    }
  }

  /* ---------------- Reports ---------------- */

  function renderReports() {
    var inspections = Inspections.all();
    var html = '<div class="view-head"><div><h1>Rapporter</h1><p>Genererte inspeksjonsrapporter, klare til visning eller utskrift.</p></div>' +
      '<div class="view-actions"><button class="btn btn-primary" data-action="start-inspection">+ Ny inspeksjon</button></div></div>';

    if (inspections.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen rapporter ennå</p><p class="empty-body">Fullfør en digital inspeksjon for å generere en rapport automatisk.</p><button class="btn btn-primary" data-action="start-inspection">+ Start inspeksjon</button></div>';
    } else {
      html += '<div class="property-grid">';
      inspections.forEach(function (insp) {
        var prop = Properties.get(insp.propertyId);
        html += '<div class="report-card-preview" data-action="open-report" data-id="' + insp.id + '">' +
          '<div class="report-head-row"><h3>' + escapeHtml(prop ? prop.name : 'Ukjent bolig') + '</h3><span class="badge badge-done">Godkjent</span></div>' +
          '<p class="type-tag">' + (insp.type === 'innflytting' ? 'Innflyttingsrapport' : 'Utflyttingsrapport') + '</p>' +
          '<p class="entry-row-desc mono">' + formatDateNO(insp.date) + ' · ' + insp.rooms.length + ' rom</p>' +
        '</div>';
      });
      html += '</div>';
    }

    viewWrap.innerHTML = html;
    viewWrap.querySelectorAll('[data-action="start-inspection"]').forEach(function (b) { b.addEventListener('click', function () { startInspectionWizard(); }); });
    viewWrap.querySelectorAll('[data-action="open-report"]').forEach(function (card) {
      card.addEventListener('click', function () { setView('report-detail', { reportId: card.dataset.id }); });
    });
  }

  function renderReportDetail() {
    var insp = Inspections.get(state.selectedReportId);
    if (!insp) { setView('reports'); return; }
    var prop = Properties.get(insp.propertyId);

    var html = '<button class="detail-back no-print" data-action="back-to-reports">&larr; Alle rapporter</button>';
    html += '<div class="view-head no-print"><div><h1>Rapport</h1><p>' + (insp.type === 'innflytting' ? 'Innflyttingsrapport' : 'Utflyttingsrapport') + ' for ' + escapeHtml(prop ? prop.name : '') + '</p></div>' +
      '<div class="view-actions"><button class="btn btn-ghost" data-action="print-report">Skriv ut / lagre som PDF</button><button class="btn btn-danger" data-action="delete-report">Slett rapport</button></div></div>';

    html += '<div id="printArea"><div class="report-doc">' +
      '<p class="doc-eyebrow">EIENDOMSLOGGA · ' + (insp.type === 'innflytting' ? 'INNFLYTTINGSRAPPORT' : 'UTFLYTTINGSRAPPORT') + '</p>' +
      '<h2>' + escapeHtml(prop ? prop.name : 'Ukjent bolig') + '</h2>' +
      '<div class="report-doc-meta">' +
        metaBlock('Adresse', prop ? prop.address : '—') +
        metaBlock('Dato', formatDateNO(insp.date)) +
        metaBlock('Leietaker', insp.tenantName || '—') +
        metaBlock('Antall rom', String(insp.rooms.length)) +
      '</div>';

    insp.rooms.forEach(function (room) {
      html += '<div class="report-room">' +
        '<div class="report-room-head"><h4>' + escapeHtml(room.name) + '</h4>' + conditionBadgeStatic(room.condition) + '</div>' +
        (room.notes ? '<p class="report-room-notes">' + escapeHtml(room.notes) + '</p>' : '') +
        (room.photos && room.photos.length ? '<div class="thumb-strip">' + room.photos.map(function (p) { return '<img class="thumb" src="' + p.url + '" alt="" style="width:64px;height:64px;">'; }).join('') + '</div>' : '') +
      '</div>';
    });

    html += '<div class="report-sign-row">' +
      '<div class="report-sign-block"><img src="' + insp.tenantSignature + '" alt="Leietakers signatur"><p>LEIETAKER' + (insp.tenantName ? ' — ' + escapeHtml(insp.tenantName) : '') + '</p></div>' +
      '<div class="report-sign-block"><img src="' + insp.landlordSignature + '" alt="Utleiers signatur"><p>UTLEIER</p></div>' +
    '</div>';

    html += '</div></div>';

    viewWrap.innerHTML = html;
    viewWrap.querySelector('[data-action="back-to-reports"]').addEventListener('click', function () { setView('reports'); });
    viewWrap.querySelector('[data-action="print-report"]').addEventListener('click', function () { window.print(); });
    viewWrap.querySelector('[data-action="delete-report"]').addEventListener('click', async function () {
      if (confirm('Slette denne rapporten?')) {
        try {
          await Inspections.remove(insp.id);
          showToast('Rapport slettet.');
          setView('reports');
        } catch (err) { /* toast already shown */ }
      }
    });
  }

  function metaBlock(label, value) {
    return '<div><span class="meta-label mono">' + label.toUpperCase() + '</span><span class="meta-value">' + escapeHtml(value || '—') + '</span></div>';
  }
  function conditionBadgeStatic(cond) {
    if (cond === 'god') return '<span class="badge badge-done">god</span>';
    if (cond === 'ok') return '<span class="badge badge-progress">ok</span>';
    if (cond === 'darlig') return '<span class="badge badge-open">dårlig</span>';
    return '<span class="badge badge-neutral">—</span>';
  }

  /* ---------------- Demo data ---------------- */

  function seedDemoData() {
    (async function () {
      try {
        var prop = await Properties.add({ name: 'H0304 — Storgata 12', address: 'Storgata 12, 4611 Kristiansand', rooms: '3', tenantName: 'Kari Nordmann' });
        await Entries.add({ propertyId: prop.id, type: 'feil', title: 'Vannlekkasje ved kjøkkenvask', description: 'Leietaker meldte om dryppende rør under vasken.', date: todayISO(), status: 'åpen', cost: 0, photos: [], documents: [] });
        await Entries.add({ propertyId: prop.id, type: 'vedlikehold', title: 'Service på varmepumpe', description: 'Årlig service utført av Kulde & Varme AS.', date: todayISO(), status: 'løst', cost: 1450, photos: [], documents: [] });
        await Maintenance.add({ propertyId: prop.id, title: 'Rens av takrenner', dueDate: todayISO(), recurring: 'Årlig', notes: 'Utføres før vinteren.' });
        showToast('Eksempeldata lastet inn.');
        render();
      } catch (err) { /* toast already shown by the failing call */ }
    })();
  }

  /* ---------------- Init ---------------- */

  function initApp() {
    viewWrap.classList.add('landing-wrap');
    viewWrap.innerHTML = '<div class="paywall-wrap"><p class="lp-lede">Laster…</p></div>';
    (async function () {
      var sessionRes = await sb.auth.getSession();
      var session = sessionRes.data && sessionRes.data.session;
      if (session) {
        await afterAuthSuccess();
      } else {
        phase = 'landing';
        applyViewWrapClass();
        renderHeader();
        renderPhaseView();
      }
    })();
  }

  initApp();

})();
