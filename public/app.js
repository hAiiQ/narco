const state = {
  user: null,
  route: 'dashboard',
  adminTab: 'overview',
  adminData: null,
  webMcpController: null,
};

const els = {
  authScreen: document.querySelector('#auth-screen'),
  roleWaitScreen: document.querySelector('#role-wait-screen'),
  roleWaitName: document.querySelector('#role-wait-name'),
  appShell: document.querySelector('#app-shell'),
  loginForm: document.querySelector('#login-form'),
  registerForm: document.querySelector('#register-form'),
  authSwitch: document.querySelector('#auth-switch'),
  authTitle: document.querySelector('#auth-title'),
  authCopy: document.querySelector('#auth-copy'),
  authMessage: document.querySelector('#auth-message'),
  content: document.querySelector('#page-content'),
  pageTitle: document.querySelector('#page-title'),
  pageKicker: document.querySelector('#page-kicker'),
  userName: document.querySelector('#user-name'),
  userRole: document.querySelector('#user-role'),
  userAvatar: document.querySelector('#user-avatar'),
  modalRoot: document.querySelector('#modal-root'),
  toastRoot: document.querySelector('#toast-root'),
};

const pages = {
  dashboard: ['Zentrale', 'Übersicht'],
  staff: ['Deine Crew', 'Mitarbeiter'],
  progress: ['Leistung', 'Abgaben'],
  inventory: ['Bestand', 'Inventar'],
  menu: ['Angebot', 'Speisekarte'],
  events: ['Kalender', 'Events'],
  admin: ['Verwaltung', 'Adminbereich'],
};

const adminTabs = [
  ['overview', 'Übersicht'],
  ['users', 'Accounts'],
  ['submissions', 'Abgaben'],
  ['contributionTotals', 'Mitarbeiter-Abgaben'],
  ['roles', 'Rollen'],
  ['inventory', 'Inventar'],
  ['menu', 'Speisekarte'],
  ['events', 'Events'],
  ['finance', 'Finanzen'],
];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function color(value) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#22e3d1';
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'T';
}

function formatNumber(value) {
  return new Intl.NumberFormat('de-DE').format(Number(value || 0));
}

function formatMoney(value) {
  return `${formatNumber(value)} $`;
}

function resourceLabel(type, itemName = '') {
  if (type === 'cash') return 'Geld';
  if (type === 'dirty_cash') return 'Schwarzgeld';
  return itemName || 'Inventarartikel';
}

function formatContribution(value, type, itemName = '') {
  return type === 'cash' || type === 'dirty_cash'
    ? formatMoney(value)
    : `${formatNumber(value)} × ${itemName || 'Artikel'}`;
}

function campaignState(campaign) {
  const now = Date.now();
  if (new Date(campaign.starts_at).getTime() > now) return 'Geplant';
  if (new Date(campaign.ends_at).getTime() < now) return 'Beendet';
  return 'Aktiv';
}

function formatDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return 'Nicht angegeben';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Nicht angegeben' : new Intl.DateTimeFormat('de-DE', options).format(date);
}

function genderText(value) {
  return value === 'male' ? 'Männlich' : value === 'female' ? 'Weiblich' : 'Nicht angegeben';
}

function inputDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function imageStyle(assetId) {
  const id = Number(assetId);
  return Number.isInteger(id) && id > 0 ? `style="background-image:url('/api/assets/${id}')"` : '';
}

function avatarStyle(assetId) {
  const id = Number(assetId);
  return Number.isInteger(id) && id > 0 ? `background-image:url('/api/assets/${id}')` : '';
}

async function api(url, options = {}) {
  const config = { credentials: 'same-origin', cache: 'no-store', ...options };
  if (config.body && !(config.body instanceof FormData)) {
    config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
    if (typeof config.body !== 'string') config.body = JSON.stringify(config.body);
  }
  const response = await fetch(url, config);
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && state.user) showAuth();
    if (response.status === 403 && payload?.code === 'ROLE_REQUIRED' && state.user) {
      showApp({ ...state.user, role_id: null, role_name: null });
    }
    const error = new Error(payload?.error || 'Anfrage fehlgeschlagen.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = `toast${isError ? ' is-error' : ''}`;
  element.textContent = message;
  els.toastRoot.append(element);
  setTimeout(() => element.remove(), 3600);
}

function showAuth(message = '') {
  state.user = null;
  state.adminData = null;
  state.webMcpController?.abort();
  els.appShell.hidden = true;
  els.roleWaitScreen.hidden = true;
  els.authScreen.hidden = false;
  els.authMessage.textContent = message;
}

function showApp(user) {
  state.user = user;
  els.authScreen.hidden = true;
  if (!user.role_id && !user.is_admin) {
    state.webMcpController?.abort();
    els.appShell.hidden = true;
    els.roleWaitScreen.hidden = false;
    els.roleWaitName.textContent = user.display_name;
    return;
  }
  els.roleWaitScreen.hidden = true;
  els.appShell.hidden = false;
  els.userName.textContent = user.display_name;
  els.userRole.textContent = user.role_name || (user.is_admin ? 'Administrator' : 'Crew');
  els.userAvatar.textContent = initials(user.display_name);
  els.userAvatar.style.backgroundImage = user.avatar_asset_id ? `url('/api/assets/${Number(user.avatar_asset_id)}')` : '';
  document.querySelectorAll('[data-admin-only]').forEach((element) => { element.hidden = !user.is_admin; });
  registerWebMcpTools();
  routeFromHash();
}

function toggleAuthMode() {
  const registering = els.registerForm.hidden;
  els.registerForm.hidden = !registering;
  els.loginForm.hidden = registering;
  els.authTitle.textContent = registering ? 'Crew beitreten' : 'Willkommen zurück';
  els.authCopy.textContent = registering
    ? 'Registriere dich mit deinen Narco-City-IC-Daten. Eine Rolle schaltet den Portalzugang frei.'
    : 'Melde dich mit deinem Narco-City-Account an.';
  els.authSwitch.textContent = registering ? 'Schon registriert? Anmelden' : 'Noch kein Account? Registrieren';
  els.authMessage.textContent = '';
  els.authMessage.className = 'form-message';
}

els.authSwitch.addEventListener('click', toggleAuthMode);

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  els.authMessage.textContent = '';
  try {
    const form = new FormData(event.currentTarget);
    const data = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(form) });
    showApp(data.user);
  } catch (error) {
    els.authMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector('button[type="submit"]');
  button.disabled = true;
  els.authMessage.textContent = '';
  els.authMessage.className = 'form-message';
  try {
    const form = new FormData(formElement);
    const data = await api('/api/auth/register', { method: 'POST', body: Object.fromEntries(form) });
    formElement.reset();
    toast(data.user.is_admin ? 'Admin-Account erstellt.' : 'Account erstellt. Dir fehlt noch eine Rolle.');
    showApp(data.user);
  } catch (error) {
    els.authMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
  history.replaceState(null, '', location.pathname);
  showAuth('Du wurdest abgemeldet.');
}

document.querySelector('#logout-button').addEventListener('click', logout);
document.querySelector('#role-wait-logout').addEventListener('click', logout);
document.querySelector('#role-wait-refresh').addEventListener('click', async () => {
  const button = document.querySelector('#role-wait-refresh');
  button.disabled = true;
  try {
    const { user } = await api('/api/auth/session');
    showApp(user);
    toast(user.role_id || user.is_admin ? 'Dein Portalzugang ist jetzt aktiv.' : 'Dir wurde noch keine Rolle zugewiesen.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#mobile-menu-button').addEventListener('click', () => {
  els.appShell.classList.toggle('menu-open');
});

document.querySelector('#main-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-route]');
  if (!button) return;
  navigate(button.dataset.route);
});

window.addEventListener('hashchange', routeFromHash);

function navigate(route) {
  location.hash = route;
  if (location.hash === `#${route}`) routeFromHash();
}

function routeFromHash() {
  if (!state.user) return;
  let route = location.hash.replace(/^#/, '') || 'dashboard';
  if (!pages[route] || (route === 'admin' && !state.user.is_admin)) route = 'dashboard';
  state.route = route;
  document.querySelectorAll('[data-route]').forEach((button) => button.classList.toggle('is-active', button.dataset.route === route));
  els.pageKicker.textContent = pages[route][0];
  els.pageTitle.textContent = pages[route][1];
  els.appShell.classList.remove('menu-open');
  renderRoute(route);
}

function loadingCards(count = 4) {
  return `<div class="card-grid">${Array.from({ length: count }, () => '<div class="panel skeleton"></div>').join('')}</div>`;
}

async function renderRoute(route) {
  els.content.scrollTop = 0;
  els.content.innerHTML = `<section class="page-section">${loadingCards()}</section>`;
  try {
    if (route === 'dashboard') return renderDashboard(await api('/api/dashboard'));
    if (route === 'staff') return renderStaff(await api('/api/staff'));
    if (route === 'progress') return renderProgress(await api('/api/progress'));
    if (route === 'inventory') return renderInventory(await api('/api/inventory'));
    if (route === 'menu') return renderMenu((await api('/api/menu')).items);
    if (route === 'events') return renderEvents((await api('/api/events')).events);
    if (route === 'admin') return loadAdmin();
  } catch (error) {
    els.content.innerHTML = emptyState('!', 'Bereich nicht verfügbar', error.message);
  }
}

function emptyState(icon, title, copy) {
  return `<div class="empty-state"><div><i>${escapeHtml(icon)}</i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div></div>`;
}

function sectionHead(title, copy, action = '') {
  return `<div class="section-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>${action}</div>`;
}

function renderDashboard(data) {
  els.content.innerHTML = `
    <section class="page-section">
      <div class="dashboard-grid">
        <div>
          <article class="panel welcome-card">
            <p class="eyebrow">Schön, dass du da bist</p>
            <h2>Hola, ${escapeHtml(state.user.display_name.split(' ')[0])}.</h2>
            <p>Hier findest du den aktuellen Stand deiner Crew, eure Abgaben und alles, was in der Bar ansteht.</p>
          </article>
          <div class="stat-grid" style="margin-top:12px">
            <article class="stat-card" data-symbol="◎"><span>Aktive Crew</span><strong>${formatNumber(data.staff)}</strong><em>Accounts mit Rolle</em></article>
            <article class="stat-card" data-symbol="↗"><span>Offene Abgaben</span><strong>${formatNumber(data.pendingSubmissions)}</strong><em>warten auf Prüfung</em></article>
            <article class="stat-card" data-symbol="▦"><span>Inventar</span><strong>${formatNumber(data.inventoryCount)}</strong><em>Einheiten erfasst</em></article>
            <article class="stat-card" data-symbol="✦"><span>Events</span><strong>${formatNumber(data.upcomingEvents)}</strong><em>aktuell geplant</em></article>
          </div>
        </div>
        <div>
          <article class="panel">
            <div class="panel__head"><h3>Schnellzugriff</h3><span class="eyebrow" style="margin:0">Heute</span></div>
            <div class="quick-list">
              <button class="quick-link" data-jump="progress"><i>↗</i><span><strong>Abgabe eintragen</strong><small>Eigenen Fortschritt melden</small></span><b>›</b></button>
              <button class="quick-link" data-jump="inventory"><i>▦</i><span><strong>Bestand prüfen</strong><small>Inventar und Konten</small></span><b>›</b></button>
              <button class="quick-link" data-jump="events"><i>✦</i><span><strong>Events ansehen</strong><small>Nächste Termine</small></span><b>›</b></button>
              ${state.user.is_admin ? '<button class="quick-link" data-jump="admin"><i>⚙</i><span><strong>Verwaltung öffnen</strong><small>Accounts und Inhalte</small></span><b>›</b></button>' : ''}
            </div>
          </article>
          <div class="money-strip">
            <div class="money-card"><span>Geld</span><strong>${formatMoney(data.finance?.cash)}</strong></div>
            <div class="money-card money-card--dirty"><span>Schwarzgeld</span><strong>${formatMoney(data.finance?.dirty_cash)}</strong></div>
          </div>
        </div>
      </div>
    </section>`;
  els.content.querySelectorAll('[data-jump]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.jump)));
}

function renderStaff(data) {
  els.content.innerHTML = `
    <section class="page-section">
      ${sectionHead('Unsere Crew', `${data.staff.length} Mitarbeiter mit aktiver Rolle`)}
      <div class="card-grid">
        ${data.staff.length ? data.staff.map((person) => {
          const roleColor = color(person.role_color);
          const hasImage = Boolean(person.avatar_asset_id);
          return `<article class="panel staff-card" style="--role:${roleColor}">
            <div class="staff-card__image${hasImage ? ' has-image' : ''}" data-initials="${escapeHtml(initials(person.display_name))}" ${imageStyle(person.avatar_asset_id)}></div>
            <div class="staff-card__body">
              <span class="role-badge" style="--role:${roleColor}">${escapeHtml(person.role_name || 'Crew')}</span>
              <h3>${escapeHtml(person.display_name)}</h3>
              <p>${escapeHtml(person.task_area || person.about || 'Aufgabenbereich wird noch ergänzt.')}</p>
              <div class="staff-card__meta"><span>${person.age !== null && person.age !== undefined ? `${formatNumber(person.age)} Jahre` : 'Alter offen'}</span><span>${escapeHtml(genderText(person.gender))}</span><span>${person.birth_date ? `Geb. ${formatDate(person.birth_date)}` : 'Geburtsdatum offen'}</span></div>
            </div>
          </article>`;
        }).join('') : emptyState('◎', 'Noch keine Crew sichtbar', 'Accounts mit zugewiesener Rolle erscheinen automatisch hier.')}
      </div>
    </section>`;
}

function progressCards(entries) {
  return `<div class="progress-list">
    ${entries.map((entry) => {
      const approved = Number(entry.approved_amount || 0);
      const target = Number(entry.target_amount || 0);
      const percent = target > 0 ? Math.min(100, Math.round((approved / target) * 100)) : 0;
      const pending = Number(entry.pending_amount || 0);
      return `<article class="progress-card" style="--role:${color(entry.role_color)}">
        <div class="progress-person"><div class="mini-avatar" style="${avatarStyle(entry.avatar_asset_id)}">${entry.avatar_asset_id ? '' : escapeHtml(initials(entry.display_name))}</div><div><strong>${escapeHtml(entry.display_name)}</strong><span>${escapeHtml(entry.role_name || 'Crew')}</span></div></div>
        <div><div class="progress-track"><i style="--progress:${percent}%"></i></div><div class="progress-stats"><span>${percent}% erreicht</span><span>${pending > 0 ? `${formatContribution(pending, entry.resource_type, entry.item_name)} wartet` : 'Keine offene Buchung'}</span></div></div>
        <div class="progress-value"><strong>${formatContribution(approved, entry.resource_type, entry.item_name)} / ${formatContribution(target, entry.resource_type, entry.item_name)}</strong><span>bestätigt</span></div>
      </article>`;
    }).join('')}
  </div>`;
}

function renderProgress(data) {
  const { campaigns, progress } = data;
  const currentCampaign = campaigns.find((campaign) => campaignState(campaign) === 'Aktiv');
  const previousCampaigns = campaigns.filter((campaign) => campaignState(campaign) === 'Beendet');
  const currentEntries = currentCampaign
    ? progress.filter((entry) => Number(entry.campaign_id) === Number(currentCampaign.id))
    : [];
  const own = currentEntries.find((entry) => Number(entry.id) === Number(state.user.id));
  const actions = `<div class="progress-actions"><button class="button button--ghost" id="open-history-modal">Vorherige Abgaben${previousCampaigns.length ? ` · ${previousCampaigns.length}` : ''}</button></div>`;
  els.content.innerHTML = `
    <section class="page-section">
      ${sectionHead('Aktuelle Abgabe', currentCampaign ? 'Fortschritt der gesamten Crew im laufenden Zeitraum' : 'Derzeit ist kein Abgabezeitraum aktiv', actions)}
      ${currentCampaign ? `
        <article class="panel current-campaign">
          <div><p class="eyebrow">${escapeHtml(resourceLabel(currentCampaign.resource_type, currentCampaign.item_name))}</p><h3>${escapeHtml(currentCampaign.name)}</h3><span>${formatDate(currentCampaign.starts_at)} – ${formatDate(currentCampaign.ends_at)}</span></div>
          <div class="current-campaign__target"><span>Dein bestätigter Stand</span><strong>${formatContribution(own?.approved_amount || 0, currentCampaign.resource_type, currentCampaign.item_name)} / ${formatContribution(currentCampaign.target_amount, currentCampaign.resource_type, currentCampaign.item_name)}</strong><button class="button button--primary" id="open-submission-modal">Abgabe abgeben</button></div>
        </article>
        <section class="campaign-block campaign-block--current">
          <div class="campaign-block__head"><div><p class="eyebrow">Crew-Fortschritt</p><h3>Alle Mitarbeiter</h3></div><span>${currentEntries.length} Personen</span></div>
          ${progressCards(currentEntries)}
        </section>` : emptyState('↗', 'Keine aktive Abgabe', 'Sobald ein Admin einen neuen Zeitraum startet, erscheint hier der Fortschritt der Crew.')}
    </section>`;

  document.querySelector('#open-submission-modal')?.addEventListener('click', () => openSubmissionModal(currentCampaign));
  document.querySelector('#open-history-modal')?.addEventListener('click', () => openContributionHistory(previousCampaigns, progress));
}

function openSubmissionModal(campaign) {
  if (!campaign) return;
  openModal('Abgabe eintragen', `<form id="submission-modal-form">
    <div class="submission-modal__campaign"><span>${escapeHtml(resourceLabel(campaign.resource_type, campaign.item_name))}</span><strong>${escapeHtml(campaign.name)}</strong><small>Ziel: ${formatContribution(campaign.target_amount, campaign.resource_type, campaign.item_name)}</small></div>
    <input name="campaignId" type="hidden" value="${campaign.id}" />
    <label>Menge<input name="amount" type="number" min="1" max="1000000000" required placeholder="0" /></label>
    <label>Notiz <span class="muted">(optional)</span><textarea name="note" placeholder="Kurze Information zur Abgabe"></textarea></label>
    <div class="modal__actions"><button class="button button--ghost" type="button" data-close-modal>Abbrechen</button><button class="button button--primary" type="submit">Abgabe eintragen</button></div>
  </form>`);
  const form = els.modalRoot.querySelector('#submission-modal-form');
  form.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await api('/api/submissions', { method: 'POST', body: values });
      closeModal();
      toast('Abgabe eingetragen – sie wartet auf Bestätigung.');
      await renderRoute('progress');
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  });
}

function openContributionHistory(campaigns, progress) {
  openModal('Vorherige Abgaben', `<div class="history-modal">
    ${campaigns.length ? `<div class="history-list">${campaigns.map((campaign) => `<article class="history-row">
      <div><p class="eyebrow">${escapeHtml(resourceLabel(campaign.resource_type, campaign.item_name))}</p><h3>${escapeHtml(campaign.name)}</h3><span>${formatDate(campaign.starts_at)} – ${formatDate(campaign.ends_at)}</span></div>
      <strong>${formatContribution(campaign.target_amount, campaign.resource_type, campaign.item_name)}</strong>
      <button class="button button--small" data-history-info="${campaign.id}">Info</button>
    </article>`).join('')}</div>` : emptyState('↗', 'Noch keine vorherigen Abgaben', 'Abgeschlossene Zeiträume erscheinen später automatisch hier.')}
  </div>`, true);
  els.modalRoot.querySelectorAll('[data-history-info]').forEach((button) => button.addEventListener('click', () => {
    const campaign = campaigns.find((entry) => Number(entry.id) === Number(button.dataset.historyInfo));
    if (campaign) openContributionDetails(campaign, campaigns, progress);
  }));
}

function openContributionDetails(campaign, campaigns, progress) {
  const entries = progress.filter((entry) => Number(entry.campaign_id) === Number(campaign.id));
  openModal(campaign.name, `<div class="history-modal history-detail">
    <div class="campaign-block__head"><div><p class="eyebrow">${escapeHtml(resourceLabel(campaign.resource_type, campaign.item_name))}</p><h3>Fortschritt aller Mitarbeiter</h3></div><span>${formatDate(campaign.starts_at)} – ${formatDate(campaign.ends_at)}</span></div>
    ${progressCards(entries)}
    <div class="modal__actions"><button class="button button--ghost" type="button" data-history-back>Zurück zu vorherigen Abgaben</button></div>
  </div>`, true);
  els.modalRoot.querySelector('[data-history-back]').addEventListener('click', () => openContributionHistory(campaigns, progress));
}

function statusText(status) {
  return ({ pending: 'Offen', approved: 'Bestätigt', rejected: 'Abgelehnt' })[status] || status;
}

function renderInventory(data) {
  els.content.innerHTML = `
    <section class="page-section">
      ${sectionHead('Inventar', 'Aktueller Bestand und gemeinsamer Kassenstand')}
      <div class="money-strip" style="margin:0 0 22px">
        <div class="money-card"><span>Geld</span><strong>${formatMoney(data.finance?.cash)}</strong></div>
        <div class="money-card money-card--dirty"><span>Schwarzgeld</span><strong>${formatMoney(data.finance?.dirty_cash)}</strong></div>
      </div>
      <div class="inventory-grid">
        ${data.items.length ? data.items.map((item) => productCard(item, '▦', `<strong>${formatNumber(item.quantity)}×</strong>`)).join('') : emptyState('▦', 'Inventar ist noch leer', 'Admins können Artikel und Mengen im Adminbereich eintragen.')}
      </div>
    </section>`;
}

function productCard(item, fallback, value, extraClass = '') {
  return `<article class="product-card ${extraClass}">
    <div class="product-card__image${item.image_asset_id ? ' has-image' : ''}" data-fallback="${escapeHtml(fallback)}" ${imageStyle(item.image_asset_id)}></div>
    <div class="product-card__body"><div class="product-card__top"><h3>${escapeHtml(item.name)}</h3>${value}</div><p>${escapeHtml(item.description || 'Keine Beschreibung')}</p></div>
  </article>`;
}

function renderMenu(items) {
  els.content.innerHTML = `
    <section class="page-section">
      ${sectionHead('Speisekarte', 'Was wir unseren Gästen aktuell anbieten')}
      <div class="menu-grid">
        ${items.length ? items.map((item) => productCard(item, '◇', item.available ? `<strong>${(Number(item.price_cents) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} $</strong>` : '<strong class="availability">Ausverkauft</strong>')).join('') : emptyState('◇', 'Noch kein Angebot', 'Admins können Speisen und Getränke im Adminbereich anlegen.')}
      </div>
    </section>`;
}

function renderEvents(events) {
  els.content.innerHTML = `
    <section class="page-section">
      ${sectionHead('Events', 'Alle geplanten Termine auf einen Blick')}
      <div class="event-list">
        ${events.length ? events.map((event) => {
          const date = event.starts_at ? new Date(event.starts_at) : null;
          return `<article class="event-card">
            <div class="event-card__image" ${imageStyle(event.image_asset_id)}>${event.image_asset_id ? '' : '✦'}</div>
            <div class="event-card__body"><p class="eyebrow">${escapeHtml(event.location || 'Tequi-La-La')}</p><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description || 'Weitere Informationen folgen.')}</p></div>
            <div class="event-card__date"><strong>${date ? String(date.getDate()).padStart(2, '0') : '–'}</strong><span>${date ? new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : 'Termin offen'}</span></div>
          </article>`;
        }).join('') : emptyState('✦', 'Keine Events geplant', 'Neue Events erscheinen hier, sobald ein Admin sie anlegt.')}
      </div>
    </section>`;
}

async function loadAdmin() {
  state.adminData = await api('/api/admin/overview');
  renderAdmin();
}

function renderAdmin() {
  if (!state.adminData) return;
  const d = state.adminData;
  const usersWithoutRole = d.users.filter((user) => !user.role_id && !user.is_admin).length;
  const pendingSubmissions = d.submissions.filter((item) => item.status === 'pending').length;
  els.content.innerHTML = `
    <section class="page-section">
      ${sectionHead('Verwaltung', 'Accounts, Inhalte und Bar-Daten zentral bearbeiten')}
      <div class="admin-tabs">${adminTabs.map(([id, label]) => `<button data-admin-tab="${id}" class="${state.adminTab === id ? 'is-active' : ''}">${label}${id === 'users' && usersWithoutRole ? ` · ${usersWithoutRole}` : ''}${id === 'submissions' && pendingSubmissions ? ` · ${pendingSubmissions}` : ''}</button>`).join('')}</div>
      <div id="admin-view">${renderAdminTab()}</div>
    </section>`;
}

function renderAdminTab() {
  const d = state.adminData;
  if (state.adminTab === 'overview') return `
    <div class="admin-stats">
      <div class="admin-stat"><span>Accounts</span><strong>${d.users.length}</strong></div>
      <div class="admin-stat"><span>Ohne Rolle</span><strong>${d.users.filter((user) => !user.role_id && !user.is_admin).length}</strong></div>
      <div class="admin-stat"><span>Offene Abgaben</span><strong>${d.submissions.filter((item) => item.status === 'pending').length}</strong></div>
      <div class="admin-stat"><span>Rollen</span><strong>${d.roles.length}</strong></div>
    </div>
    <div class="panel"><div class="panel__head"><h3>Direkt verwalten</h3></div><div class="quick-list">
      <button class="quick-link" data-admin-tab="users"><i>◎</i><span><strong>Accounts & Mitarbeiter</strong><small>Freigeben, Rollen und Profile bearbeiten</small></span><b>›</b></button>
      <button class="quick-link" data-admin-tab="submissions"><i>↗</i><span><strong>Abgaben prüfen</strong><small>Einträge bestätigen oder ablehnen</small></span><b>›</b></button>
      <button class="quick-link" data-admin-tab="contributionTotals"><i>∑</i><span><strong>Mitarbeiter-Abgaben</strong><small>Bestätigte Gesamtabgaben je Mitarbeiter</small></span><b>›</b></button>
      <button class="quick-link" data-admin-tab="inventory"><i>▦</i><span><strong>Inhalte pflegen</strong><small>Inventar, Karte und Events</small></span><b>›</b></button>
    </div></div>`;
  if (state.adminTab === 'users') return adminUsers();
  if (state.adminTab === 'submissions') return adminSubmissions();
  if (state.adminTab === 'contributionTotals') return adminContributionTotals();
  if (state.adminTab === 'roles') return adminRoles();
  if (state.adminTab === 'inventory') return adminResources('inventory', 'Inventar', d.inventory, 'Neuer Artikel');
  if (state.adminTab === 'menu') return adminResources('menu', 'Speisekarte', d.menu, 'Neues Angebot');
  if (state.adminTab === 'events') return adminResources('events', 'Events', d.events, 'Neues Event');
  if (state.adminTab === 'finance') return adminFinance();
  return '';
}

function adminUsers() {
  const d = state.adminData;
  return `<div class="panel"><div class="panel__head"><h3>Accounts</h3><span class="muted">${d.users.length} gesamt</span></div><div class="panel__body admin-list">
    ${d.users.map((user) => `<div class="admin-row">
      <div class="admin-row__name"><div class="mini-avatar" style="--role:${color(user.role_color)};${avatarStyle(user.avatar_asset_id)}">${user.avatar_asset_id ? '' : escapeHtml(initials(user.display_name))}</div><div><strong>${escapeHtml(user.display_name)}</strong><span>${escapeHtml(user.task_area || 'Kein Aufgabenbereich eingetragen')}</span></div></div>
      <span class="role-badge" style="--role:${color(user.role_color)}">${escapeHtml(user.role_name || 'Keine Rolle')}</span>
      <span class="status-badge status-badge--${user.role_id || user.is_admin ? 'approved' : 'pending'}">${user.role_id || user.is_admin ? 'Aktiv' : 'Ohne Rolle'}</span>
      <div class="admin-row__actions"><button class="button button--small" data-edit="user" data-id="${user.id}">Bearbeiten</button>${Number(user.id) !== Number(state.user.id) ? `<button class="button button--small button--danger" data-delete="user" data-id="${user.id}">Löschen</button>` : ''}</div>
    </div>`).join('')}
  </div></div>`;
}

function adminSubmissions() {
  const rows = state.adminData.submissions;
  const campaigns = state.adminData.campaigns;
  return `<div class="panel"><div class="panel__head"><h3>Abgabezeiträume</h3><button class="button button--primary button--small" data-edit="campaign">Zeitraum anlegen</button></div><div class="panel__body admin-list">
    ${campaigns.length ? campaigns.map((campaign) => {
      const status = campaignState(campaign);
      const statusClass = status === 'Aktiv' ? 'approved' : status === 'Geplant' ? 'pending' : 'rejected';
      return `<div class="admin-row"><div class="admin-row__name"><div><strong>${escapeHtml(campaign.name)}</strong><span>${formatContribution(campaign.target_amount, campaign.resource_type, campaign.item_name)} · ${formatDate(campaign.starts_at)} – ${formatDate(campaign.ends_at)}</span></div></div><strong>${formatContribution(campaign.target_amount, campaign.resource_type, campaign.item_name)}</strong><span class="status-badge status-badge--${statusClass}">${status}</span><div class="admin-row__actions"><button class="button button--small" data-edit="campaign" data-id="${campaign.id}">Bearbeiten</button><button class="button button--small button--danger" data-delete="campaign" data-id="${campaign.id}">Löschen</button></div></div>`;
    }).join('') : emptyState('+', 'Noch kein Abgabezeitraum', 'Lege zum Beispiel eine Woche mit 500.000 $ Ziel an.')}
  </div></div>
  <div class="panel admin-submissions-panel"><div class="panel__head"><h3>Abgaben prüfen</h3><span class="muted">${rows.filter((item) => item.status === 'pending').length} offen</span></div><div class="panel__body admin-list">
    ${rows.length ? rows.map((item) => `<div class="admin-row"><div class="admin-row__name"><div><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.campaign_name || 'Alter Eintrag')} · ${formatDate(item.submitted_at, { dateStyle: 'medium', timeStyle: 'short' })} · ${escapeHtml(item.note || 'Ohne Notiz')}</span></div></div><strong>${formatContribution(item.amount, item.resource_type, item.item_name)}</strong><span class="status-badge status-badge--${escapeHtml(item.status)}">${statusText(item.status)}</span><div class="admin-row__actions">${item.status === 'pending' ? `<button class="button button--small" data-review="approved" data-id="${item.id}">Bestätigen</button><button class="button button--small" data-review="rejected" data-id="${item.id}">Ablehnen</button>` : `<button class="button button--small" data-review="pending" data-id="${item.id}">Rückgängig</button>`}<button class="button button--small button--danger" data-delete-submission data-id="${item.id}">Löschen</button></div></div>`).join('') : emptyState('↗', 'Keine Abgaben', 'Eingetragene Abgaben erscheinen hier.')}
  </div></div>`;
}

function adminContributionTotals() {
  const d = state.adminData;
  const approved = d.submissions.filter((entry) => entry.status === 'approved');
  const employees = d.users.filter((user) => user.role_id || user.is_admin || approved.some((entry) => Number(entry.user_id) === Number(user.id)));
  return `<div class="panel"><div class="panel__head"><div><h3>Mitarbeiter-Abgaben</h3><span class="muted">Nur bestätigte Abgaben werden in die Gesamtsumme eingerechnet.</span></div><span class="muted">${employees.length} Mitarbeiter</span></div><div class="panel__body contribution-total-grid">
    ${employees.length ? employees.map((user) => {
      const entries = approved.filter((entry) => Number(entry.user_id) === Number(user.id));
      const grouped = new Map();
      entries.forEach((entry) => {
        const type = entry.resource_type || 'item';
        const key = type === 'item' ? `item:${entry.inventory_item_id || entry.item_name || 'unknown'}` : type;
        const current = grouped.get(key) || { type, itemName: entry.item_name || 'Inventarartikel', amount: 0 };
        current.amount += Number(entry.amount || 0);
        grouped.set(key, current);
      });
      const totals = [...grouped.values()].sort((a, b) => {
        const order = { cash: 0, dirty_cash: 1, item: 2 };
        return (order[a.type] ?? 3) - (order[b.type] ?? 3) || a.itemName.localeCompare(b.itemName, 'de');
      });
      return `<article class="contribution-total-card" style="--role:${color(user.role_color)}">
        <div class="contribution-total-card__head"><div class="progress-person"><div class="mini-avatar" style="${avatarStyle(user.avatar_asset_id)}">${user.avatar_asset_id ? '' : escapeHtml(initials(user.display_name))}</div><div><strong>${escapeHtml(user.display_name)}</strong><span>${escapeHtml(user.role_name || (user.is_admin ? 'Admin' : 'Ehemaliger Mitarbeiter'))}</span></div></div><span>${entries.length} bestätigt</span></div>
        <div class="contribution-total-card__values">${totals.length ? totals.map((total) => `<div><span>${escapeHtml(resourceLabel(total.type, total.itemName))}</span><strong>${formatContribution(total.amount, total.type, total.itemName)}</strong></div>`).join('') : '<p>Noch keine bestätigten Abgaben.</p>'}</div>
      </article>`;
    }).join('') : emptyState('∑', 'Noch keine Mitarbeiter', 'Mitarbeiter mit Rolle oder bestätigten Abgaben erscheinen hier.')}
  </div></div>`;
}

function adminRoles() {
  const rows = state.adminData.roles;
  return `<div class="panel"><div class="panel__head"><h3>Rollen</h3><button class="button button--primary button--small" data-edit="role">Rolle hinzufügen</button></div><div class="panel__body admin-list">
    ${rows.map((role) => `<div class="admin-row"><div class="admin-row__name"><div class="mini-avatar" style="--role:${color(role.color)}">●</div><div><strong>${escapeHtml(role.name)}</strong><span>Priorität ${formatNumber(role.priority)}</span></div></div><span class="role-badge" style="--role:${color(role.color)}">${escapeHtml(role.color)}</span><span></span><div class="admin-row__actions"><button class="button button--small" data-edit="role" data-id="${role.id}">Bearbeiten</button><button class="button button--small button--danger" data-delete="role" data-id="${role.id}">Entfernen</button></div></div>`).join('')}
  </div></div>`;
}

function adminResources(type, label, rows, addLabel) {
  return `<div class="panel"><div class="panel__head"><h3>${label}</h3><button class="button button--primary button--small" data-edit="${type}">${addLabel}</button></div><div class="panel__body admin-list">
    ${rows.length ? rows.map((item) => `<div class="admin-row"><div class="admin-row__name"><div class="mini-avatar" style="${avatarStyle(item.image_asset_id)}">${item.image_asset_id ? '' : type === 'events' ? '✦' : type === 'menu' ? '◇' : '▦'}</div><div><strong>${escapeHtml(item.name || item.title)}</strong><span>${escapeHtml(item.description || 'Keine Beschreibung')}</span></div></div><span>${type === 'inventory' ? `${formatNumber(item.quantity)} Stück` : type === 'menu' ? `${(Number(item.price_cents) / 100).toFixed(2)} $` : formatDate(item.starts_at)}</span><span>${type === 'menu' ? (item.available ? 'Verfügbar' : 'Ausverkauft') : ''}</span><div class="admin-row__actions"><button class="button button--small" data-edit="${type}" data-id="${item.id}">Bearbeiten</button><button class="button button--small button--danger" data-delete="${type}" data-id="${item.id}">Löschen</button></div></div>`).join('') : emptyState('+', `Noch keine ${label}-Einträge`, `Mit „${addLabel}“ kannst du den ersten Eintrag anlegen.`)}
  </div></div>`;
}

function adminFinance() {
  const finance = state.adminData.finance;
  return `<div class="panel"><div class="panel__head"><h3>Kontostände</h3></div><form id="finance-form" class="panel__body stack-form"><div class="form-grid form-grid--two"><label>Geld<input name="cash" type="number" min="0" value="${Number(finance.cash)}" required /></label><label>Schwarzgeld<input name="dirtyCash" type="number" min="0" value="${Number(finance.dirty_cash)}" required /></label></div><div><button class="button button--primary" type="submit">Kontostände speichern</button></div></form></div>`;
}

els.content.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-admin-tab]');
  if (tab) {
    state.adminTab = tab.dataset.adminTab;
    renderAdmin();
    return;
  }
  const edit = event.target.closest('[data-edit]');
  if (edit) return openEditor(edit.dataset.edit, Number(edit.dataset.id) || null);
  const remove = event.target.closest('[data-delete]');
  if (remove) return removeItem(remove.dataset.delete, Number(remove.dataset.id));
  const removeSubmission = event.target.closest('[data-delete-submission]');
  if (removeSubmission) return deleteSubmission(Number(removeSubmission.dataset.id));
  const review = event.target.closest('[data-review]');
  if (review) return reviewSubmission(Number(review.dataset.id), review.dataset.review);
});

els.content.addEventListener('submit', async (event) => {
  if (event.target.id !== 'finance-form') return;
  event.preventDefault();
  try {
    const values = Object.fromEntries(new FormData(event.target));
    await api('/api/admin/finance', { method: 'PUT', body: values });
    toast('Kontostände aktualisiert.');
    await loadAdmin();
  } catch (error) {
    toast(error.message, true);
  }
});

function openModal(title, body, wide = false) {
  els.modalRoot.innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal${wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal__head"><h2>${escapeHtml(title)}</h2><button class="modal__close" type="button" aria-label="Schließen">×</button></div>${body}</section></div>`;
  els.modalRoot.querySelector('.modal__close').addEventListener('click', closeModal);
  els.modalRoot.querySelector('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
  document.addEventListener('keydown', modalEscape);
  setTimeout(() => els.modalRoot.querySelector('input,select,textarea,button')?.focus(), 0);
}

function modalEscape(event) {
  if (event.key === 'Escape') closeModal();
}

function closeModal() {
  els.modalRoot.innerHTML = '';
  document.removeEventListener('keydown', modalEscape);
}

function openEditor(type, id) {
  const d = state.adminData;
  if (type === 'user') return userEditor(d.users.find((item) => Number(item.id) === id));
  if (type === 'role') return roleEditor(d.roles.find((item) => Number(item.id) === id));
  if (type === 'campaign') return campaignEditor(d.campaigns.find((item) => Number(item.id) === id));
  const collection = type === 'events' ? d.events : d[type];
  return resourceEditor(type, collection.find((item) => Number(item.id) === id));
}

function userEditor(user) {
  openModal('Account bearbeiten', `<form id="editor-form" data-type="user" data-id="${user.id}">
    <div class="form-grid form-grid--two">
      <label>IC Vorname<input name="firstName" required value="${escapeHtml(user.first_name || user.display_name?.split(' ')[0] || '')}" /></label>
      <label>IC Nachname<input name="lastName" required value="${escapeHtml(user.last_name || user.display_name?.split(' ').slice(1).join(' ') || '')}" /></label>
      <label>IC Geburtsdatum<input name="birthDate" type="date" required value="${user.birth_date ? new Date(user.birth_date).toISOString().slice(0, 10) : ''}" /></label>
      <label>Geschlecht<select name="gender" required><option value="male" ${user.gender === 'male' ? 'selected' : ''}>Männlich</option><option value="female" ${user.gender === 'female' ? 'selected' : ''}>Weiblich</option></select></label>
      <label>Rolle<select name="roleId"><option value="">Keine Rolle</option>${state.adminData.roles.map((role) => `<option value="${role.id}" ${Number(role.id) === Number(user.role_id) ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('')}</select></label>
      <label>Profilbild<input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
    </div>
    <label>Aufgabenbereich<input name="taskArea" value="${escapeHtml(user.task_area || '')}" placeholder="z. B. Barleitung und Einkauf" /></label>
    <label>Weitere Informationen<textarea name="about">${escapeHtml(user.about || '')}</textarea></label>
    ${user.avatar_asset_id ? '<label class="checkbox"><input name="removeAvatar" type="checkbox" /> Profilbild entfernen</label>' : ''}
    <label class="checkbox"><input name="isAdmin" type="checkbox" ${user.is_admin ? 'checked' : ''} /> Adminrechte</label>
    <input name="avatarAssetId" type="hidden" value="${user.avatar_asset_id || ''}" />
    <div class="modal__actions"><button class="button button--ghost" type="button" data-close-modal>Abbrechen</button><button class="button button--primary" type="submit">Speichern</button></div>
  </form>`);
  bindEditorForm();
}

function campaignEditor(campaign) {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  openModal(campaign ? 'Abgabezeitraum bearbeiten' : 'Abgabezeitraum anlegen', `<form id="editor-form" data-type="campaign" data-id="${campaign?.id || ''}">
    <label>Name<input name="name" required maxlength="140" value="${escapeHtml(campaign?.name || 'Wochenabgabe')}" placeholder="z. B. Wochenabgabe 38" /></label>
    <div class="form-grid form-grid--two">
      <label>Art<select name="resourceType" required><option value="cash" ${campaign?.resource_type === 'cash' ? 'selected' : ''}>Geld</option><option value="dirty_cash" ${campaign?.resource_type === 'dirty_cash' ? 'selected' : ''}>Schwarzgeld</option><option value="item" ${campaign?.resource_type === 'item' ? 'selected' : ''}>Inventarartikel</option></select></label>
      <label>Ziel pro Mitarbeiter<input name="targetAmount" type="number" min="1" max="1000000000000" required value="${Number(campaign?.target_amount || 500000)}" /></label>
      <label>Start<input name="startsAt" type="datetime-local" required value="${inputDate(campaign?.starts_at || now)}" /></label>
      <label>Ende<input name="endsAt" type="datetime-local" required value="${inputDate(campaign?.ends_at || nextWeek)}" /></label>
    </div>
    <label>Inventarartikel <span class="muted">(nur bei Art „Inventarartikel“)</span><select name="inventoryItemId"><option value="">Bitte wählen</option>${state.adminData.inventory.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(campaign?.inventory_item_id) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
    <p class="form-note">Das Ziel gilt einzeln für jeden Mitarbeiter. Bestätigte Einträge werden automatisch als Geld, Schwarzgeld oder Artikel gebucht.</p>
    <div class="modal__actions"><button class="button button--ghost" type="button" data-close-modal>Abbrechen</button><button class="button button--primary" type="submit">Speichern</button></div>
  </form>`);
  bindEditorForm();
}

function roleEditor(role) {
  openModal(role ? 'Rolle bearbeiten' : 'Rolle hinzufügen', `<form id="editor-form" data-type="role" data-id="${role?.id || ''}"><div class="form-grid form-grid--two"><label>Name<input name="name" required value="${escapeHtml(role?.name || '')}" /></label><label>Farbe<input name="color" type="color" value="${color(role?.color || '#7c3aed')}" /></label></div><label>Priorität<input name="priority" type="number" value="${Number(role?.priority || 0)}" /></label><div class="modal__actions"><button class="button button--ghost" type="button" data-close-modal>Abbrechen</button><button class="button button--primary" type="submit">Speichern</button></div></form>`);
  bindEditorForm();
}

function resourceEditor(type, item = null) {
  const titles = { inventory: 'Inventarartikel', menu: 'Angebot', events: 'Event' };
  let fields = '';
  if (type === 'inventory') fields = `<div class="form-grid form-grid--two"><label>Name<input name="name" required value="${escapeHtml(item?.name || '')}" /></label><label>Menge<input name="quantity" type="number" min="0" required value="${Number(item?.quantity || 0)}" /></label></div><label>Beschreibung<textarea name="description">${escapeHtml(item?.description || '')}</textarea></label>`;
  if (type === 'menu') fields = `<div class="form-grid form-grid--two"><label>Name<input name="name" required value="${escapeHtml(item?.name || '')}" /></label><label>Preis in Cent<input name="priceCents" type="number" min="0" required value="${Number(item?.price_cents || 0)}" /></label></div><label>Beschreibung<textarea name="description">${escapeHtml(item?.description || '')}</textarea></label><label class="checkbox"><input name="available" type="checkbox" ${item?.available ?? true ? 'checked' : ''} /> Aktuell verfügbar</label>`;
  if (type === 'events') fields = `<label>Titel<input name="title" required value="${escapeHtml(item?.title || '')}" /></label><div class="form-grid form-grid--two"><label>Ort<input name="location" value="${escapeHtml(item?.location || '')}" /></label><label>Termin<input name="startsAt" type="datetime-local" value="${inputDate(item?.starts_at)}" /></label></div><label>Beschreibung<textarea name="description">${escapeHtml(item?.description || '')}</textarea></label>`;
  openModal(`${titles[type]} ${item ? 'bearbeiten' : 'anlegen'}`, `<form id="editor-form" data-type="${type}" data-id="${item?.id || ''}">${fields}<label>Bild<input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label><input name="imageAssetId" type="hidden" value="${item?.image_asset_id || ''}" /><div class="modal__actions"><button class="button button--ghost" type="button" data-close-modal>Abbrechen</button><button class="button button--primary" type="submit">Speichern</button></div></form>`);
  bindEditorForm();
}

function bindEditorForm() {
  els.modalRoot.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  els.modalRoot.querySelector('#editor-form').addEventListener('submit', saveEditor);
}

function adminEndpoint(type) {
  return ({ user: 'users', role: 'roles', campaign: 'campaigns' })[type] || type;
}

async function uploadImage(file) {
  if (!file || !file.size) return null;
  const form = new FormData();
  form.append('image', file);
  const result = await api('/api/admin/assets', { method: 'POST', body: form });
  return result.id;
}

async function saveEditor(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const file = form.querySelector('input[type="file"]')?.files[0];
    const assetId = await uploadImage(file);
    if (assetId) {
      if (form.dataset.type === 'user') values.avatarAssetId = assetId;
      else values.imageAssetId = assetId;
    }
    if (form.dataset.type === 'user' && form.elements.removeAvatar?.checked && !assetId) values.avatarAssetId = '';
    values.isAdmin = Boolean(form.elements.isAdmin?.checked);
    values.available = form.elements.available ? Boolean(form.elements.available.checked) : undefined;
    delete values.image;
    delete values.removeAvatar;
    const type = form.dataset.type;
    if (type === 'campaign') {
      values.startsAt = new Date(values.startsAt).toISOString();
      values.endsAt = new Date(values.endsAt).toISOString();
    }
    const id = form.dataset.id;
    const endpointType = adminEndpoint(type);
    const method = id ? 'PUT' : 'POST';
    await api(`/api/admin/${endpointType}${id ? `/${id}` : ''}`, { method, body: values });
    closeModal();
    toast('Änderungen gespeichert.');
    await loadAdmin();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
}

async function removeItem(type, id) {
  const question = type === 'campaign'
    ? 'Diesen Abgabezeitraum samt aller zugehörigen Abgaben wirklich löschen? Bereits bestätigte Beträge werden aus Geld, Schwarzgeld oder Inventar zurückgebucht.'
    : 'Diesen Eintrag wirklich löschen?';
  if (!window.confirm(question)) return;
  const endpointType = adminEndpoint(type);
  try {
    await api(`/api/admin/${endpointType}/${id}`, { method: 'DELETE' });
    toast('Eintrag gelöscht.');
    await loadAdmin();
  } catch (error) {
    toast(error.message, true);
  }
}

async function reviewSubmission(id, status) {
  if (status === 'pending' && !window.confirm('Diese Entscheidung wirklich rückgängig machen? Bei einer bestätigten Abgabe wird der gebuchte Bestand wieder abgezogen.')) return;
  try {
    const result = await api(`/api/admin/submissions/${id}`, { method: 'PATCH', body: { status } });
    toast(status === 'approved'
      ? `${formatContribution(result.submission.amount, result.booking?.type, result.booking?.name)} als ${result.booking?.name || 'Abgabe'} gebucht.`
      : status === 'pending'
        ? `Entscheidung rückgängig gemacht.${result.booking ? ' Der Bestand wurde korrigiert.' : ''}`
        : 'Abgabe abgelehnt.');
    await loadAdmin();
  } catch (error) {
    toast(error.message, true);
  }
}

async function deleteSubmission(id) {
  if (!window.confirm('Diese einzelne Abgabe wirklich löschen? Eine bereits bestätigte Menge wird dabei aus Geld, Schwarzgeld oder Inventar zurückgebucht.')) return;
  try {
    const result = await api(`/api/admin/submissions/${id}`, { method: 'DELETE' });
    toast(`Abgabe gelöscht.${result.booking ? ' Der Bestand wurde korrigiert.' : ''}`);
    await loadAdmin();
  } catch (error) {
    toast(error.message, true);
  }
}

function updateClock() {
  const now = new Date();
  document.querySelector('#live-date').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short' }).format(now);
  document.querySelector('#live-time').textContent = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(now);
}

function registerWebMcpTools() {
  state.webMcpController?.abort();
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const controller = new AbortController();
  state.webMcpController = controller;
  Promise.resolve(context.registerTool({
    name: 'submit_delivery',
    title: 'Abgabe eintragen',
    description: 'Trägt eine Abgabe für einen aktiven Zeitraum ein. Nach Admin-Bestätigung wird sie dem persönlichen Fortschritt und dem passenden Bestand gutgeschrieben.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'integer', minimum: 1, description: 'ID des aktiven Abgabezeitraums' },
        amount: { type: 'integer', minimum: 1, description: 'Abgabemenge' },
        note: { type: 'string', maxLength: 500, description: 'Kurze Beschreibung der Abgabe' },
      },
      required: ['campaignId', 'amount'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      if (!Number.isInteger(input?.campaignId) || input.campaignId <= 0) throw new Error('campaignId muss die ID eines aktiven Abgabezeitraums sein.');
      if (!Number.isInteger(input?.amount) || input.amount <= 0) throw new Error('amount muss eine positive ganze Zahl sein.');
      const result = await api('/api/submissions', { method: 'POST', body: { campaignId: input.campaignId, amount: input.amount, note: String(input.note || '').slice(0, 500) } });
      if (state.route === 'progress') await renderRoute('progress');
      return { id: result.submission.id, status: result.submission.status, amount: result.submission.amount, campaignName: result.submission.campaign_name, resourceType: result.submission.resource_type };
    },
  }, { signal: controller.signal })).catch(() => controller.abort());
}

updateClock();
setInterval(updateClock, 30_000);

(async function initialize() {
  try {
    const { user } = await api('/api/auth/session');
    showApp(user);
  } catch {
    showAuth();
  }
})();
