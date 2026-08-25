/* ============================================================
   EiendomsLogg — app logic
   All data lives in localStorage. No server, no backend.
   ============================================================ */

(function () {
  'use strict';

  var DATA_PREFIX = 'eiendomslogg_data_';
  var USERS_KEY = 'eiendomslogg_users';
  var SESSION_KEY = 'eiendomslogg_session';

  /* ---------------- Storage / data layer (per-user) ----------------
     NOTE: everything below is stored in the browser's localStorage.
     There is no server. This is fine for a prototype/demo, but it
     means data lives only on this device/browser, and account
     "security" here is not real security — see Users module below. */

  function emptyData() {
    return { properties: [], entries: [], maintenance: [], inspections: [] };
  }

  function loadDataForUser(userId) {
    try {
      var raw = localStorage.getItem(DATA_PREFIX + userId);
      if (!raw) return emptyData();
      var parsed = JSON.parse(raw);
      return Object.assign(emptyData(), parsed);
    } catch (e) {
      console.error('Kunne ikke lese lagrede data', e);
      return emptyData();
    }
  }

  function saveData() {
    if (!currentUser) return false;
    try {
      localStorage.setItem(DATA_PREFIX + currentUser.id, JSON.stringify(DB));
      return true;
    } catch (e) {
      console.error('Kunne ikke lagre data', e);
      showToast('Klarte ikke å lagre. Lagringen kan være full.', 'danger');
      return false;
    }
  }

  var DB = emptyData();
  var currentUser = null;
  var phase = 'landing'; // 'landing' | 'login' | 'signup' | 'paywall' | 'app'

  /* ---------------- Users / session ----------------
     Passwords are hashed with a simple, non-cryptographic hash and a
     per-user salt. This stops passwords sitting in plain text, but it
     is NOT secure and must not be relied on for real customer data.
     A real launch needs a proper backend auth provider. */

  function loadUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveUsers(list) {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  }
  function randomSalt() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function hashPassword(password, salt) {
    var combined = salt + '::' + password;
    var hash = 0;
    for (var i = 0; i < combined.length; i++) {
      hash = ((hash << 5) - hash) + combined.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  var Users = {
    findByEmail: function (email) {
      email = (email || '').trim().toLowerCase();
      return loadUsers().find(function (u) { return u.email === email; });
    },
    get: function (id) {
      return loadUsers().find(function (u) { return u.id === id; });
    },
    create: function (name, email, password) {
      var users = loadUsers();
      var salt = randomSalt();
      var user = {
        id: uid('user'),
        name: name,
        email: email.trim().toLowerCase(),
        salt: salt,
        passwordHash: hashPassword(password, salt),
        subscribed: false,
        plan: null,
        createdAt: todayISO()
      };
      users.push(user);
      saveUsers(users);
      return user;
    },
    verify: function (email, password) {
      var user = Users.findByEmail(email);
      if (!user) return null;
      if (hashPassword(password, user.salt) !== user.passwordHash) return null;
      return user;
    },
    setSubscribed: function (userId, plan) {
      var users = loadUsers();
      var u = users.find(function (x) { return x.id === userId; });
      if (!u) return;
      u.subscribed = true;
      u.plan = plan;
      u.subscribedAt = todayISO();
      saveUsers(users);
      if (currentUser && currentUser.id === userId) currentUser = u;
    }
  };

  function getSessionUserId() { return localStorage.getItem(SESSION_KEY); }
  function setSession(userId) { localStorage.setItem(SESSION_KEY, userId); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

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

  /* ---------------- CRUD helpers ---------------- */

  var Properties = {
    all: function () { return DB.properties.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'no'); }); },
    get: function (id) { return DB.properties.find(function (p) { return p.id === id; }); },
    add: function (obj) {
      obj.id = uid('prop');
      obj.createdAt = todayISO();
      DB.properties.push(obj);
      saveData();
      return obj;
    },
    update: function (id, patch) {
      var p = Properties.get(id);
      if (!p) return;
      Object.assign(p, patch);
      saveData();
    },
    remove: function (id) {
      DB.properties = DB.properties.filter(function (p) { return p.id !== id; });
      DB.entries = DB.entries.filter(function (e) { return e.propertyId !== id; });
      DB.maintenance = DB.maintenance.filter(function (m) { return m.propertyId !== id; });
      DB.inspections = DB.inspections.filter(function (i) { return i.propertyId !== id; });
      saveData();
    }
  };

  var Entries = {
    all: function () { return DB.entries.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }); },
    forProperty: function (propertyId) { return Entries.all().filter(function (e) { return e.propertyId === propertyId; }); },
    get: function (id) { return DB.entries.find(function (e) { return e.id === id; }); },
    add: function (obj) {
      obj.id = uid('entry');
      obj.createdAt = todayISO();
      DB.entries.push(obj);
      saveData();
      return obj;
    },
    update: function (id, patch) {
      var e = Entries.get(id);
      if (!e) return;
      Object.assign(e, patch);
      saveData();
    },
    remove: function (id) {
      DB.entries = DB.entries.filter(function (e) { return e.id !== id; });
      saveData();
    }
  };

  var Maintenance = {
    all: function () { return DB.maintenance.slice().sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); }); },
    forProperty: function (propertyId) { return Maintenance.all().filter(function (m) { return m.propertyId === propertyId; }); },
    get: function (id) { return DB.maintenance.find(function (m) { return m.id === id; }); },
    add: function (obj) {
      obj.id = uid('maint');
      obj.status = 'planlagt';
      DB.maintenance.push(obj);
      saveData();
      return obj;
    },
    update: function (id, patch) {
      var m = Maintenance.get(id);
      if (!m) return;
      Object.assign(m, patch);
      saveData();
    },
    remove: function (id) {
      DB.maintenance = DB.maintenance.filter(function (m) { return m.id !== id; });
      saveData();
    }
  };

  var Inspections = {
    all: function () { return DB.inspections.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }); },
    forProperty: function (propertyId) { return Inspections.all().filter(function (i) { return i.propertyId === propertyId; }); },
    get: function (id) { return DB.inspections.find(function (i) { return i.id === id; }); },
    add: function (obj) {
      obj.id = uid('insp');
      DB.inspections.push(obj);
      saveData();
      return obj;
    },
    remove: function (id) {
      DB.inspections = DB.inspections.filter(function (i) { return i.id !== id; });
      saveData();
    }
  };

  /* ---------------- App state ---------------- */

  var state = {
    view: 'dashboard',
    selectedPropertyId: null,
    selectedReportId: null,
    logFilter: { propertyId: '', type: '', status: '' },
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

  function logInAs(user) {
    currentUser = user;
    setSession(user.id);
    DB = loadDataForUser(user.id);
    state.view = 'dashboard';
    state.selectedPropertyId = null;
    state.selectedReportId = null;
    state.wizard = null;
    showToast('Velkommen, ' + user.name + '.');
    setPhase(user.subscribed ? 'app' : 'paywall');
  }

  function handleLogout() {
    clearSession();
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
          '<div class="brand"><span class="logo-mark">EL</span><span class="logo-word">Eiendoms<em>Logg</em></span></div>' +
          '<div class="header-actions">' +
            '<button class="btn btn-ghost btn-small" id="exportBtn" type="button"><span class="full-label">Eksporter data</span></button>' +
            '<button class="btn btn-primary btn-small" id="quickAddBtn" type="button">+ Ny hendelse</button>' +
            '<span class="account-pill"><span class="account-avatar">' + escapeHtml(initials) + '</span>' + escapeHtml(currentUser ? currentUser.name : '') + '</span>' +
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
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  }

  function marketingHeaderHtml() {
    var showLogout = phase === 'paywall';
    return '' +
      '<header class="marketing-header">' +
        '<div class="marketing-header-inner">' +
          '<div class="brand" id="brandHome" style="cursor:pointer;"><span class="logo-mark">EL</span><span class="logo-word">Eiendoms<em>Logg</em></span></div>' +
          '<nav class="marketing-nav-links">' +
            (phase === 'landing' ? '<a href="#slik-fungerer-det">Slik fungerer det</a><a href="#priser">Priser</a>' : '') +
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
    a.download = 'eiendomslogg-data-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Data eksportert som JSON.');
  }

  /* ---------------- File helpers ---------------- */

  function filesToDataURLs(fileList, cb) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return cb([]);
    var results = [];
    var remaining = files.length;
    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        results.push({ name: file.name, dataUrl: reader.result, isImage: file.type.indexOf('image') === 0 });
        remaining--;
        if (remaining === 0) cb(results);
      };
      reader.onerror = function () {
        remaining--;
        if (remaining === 0) cb(results);
      };
      reader.readAsDataURL(file);
    });
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
  function stampSvg() {
    return '<svg viewBox="0 0 100 100" width="72" height="72"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<text x="50" y="44" text-anchor="middle" font-family="\'IBM Plex Mono\', monospace" font-size="10.5" font-weight="600" fill="currentColor">GODKJENT</text>' +
      '<text x="50" y="64" text-anchor="middle" font-family="\'IBM Plex Mono\', monospace" font-size="8" fill="currentColor">' + todayISO().split('-').reverse().join('.') + '</text></svg>';
  }

  /* ================================================================
     LANDING PAGE (marketing homepage)
     ================================================================ */

  function heroIllustrationHtml() {
    return '<div class="hero-visual" aria-hidden="true">' +
      '<div class="hv-tabs"><span class="hv-tab">H0101</span><span class="hv-tab">H0203</span><span class="hv-tab active">H0304</span></div>' +
      '<div class="hv-card-stack">' +
        '<div class="hv-card hv-receipt">' +
          '<div class="hv-card-head">KVITTERING #0451</div>' +
          '<div class="hv-receipt-line"><span>Rørlegger — bad H0304</span><span>kr 1 250</span></div>' +
          '<div class="hv-receipt-line"><span>Nytt sluk + tetting</span><span>kr 890</span></div>' +
          '<div class="hv-receipt-rule"></div>' +
          '<div class="hv-receipt-line total"><span>Totalt</span><span>kr 2 140</span></div>' +
          '<div class="hv-receipt-date mono">12.03.2026</div>' +
        '</div>' +
        '<div class="hv-card hv-photo">' +
          '<div class="hv-photo-thumb">' + iconCameraSmall() + '</div>' +
          '<div class="hv-photo-meta"><p class="hv-photo-tag">BAD · H0304</p><p>Vannskade ved sluk, dokumentert før reparasjon</p></div>' +
        '</div>' +
        '<div class="hv-card hv-report">' +
          '<div class="hv-stamp">' + stampSvg() + '</div>' +
          '<div class="hv-card-head">UTFLYTTINGSRAPPORT</div>' +
          '<p class="hv-report-line">Leilighet H0304 — 3 rom</p>' +
          '<p class="hv-report-line muted">6 bilder · 0 avvik registrert</p>' +
          '<div class="hv-sign-row"><span>Signatur</span><span class="hv-sign-line"></span></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function howStep(num, title, body, iconHtml) {
    return '<div class="how-step"><div class="how-step-icon">' + iconHtml + '</div><p class="how-step-num mono">STEG ' + num + '</p><h3>' + title + '</h3><p>' + body + '</p></div>';
  }

  function lpFeature(title, body) {
    return '<div class="lp-feature-card"><h3>' + title + '</h3><p>' + body + '</p></div>';
  }

  function pricingCardHtml(buttonId, buttonLabel) {
    return '<div class="pricing-wrap"><div class="pricing-card">' +
      '<span class="pricing-badge">ABONNEMENT</span>' +
      '<p class="pricing-price">299 kr<span> / måned</span></p>' +
      '<p class="pricing-sub">Opptil 10 boliger. Legg til flere for 19 kr/bolig/mnd.</p>' +
      '<ul class="pricing-features">' +
        '<li>Ubegrenset feilregistrering og logg</li>' +
        '<li>Bilder, dokumenter og kvitteringer</li>' +
        '<li>Digitale inspeksjoner med signatur</li>' +
        '<li>Automatiske PDF-rapporter</li>' +
        '<li>Vedlikeholdsplan med varsler</li>' +
      '</ul>' +
      '<button class="btn btn-primary btn-block" id="' + buttonId + '">' + buttonLabel + '</button>' +
    '</div></div>';
  }

  function renderLanding() {
    var html = '';

    html += '<section class="lp-section lp-hero"><div class="lp-inner lp-hero-grid">' +
      '<div>' +
        '<p class="eyebrow">FOR SMÅ OG MELLOMSTORE UTLEIERE</p>' +
        '<h1>Slutt å lete etter kvitteringen i en e-posttråd.</h1>' +
        '<p class="lp-hero-lede">EiendomsLogg samler feil, bilder, kvitteringer, vedlikehold og inspeksjoner for hver bolig på ett sted — med dato, historikk og signatur, klart når noen spør.</p>' +
        '<div class="lp-hero-actions">' +
          '<button class="btn btn-primary" id="heroCta">Kom i gang</button>' +
          '<a class="btn btn-ghost" href="#slik-fungerer-det">Se hvordan det fungerer</a>' +
        '</div>' +
        '<p class="lp-hero-note">Krever abonnement. Ingen bindingstid — avslutt når du vil.</p>' +
      '</div>' +
      heroIllustrationHtml() +
    '</div></section>';

    html += '<section class="lp-section tinted" id="slik-fungerer-det"><div class="lp-inner">' +
      '<p class="eyebrow">SLIK FUNGERER DET</p>' +
      '<h2>Fra registrert bolig til ferdig rapport</h2>' +
      '<p class="lp-lede">Fire steg som dekker det meste en utleier trenger å holde styr på gjennom hele leieforholdet.</p>' +
      '<div class="how-steps">' +
        howStep('01', 'Registrer boligen', 'Legg inn adresse, rom og leietaker. Dette blir startpunktet for boligens egen logg.', iconHome()) +
        howStep('02', 'Loggfør det som skjer', 'Feil, vedlikehold, kvitteringer og bilder registreres fortløpende, på PC eller mobil.', iconClipboard()) +
        howStep('03', 'Gjennomfør inspeksjon', 'Ved inn- eller utflytting fylles en digital befaring ut med bilder og signatur fra begge parter.', iconCamera()) +
        howStep('04', 'Få automatisk rapport', 'Inspeksjonen blir til en ferdig rapport, klar til å sendes eller arkiveres.', iconDoc()) +
      '</div>' +
    '</div></section>';

    html += '<section class="lp-section"><div class="lp-inner">' +
      '<p class="eyebrow">ALT PÅ ETT STED</p><h2>Bygget rundt hvordan en bolig faktisk driftes</h2>' +
      '<p class="lp-lede">Seks moduler som dekker det meste en utleier trenger å holde styr på.</p>' +
      '<div class="lp-feature-grid">' +
        lpFeature('Feilregistrering', 'Registrer feil og henvendelser fra leietaker, med status fra meldt til utbedret.') +
        lpFeature('Bilder og dokumenter', 'Last opp bilder, kontrakter og kvitteringer, søkbart i ettertid.') +
        lpFeature('Vedlikeholdsplan', 'Planlegg service og sesongvedlikehold, få varsel før noe forfaller.') +
        lpFeature('Digital inspeksjon', 'Gjennomfør inn- og utflyttingskontroller på mobilen, med signatur på stedet.') +
        lpFeature('Automatiske rapporter', 'Inspeksjoner blir til ferdige rapporter, klare til å sendes eller arkiveres.') +
        lpFeature('Historikk per bolig', 'Se hele livsløpet til hver leilighet — hva som er gjort, når og hva det kostet.') +
      '</div>' +
    '</div></section>';

    html += '<section class="lp-section tinted" id="priser"><div class="lp-inner" style="text-align:center;">' +
      '<p class="eyebrow" style="text-align:center;">PRISER</p><h2 style="margin-left:auto;margin-right:auto;">Ett abonnement, alt inkludert</h2>' +
      '<p class="lp-lede" style="margin-left:auto;margin-right:auto;text-align:center;">Ingen skjulte kostnader. Legg til så mange boliger du trenger.</p>' +
      pricingCardHtml('pricingCta', 'Kom i gang') +
    '</div></section>';

    html += '<footer class="lp-footer"><div class="lp-inner lp-footer-inner">' +
      '<span>© 2026 EiendomsLogg</span><span class="mono">LOGGET I KRISTIANSAND</span>' +
    '</div></footer>';

    viewWrap.innerHTML = html;

    var heroCta = document.getElementById('heroCta');
    if (heroCta) heroCta.addEventListener('click', function () { setPhase(currentUser ? 'paywall' : 'signup'); });
    var pricingCta = document.getElementById('pricingCta');
    if (pricingCta) pricingCta.addEventListener('click', function () { setPhase(currentUser ? 'paywall' : 'signup'); });
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
        '<p class="auth-switch">Ny hos EiendomsLogg? <a id="toSignup">Opprett konto</a></p>' +
      '</div></div>';

    document.getElementById('toSignup').addEventListener('click', function () { setPhase('signup'); });
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var email = (fd.get('email') || '').toString().trim();
      var password = (fd.get('password') || '').toString();
      var user = Users.verify(email, password);
      if (!user) { renderLogin('Feil e-post eller passord.'); return; }
      logInAs(user);
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
        '</form>' +
        '<p class="auth-switch">Har du allerede en konto? <a id="toLogin">Logg inn</a></p>' +
      '</div></div>';

    document.getElementById('toLogin').addEventListener('click', function () { setPhase('login'); });
    document.getElementById('signupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var name = (fd.get('name') || '').toString().trim();
      var email = (fd.get('email') || '').toString().trim();
      var password = (fd.get('password') || '').toString();
      if (!name || !email || password.length < 6) {
        renderSignup('Fyll ut alle felt. Passord må ha minst 6 tegn.');
        return;
      }
      if (Users.findByEmail(email)) {
        renderSignup('Det finnes allerede en konto med denne e-postadressen.');
        return;
      }
      var user = Users.create(name, email, password);
      logInAs(user);
    });
  }

  /* ================================================================
     PAYWALL
     ================================================================ */

  function renderPaywall() {
    viewWrap.innerHTML =
      '<div class="paywall-wrap">' +
        '<div class="paywall-lock">' + iconLock() + '</div>' +
        '<h1>Fullfør abonnementet for å låse opp EiendomsLogg</h1>' +
        '<p class="lp-lede">Hei ' + escapeHtml(currentUser ? currentUser.name : '') + '! Kontoen din er opprettet. Aktiver abonnementet for å få tilgang til boliger, logg, vedlikehold og inspeksjoner.</p>' +
        pricingCardReplace() +
      '</div>';

    document.getElementById('activateSub').addEventListener('click', function () {
      Users.setSubscribed(currentUser.id, 'standard');
      showToast('Abonnement aktivert. Velkommen inn!');
      state.view = 'dashboard';
      setPhase('app');
    });
  }

  function pricingCardReplace() {
    return '<div class="pricing-wrap"><div class="pricing-card">' +
      '<span class="pricing-badge">ABONNEMENT</span>' +
      '<p class="pricing-price">299 kr<span> / måned</span></p>' +
      '<p class="pricing-sub">Opptil 10 boliger. Avslutt når du vil.</p>' +
      '<ul class="pricing-features">' +
        '<li>Ubegrenset feilregistrering og logg</li>' +
        '<li>Bilder, dokumenter og kvitteringer</li>' +
        '<li>Digitale inspeksjoner med signatur</li>' +
        '<li>Automatiske PDF-rapporter</li>' +
      '</ul>' +
      '<button class="btn btn-primary btn-block" id="activateSub">Aktiver abonnement</button>' +
      '<p class="demo-note">Demo-modus: dette er en simulert betaling, ingen kort blir belastet. I en skarp versjon kobles dette til en betalingsleverandør som Stripe eller Vipps.</p>' +
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
          '<p class="empty-body">Legg til den første boligen din, eller last inn eksempeldata for å se hvordan EiendomsLogg fungerer.</p>' +
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

    html += '<div class="stat-grid">' +
      statCard('BOLIGER', properties.length, '') +
      statCard('ÅPNE FEIL', openIssues.length, openIssues.length ? 'stamp-color' : 'sage-color') +
      statCard('VEDLIKEHOLD SNART', maintDue.length, maintDue.length ? 'amber-color' : 'sage-color') +
      statCard('INSPEKSJONER', inspections.length, '') +
      '</div>';

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

    html += '<p class="section-title">HISTORIKK FOR BOLIGEN</p>';
    if (entries.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen hendelser registrert</p><p class="empty-body">Feil, vedlikehold og dokumenter for denne boligen vises her.</p></div>';
    } else {
      html += '<div class="card">';
      entries.forEach(function (e) {
        html += timelineItem(e);
      });
      html += '</div>';
    }

    viewWrap.innerHTML = html;

    viewWrap.querySelector('[data-action="back-to-properties"]').addEventListener('click', function () { setView('properties'); });
    viewWrap.querySelector('[data-action="edit-property"]').addEventListener('click', function () { openPropertyForm(p); });
    viewWrap.querySelector('[data-action="delete-property"]').addEventListener('click', function () { confirmDeleteProperty(p); });
    viewWrap.querySelector('[data-action="quick-feil"]').addEventListener('click', function () { openEntryForm({ propertyId: p.id, type: 'feil' }); });
    viewWrap.querySelector('[data-action="quick-dokument"]').addEventListener('click', function () { openEntryForm({ propertyId: p.id, type: 'dokument' }); });
    viewWrap.querySelector('[data-action="quick-vedlikehold"]').addEventListener('click', function () { openMaintenanceForm({ propertyId: p.id }); });
    viewWrap.querySelector('[data-action="quick-inspeksjon"]').addEventListener('click', function () { startInspectionWizard(p.id); });

    bindTimelineActions();
  }

  function timelineItem(e) {
    var html = '<div class="timeline-item" data-entry-id="' + e.id + '">' +
      '<div class="timeline-date mono">' + formatDateNO(e.date) + '</div>' +
      '<div class="timeline-body">' +
        '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">' +
          '<div><span class="type-tag">' + typeLabel(e.type) + '</span><p class="entry-row-title">' + escapeHtml(e.title) + '</p></div>' +
          '<div style="display:flex; align-items:center; gap:8px;">' + statusBadge(e.status) + '</div>' +
        '</div>' +
        (e.description ? '<p class="entry-row-desc">' + escapeHtml(e.description) + '</p>' : '') +
        (e.cost ? '<p class="entry-row-desc mono">Kostnad: ' + money(e.cost) + '</p>' : '');

    if (e.photos && e.photos.length) {
      html += '<div class="thumb-strip">';
      e.photos.forEach(function (ph) {
        html += '<img class="thumb" src="' + ph.dataUrl + '" alt="Bilde: ' + escapeHtml(ph.name) + '" data-action="view-photo">';
      });
      html += '</div>';
    }
    if (e.documents && e.documents.length) {
      e.documents.forEach(function (doc) {
        html += '<span class="doc-chip">' + escapeHtml(doc.name) + '</span>';
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
    html += '<button class="btn btn-ghost btn-small" data-action="delete-entry" data-id="' + e.id + '">Slett</button>';
    html += '</div>';

    html += '</div></div>';
    return html;
  }

  function bindTimelineActions() {
    viewWrap.querySelectorAll('[data-action="mark-resolved"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Entries.update(btn.dataset.id, { status: 'løst' });
        showToast('Merket som løst.');
        render();
      });
    });
    viewWrap.querySelectorAll('[data-action="mark-unresolved"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Entries.update(btn.dataset.id, { status: 'åpen' });
        showToast('Gjenåpnet.');
        render();
      });
    });
    viewWrap.querySelectorAll('[data-action="delete-entry"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Slette denne hendelsen? Dette kan ikke angres.')) {
          Entries.remove(btn.dataset.id);
          showToast('Hendelse slettet.');
          render();
        }
      });
    });
    viewWrap.querySelectorAll('[data-action="view-photo"]').forEach(function (img) {
      img.addEventListener('click', function () { window.open(img.src, '_blank'); });
    });
  }

  function confirmDeleteProperty(p) {
    if (confirm('Slette "' + p.name + '"? All logg, vedlikehold og inspeksjoner for boligen slettes samtidig.')) {
      Properties.remove(p.id);
      showToast('Bolig slettet.');
      setView('properties');
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

    modalEl.querySelector('#propertyForm').addEventListener('submit', function (e) {
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
      if (isEdit) {
        Properties.update(p.id, payload);
        showToast('Bolig oppdatert.');
      } else {
        var created = Properties.add(payload);
        showToast('Bolig registrert.');
        closeModal();
        setView('property-detail', { propertyId: created.id });
        return;
      }
      closeModal();
      render();
    });
  }

  /* ---------------- Log entry form (feil / vedlikehold / dokument) ---------------- */

  var pendingPhotos = [];
  var pendingDocs = [];

  function openEntryForm(defaults) {
    defaults = defaults || {};
    pendingPhotos = [];
    pendingDocs = [];
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
      '<div class="modal-head"><h2>Ny hendelse</h2><button class="modal-close" data-action="close-modal" aria-label="Lukk">&times;</button></div>' +
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
          '<input id="ef-title" name="title" placeholder="F.eks. Vannlekkasje under kjøkkenvask" required></div>' +
        '<div class="form-field"><label for="ef-desc">Beskrivelse</label>' +
          '<textarea id="ef-desc" name="description" placeholder="Hva gjelder saken? Hva er gjort eller må gjøres?"></textarea></div>' +
        '<div class="form-grid">' +
          '<div class="form-field"><label for="ef-date">Dato</label>' +
            '<input id="ef-date" name="date" type="date" value="' + todayISO() + '"></div>' +
          '<div class="form-field"><label for="ef-cost">Kostnad (valgfritt)</label>' +
            '<input id="ef-cost" name="cost" type="number" min="0" placeholder="kr"></div>' +
        '</div>' +
        '<div class="form-field"><label for="ef-status">Status</label>' +
          '<select id="ef-status" name="status">' +
            '<option value="åpen">Åpen</option>' +
            '<option value="pågår">Pågår</option>' +
            '<option value="løst">Løst</option>' +
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
          '<button type="submit" class="btn btn-primary">Lagre hendelse</button>' +
        '</div>' +
      '</form>';

    openModal(html);
    modalEl.querySelectorAll('[data-action="close-modal"]').forEach(function (b) { b.addEventListener('click', closeModal); });

    modalEl.querySelector('#ef-photos').addEventListener('change', function (e) {
      filesToDataURLs(e.target.files, function (results) {
        pendingPhotos = pendingPhotos.concat(results.filter(function (r) { return r.isImage; }));
        renderPhotoPreview();
      });
    });
    modalEl.querySelector('#ef-docs').addEventListener('change', function (e) {
      filesToDataURLs(e.target.files, function (results) {
        pendingDocs = pendingDocs.concat(results);
        renderDocPreview();
      });
    });

    function renderPhotoPreview() {
      var el = modalEl.querySelector('#ef-photo-preview');
      if (!el) return;
      el.innerHTML = pendingPhotos.map(function (p, i) {
        return '<span class="thumb-wrap"><img class="thumb" src="' + p.dataUrl + '" alt="' + escapeHtml(p.name) + '">' +
          '<button type="button" class="thumb-remove" data-action="remove-photo" data-idx="' + i + '" aria-label="Fjern bilde">&times;</button></span>';
      }).join('');
      el.querySelectorAll('[data-action="remove-photo"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          pendingPhotos.splice(Number(btn.dataset.idx), 1);
          renderPhotoPreview();
        });
      });
    }
    function renderDocPreview() {
      var el = modalEl.querySelector('#ef-doc-preview');
      if (!el) return;
      el.innerHTML = pendingDocs.map(function (d, i) {
        return '<span class="doc-chip">' + escapeHtml(d.name) +
          '<button type="button" class="doc-chip-remove" data-action="remove-doc" data-idx="' + i + '" aria-label="Fjern dokument">&times;</button></span>';
      }).join('');
      el.querySelectorAll('[data-action="remove-doc"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          pendingDocs.splice(Number(btn.dataset.idx), 1);
          renderDocPreview();
        });
      });
    }

    modalEl.querySelector('#entryForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var title = (fd.get('title') || '').toString().trim();
      if (!title) { showToast('Tittel må fylles ut.', 'danger'); return; }
      var payload = {
        propertyId: fd.get('propertyId'),
        type: fd.get('type'),
        title: title,
        description: (fd.get('description') || '').toString().trim(),
        date: fd.get('date') || todayISO(),
        cost: fd.get('cost') ? Number(fd.get('cost')) : 0,
        status: fd.get('status'),
        photos: pendingPhotos,
        documents: pendingDocs
      };
      Entries.add(payload);
      showToast('Hendelse lagret.');
      closeModal();
      render();
    });
  }

  /* ---------------- Log view (all entries) ---------------- */

  function renderLog() {
    var properties = Properties.all();
    var html = '<div class="view-head"><div><h1>Logg</h1><p>Alle registrerte hendelser på tvers av boligene dine.</p></div>' +
      '<div class="view-actions"><button class="btn btn-primary" data-action="add-entry">+ Ny hendelse</button></div></div>';

    var propOptions = '<option value="">Alle boliger</option>' + properties.map(function (p) {
      return '<option value="' + p.id + '"' + (state.logFilter.propertyId === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
    }).join('');

    html += '<div class="filter-bar">' +
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
    '</div>';

    var entries = Entries.all().filter(function (e) {
      if (state.logFilter.propertyId && e.propertyId !== state.logFilter.propertyId) return false;
      if (state.logFilter.type && e.type !== state.logFilter.type) return false;
      if (state.logFilter.status && e.status !== state.logFilter.status) return false;
      return true;
    });

    if (properties.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen boliger registrert</p><p class="empty-body">Legg til en bolig for å begynne å loggføre.</p><button class="btn btn-primary" data-action="add-property">+ Registrer bolig</button></div>';
    } else if (entries.length === 0) {
      html += '<div class="empty-state"><p class="empty-title">Ingen hendelser funnet</p><p class="empty-body">Prøv å endre filtrene, eller registrer en ny hendelse.</p></div>';
    } else {
      html += '<div class="card">';
      entries.forEach(function (e) {
        var prop = Properties.get(e.propertyId);
        html += '<div class="timeline-item">' +
          '<div class="timeline-date mono">' + formatDateNO(e.date) + '</div>' +
          '<div class="timeline-body">' +
            '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">' +
              '<div><span class="type-tag">' + escapeHtml(prop ? prop.name : '—') + ' · ' + typeLabel(e.type) + '</span><p class="entry-row-title">' + escapeHtml(e.title) + '</p></div>' +
              statusBadge(e.status) +
            '</div>' +
            (e.description ? '<p class="entry-row-desc">' + escapeHtml(e.description) + '</p>' : '') +
          '</div></div>';
      });
      html += '</div>';
    }

    viewWrap.innerHTML = html;

    var addBtn = viewWrap.querySelector('[data-action="add-entry"]');
    if (addBtn) addBtn.addEventListener('click', function () { openEntryForm({}); });
    var addPropBtn = viewWrap.querySelector('[data-action="add-property"]');
    if (addPropBtn) addPropBtn.addEventListener('click', function () { openPropertyForm(); });

    var fp = viewWrap.querySelector('#filter-property');
    var ft = viewWrap.querySelector('#filter-type');
    var fs = viewWrap.querySelector('#filter-status');
    if (fp) fp.addEventListener('change', function () { state.logFilter.propertyId = fp.value; render(); });
    if (ft) ft.addEventListener('change', function () { state.logFilter.type = ft.value; render(); });
    if (fs) fs.addEventListener('change', function () { state.logFilter.status = fs.value; render(); });
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
      btn.addEventListener('click', function () {
        Maintenance.update(btn.dataset.id, { status: 'utført' });
        showToast('Vedlikehold merket som utført.');
        render();
      });
    });
    viewWrap.querySelectorAll('[data-action="delete-maint"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Slette denne vedlikeholdsoppgaven?')) {
          Maintenance.remove(btn.dataset.id);
          showToast('Slettet.');
          render();
        }
      });
    });
  }

  function openMaintenanceForm(defaults) {
    defaults = defaults || {};
    var properties = Properties.all();
    if (properties.length === 0) { showToast('Registrer en bolig først.', 'danger'); openPropertyForm(); return; }

    var propertyOptions = properties.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === defaults.propertyId ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
    }).join('');

    var html =
      '<div class="modal-head"><h2>Planlegg vedlikehold</h2><button class="modal-close" data-action="close-modal" aria-label="Lukk">&times;</button></div>' +
      '<form id="maintForm">' +
        '<div class="form-field"><label for="mf-property">Bolig</label><select id="mf-property" name="propertyId">' + propertyOptions + '</select></div>' +
        '<div class="form-field"><label for="mf-title">Oppgave</label><input id="mf-title" name="title" placeholder="F.eks. Rens av takrenner" required></div>' +
        '<div class="form-grid">' +
          '<div class="form-field"><label for="mf-date">Forfallsdato</label><input id="mf-date" name="dueDate" type="date" value="' + todayISO() + '"></div>' +
          '<div class="form-field"><label for="mf-recur">Gjentakelse</label><select id="mf-recur" name="recurring">' +
            '<option value="Ingen">Ingen</option><option value="Kvartalsvis">Kvartalsvis</option><option value="Halvårlig">Halvårlig</option><option value="Årlig">Årlig</option>' +
          '</select></div>' +
        '</div>' +
        '<div class="form-field"><label for="mf-notes">Notat</label><textarea id="mf-notes" name="notes" placeholder="Detaljer om oppgaven"></textarea></div>' +
        '<div class="form-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Avbryt</button><button type="submit" class="btn btn-primary">Lagre</button></div>' +
      '</form>';
    openModal(html);
    modalEl.querySelectorAll('[data-action="close-modal"]').forEach(function (b) { b.addEventListener('click', closeModal); });
    modalEl.querySelector('#maintForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var title = (fd.get('title') || '').toString().trim();
      if (!title) { showToast('Oppgave må fylles ut.', 'danger'); return; }
      Maintenance.add({
        propertyId: fd.get('propertyId'),
        title: title,
        dueDate: fd.get('dueDate') || todayISO(),
        recurring: fd.get('recurring'),
        notes: (fd.get('notes') || '').toString().trim()
      });
      showToast('Vedlikehold planlagt.');
      closeModal();
      render();
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
          return '<span class="thumb-wrap"><img class="thumb" src="' + p.dataUrl + '" alt="">' +
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
          filesToDataURLs(input.files, function (results) {
            w.rooms[idx].photos = w.rooms[idx].photos.concat(results.filter(function (r) { return r.isImage; }));
            render();
          });
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
      viewWrap.querySelector('[data-action="wizard-finish"]').addEventListener('click', function () {
        if (sigPads.tenant.isEmpty() || sigPads.landlord.isEmpty()) {
          showToast('Begge signaturer må fylles ut.', 'danger');
          return;
        }
        w.tenantSignature = sigPads.tenant.toDataURL();
        w.landlordSignature = sigPads.landlord.toDataURL();
        var saved = Inspections.add({
          propertyId: w.propertyId,
          type: w.type,
          tenantName: w.tenantName,
          date: w.date,
          rooms: w.rooms,
          tenantSignature: w.tenantSignature,
          landlordSignature: w.landlordSignature
        });
        state.wizard = null;
        showToast('Inspeksjon fullført. Rapport generert.');
        setView('report-detail', { reportId: saved.id });
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
      '<p class="doc-eyebrow">EIENDOMSLOGG · ' + (insp.type === 'innflytting' ? 'INNFLYTTINGSRAPPORT' : 'UTFLYTTINGSRAPPORT') + '</p>' +
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
        (room.photos && room.photos.length ? '<div class="thumb-strip">' + room.photos.map(function (p) { return '<img class="thumb" src="' + p.dataUrl + '" alt="" style="width:64px;height:64px;">'; }).join('') + '</div>' : '') +
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
    viewWrap.querySelector('[data-action="delete-report"]').addEventListener('click', function () {
      if (confirm('Slette denne rapporten?')) {
        Inspections.remove(insp.id);
        showToast('Rapport slettet.');
        setView('reports');
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
    var prop = Properties.add({ name: 'H0304 — Storgata 12', address: 'Storgata 12, 4611 Kristiansand', rooms: '3', tenantName: 'Kari Nordmann' });
    Entries.add({ propertyId: prop.id, type: 'feil', title: 'Vannlekkasje ved kjøkkenvask', description: 'Leietaker meldte om dryppende rør under vasken.', date: todayISO(), status: 'åpen', cost: 0, photos: [], documents: [] });
    Entries.add({ propertyId: prop.id, type: 'vedlikehold', title: 'Service på varmepumpe', description: 'Årlig service utført av Kulde & Varme AS.', date: todayISO(), status: 'løst', cost: 1450, photos: [], documents: [] });
    Maintenance.add({ propertyId: prop.id, title: 'Rens av takrenner', dueDate: todayISO(), recurring: 'Årlig', notes: 'Utføres før vinteren.' });
    showToast('Eksempeldata lastet inn.');
    render();
  }

  /* ---------------- Init ---------------- */

  function initApp() {
    var sessionUserId = getSessionUserId();
    if (sessionUserId) {
      var user = Users.get(sessionUserId);
      if (user) {
        currentUser = user;
        DB = loadDataForUser(user.id);
        phase = user.subscribed ? 'app' : 'paywall';
      } else {
        clearSession();
        phase = 'landing';
      }
    } else {
      phase = 'landing';
    }
    applyViewWrapClass();
    renderHeader();
    renderPhaseView();
  }

  initApp();

})();
