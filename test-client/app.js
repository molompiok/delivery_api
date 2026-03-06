/**
 * Test Client — Simulates the end-user (client) flow
 * Auth (OTP) → Orders → Create (dynamic stops, map, company autocomplete) → Voyages & Bookings
 */

// ============ CONFIG ============
const isBrowser = typeof window !== 'undefined';
const DEFAULT_API = (isBrowser && window.location.hostname) ? `http://${window.location.hostname}:3333` : 'http://localhost:3333';
let API_BASE = (isBrowser && localStorage.getItem('tc_api_base')) || DEFAULT_API;
let AUTH_TOKEN = (isBrowser && localStorage.getItem('tc_auth_token')) || null;
let CURRENT_USER = null;

// ============ API HELPERS ============
async function api(method, path, body = null, auth = true) {
    const url = `${API_BASE}/v1${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (auth && AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

function showToast(msg, type = 'info') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'} ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

function formatId(id) { return id ? id.substring(0, 8).toUpperCase() : '—'; }
function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' • ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function statusBadge(s) {
    const m = { DELIVERED: 'badge-success', CONFIRMED: 'badge-success', PENDING: 'badge-pending', DRAFT: 'badge-pending', ACCEPTED: 'badge-active', IN_TRANSIT: 'badge-active', PUBLISHED: 'badge-active', FAILED: 'badge-danger', CANCELLED: 'badge-danger' };
    return m[s] || 'badge-info';
}

// ============ NAVIGATION ============
const views = ['auth', 'orders', 'create', 'voyages'];
let currentView = 'auth';

function switchView(viewId) {
    currentView = viewId;
    views.forEach(v => document.getElementById(`view-${v}`).classList.toggle('active', v === viewId));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === viewId));
    if (viewId === 'orders' && AUTH_TOKEN) loadOrders();
    if (viewId === 'voyages') {
        showTicketsList();
    }
    if (viewId === 'create') renderCreateView();
}

function showTicketsList() {
    document.getElementById('voyages-tickets-subview').classList.remove('hidden');
    document.getElementById('voyages-search-subview').classList.add('hidden');
    loadMyTickets();
}

function showNewTicketSearch() {
    document.getElementById('voyages-tickets-subview').classList.add('hidden');
    document.getElementById('voyages-search-subview').classList.remove('hidden');
    resetVoyageSearch();
}

// ============ AUTH MODULE ============
let lastOtp = null;

async function sendOtp() {
    const phone = document.getElementById('phone-input').value.trim();
    if (!phone) return showToast('Entrez un numéro', 'error');
    const btn = document.getElementById('btn-send-otp');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Envoi...';
    try {
        const res = await api('POST', '/auth/phone/otp/send', { phone }, false);
        lastOtp = res.otp || null;
        document.getElementById('otp-section').classList.remove('hidden');
        if (lastOtp) {
            document.getElementById('otp-auto-display').classList.remove('hidden');
            document.getElementById('otp-auto-code').textContent = lastOtp;
            document.getElementById('otp-input').value = lastOtp;
        }
        showToast('OTP envoyé', 'success');
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Envoyer le code'; }
}

async function verifyOtp() {
    const phone = document.getElementById('phone-input').value.trim();
    const otp = document.getElementById('otp-input').value.trim();
    if (!otp) return showToast('Entrez le code', 'error');
    const btn = document.getElementById('btn-verify-otp');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Vérification...';
    try {
        const res = await api('POST', '/auth/phone/otp/verify', { phone, otp }, false);
        AUTH_TOKEN = res.token; CURRENT_USER = res.user;
        localStorage.setItem('tc_auth_token', AUTH_TOKEN);
        showToast('Connecté !', 'success');
        renderAuthState();
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Vérifier & Connecter'; }
}

async function fetchMe() {
    try { CURRENT_USER = await api('GET', '/auth/me'); renderAuthState(); }
    catch { AUTH_TOKEN = null; localStorage.removeItem('tc_auth_token'); renderAuthState(); }
}

function logout() {
    AUTH_TOKEN = null; CURRENT_USER = null;
    localStorage.removeItem('tc_auth_token'); lastOtp = null;
    document.getElementById('otp-section').classList.add('hidden');
    document.getElementById('otp-auto-display').classList.add('hidden');
    document.getElementById('otp-input').value = '';
    renderAuthState();
    showToast('Déconnecté', 'info');
}

function renderAuthState() {
    const form = document.getElementById('auth-login-form');
    const profile = document.getElementById('auth-profile');
    if (AUTH_TOKEN && CURRENT_USER) {
        form.classList.add('hidden'); profile.classList.remove('hidden');
        const u = CURRENT_USER;
        const ini = (u.fullName || u.full_name || u.phone || '??').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        document.getElementById('profile-avatar').textContent = ini;
        document.getElementById('profile-name').textContent = u.fullName || u.full_name || 'Utilisateur';
        document.getElementById('profile-phone').textContent = u.phone || '';
        document.getElementById('profile-id').textContent = `ID: ${formatId(u.id)}`;
        document.getElementById('profile-role').textContent = u.isDriver ? 'Chauffeur' : 'Client';
    } else { form.classList.remove('hidden'); profile.classList.add('hidden'); }
}

// ============ ORDERS MODULE ============
let ordersCache = [];
async function loadOrders() {
    const c = document.getElementById('orders-list');
    c.innerHTML = '<div class="skeleton loading-card"></div><div class="skeleton loading-card"></div>';
    try {
        const r = await api('GET', '/orders?view=summary&perPage=20');
        ordersCache = Array.isArray(r) ? r : (r?.data || []);
        renderOrders();
    } catch (e) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Erreur</div><div class="empty-desc">${e.message}</div></div>`; }
}

function renderOrders() {
    const c = document.getElementById('orders-list');
    const active = ordersCache.filter(o => !['DELIVERED', 'CANCELLED', 'FAILED'].includes(o.status));
    const history = ordersCache.filter(o => ['DELIVERED', 'CANCELLED', 'FAILED'].includes(o.status));
    let h = '';
    if (active.length) {
        h += `<div class="section-header"><span class="section-title">⚡ Actives</span><span class="section-count">${active.length}</span></div>`;
        active.forEach(o => h += orderCardHtml(o));
    }
    if (history.length) {
        h += `<div class="section-header"><span class="section-title">📋 Historique</span><span class="section-count">${history.length}</span></div>`;
        history.forEach(o => h += orderCardHtml(o));
    }
    if (!ordersCache.length) h = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">Aucune commande</div><div class="empty-desc">Créez votre première commande</div></div>';
    c.innerHTML = h;
}

function orderCardHtml(o) {
    const from = o.itinerary?.display?.from || 'Départ', to = o.itinerary?.display?.to || 'Arrivée';
    const price = o.pricing?.amount || 0, curr = o.pricing?.currency || 'FCFA';
    return `<div class="card order-card" onclick="showOrderDetail('${o.id}')">
        <div class="card-glow" style="background:${o.status === 'DELIVERED' ? 'var(--success)' : 'var(--accent)'}"></div>
        <div class="card-header"><div><div class="order-id">${formatId(o.id)}</div><div class="order-date">${formatDate(o.timestamps?.createdAt)}</div></div><span class="badge ${statusBadge(o.status)}">${o.status}</span></div>
        <div class="order-route"><div class="order-stop"><div class="order-dot dot-pickup"></div><span>${from}</span></div><span class="order-arrow">→</span><div class="order-stop" style="justify-content:flex-end"><span>${to}</span><div class="order-dot dot-delivery"></div></div></div>
        <div class="order-footer"><div><span class="order-price">${price.toLocaleString()}</span><span class="order-currency">${curr}</span></div><span class="badge badge-info">${o.assignment?.mode || ''}</span></div>
    </div>`;
}

async function showOrderDetail(id) {
    try {
        const r = await api('GET', `/orders/${id}?include=steps.stops.actions.transitItem,transitItems`);
        const o = r.entity || r.order || r;
        let stopsH = '';
        (o.steps || []).forEach(st => (st.stops || []).forEach(s => {
            const addr = s.address?.street || s.address?.formattedAddress || 'Adresse';
            const acts = (s.actions || []).map(a => `<span class="badge ${a.type === 'PICKUP' ? 'badge-pending' : 'badge-success'}">${a.type} ${a.transitItem?.name || ''}</span>`).join(' ');
            stopsH += `<div class="voyage-stop-item"><div class="voyage-stop-dot"></div><div><div style="font-weight:700">${addr}</div><div class="mt-2 flex gap-2" style="flex-wrap:wrap">${acts}</div></div></div>`;
        }));
        showModal(`<div class="flex items-center justify-between mb-3"><div><div style="font-size:18px;font-weight:900;">Commande ${formatId(o.id)}</div><div style="font-size:11px;color:var(--text-muted);">${formatDate(o.createdAt)}</div></div><span class="badge ${statusBadge(o.status)}">${o.status}</span></div><div class="divider"></div><div class="section-title mb-3">Itinéraire</div><div class="voyage-stops">${stopsH || '<div class="empty-desc">Aucun arrêt</div>'}</div>${o.status === 'DRAFT' ? `<button class="btn btn-success mt-4" onclick="submitOrder('${o.id}')">Soumettre</button>` : ''}`);
    } catch (e) { showToast(e.message, 'error'); }
}

async function submitOrder(id) {
    try { await api('POST', `/orders/${id}/submit`); showToast('Soumise !', 'success'); closeModal(); loadOrders(); }
    catch (e) { showToast(e.message, 'error'); }
}

// ============ CREATE ORDER MODULE (UPGRADED) ============
let createState = {
    mode: 'GLOBAL',
    priority: 'MEDIUM',
    targetCompany: null, // { id, name }
    transitItems: [
        { id: 'ti_1', name: 'Colis Standard', weight: 5 }
    ],
    stops: [
        { street: 'Plateau, Abidjan', lat: 5.3237, lng: -4.0268, actions: [{ type: 'pickup', transitItemId: 'ti_1', qty: 1 }] },
        { street: 'Cocody Angre, Abidjan', lat: 5.3901, lng: -3.9574, actions: [{ type: 'delivery', transitItemId: 'ti_1', qty: 1 }] }
    ]
};

// --- Company Autocomplete ---
let companySearchTimeout = null;
let companySuggestions = [];

async function searchCompanies(query) {
    if (query.length < 2) { companySuggestions = []; renderCompanySuggestions(); return; }
    try {
        companySuggestions = await api('GET', `/companies/search?q=${encodeURIComponent(query)}`, null, false);
        renderCompanySuggestions();
    } catch { companySuggestions = []; renderCompanySuggestions(); }
}

function onCompanyInput(e) {
    clearTimeout(companySearchTimeout);
    companySearchTimeout = setTimeout(() => searchCompanies(e.target.value), 300);
    createState.targetCompany = null; // reset selection on typing
}

function renderCompanySuggestions() {
    const box = document.getElementById('company-suggestions');
    if (!box) return;
    if (!companySuggestions.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = companySuggestions.map(c => `
        <div class="suggestion-item" onclick="selectCompany('${c.id}', '${(c.name || '').replace(/'/g, "\\'")}', '${c.activityType || ''}')">
            <div class="suggestion-name">${c.name}</div>
            <div class="suggestion-meta">${c.activityType || ''} · ${formatId(c.id)}</div>
        </div>
    `).join('');
}

function selectCompany(id, name, type) {
    createState.targetCompany = { id, name };
    document.getElementById('company-search-input').value = name;
    document.getElementById('company-suggestions').classList.add('hidden');
    document.getElementById('selected-company-badge').innerHTML = `<span class="badge badge-active">✓ ${name}</span>`;
    companySuggestions = [];
}

// --- Dynamic Stops Management ---
// --- Transit Items Management ---
function addTransitItem() {
    const id = `ti_${Date.now()}`;
    createState.transitItems.push({ id, name: 'Nouvel Objet', weight: 1 });
    renderCreateView();
}

function removeTransitItem(idx) {
    const item = createState.transitItems[idx];
    createState.transitItems.splice(idx, 1);
    // Cleanup actions using this item
    createState.stops.forEach(s => s.actions.forEach(a => {
        if (a.transitItemId === item.id) a.transitItemId = null;
    }));
    renderCreateView();
}

function saveItemField(idx, field, value) {
    createState.transitItems[idx][field] = value;
}

// --- Dynamic Stops Management ---
function addStop() {
    createState.stops.push({ street: '', lat: null, lng: null, actions: [{ type: 'delivery', transitItemId: createState.transitItems[0]?.id || null, qty: 1 }] });
    renderCreateView();
}

function removeStop(idx) {
    if (createState.stops.length <= 2) return showToast('Minimum 2 arrêts requis', 'error');
    createState.stops.splice(idx, 1);
    renderCreateView();
}

function addAction(stopIdx) {
    createState.stops[stopIdx].actions.push({ type: 'delivery', transitItemId: createState.transitItems[0]?.id || null, qty: 1 });
    renderCreateView();
}

function removeAction(stopIdx, actIdx) {
    if (createState.stops[stopIdx].actions.length <= 1) return showToast('Au moins 1 action par arrêt', 'error');
    createState.stops[stopIdx].actions.splice(actIdx, 1);
    renderCreateView();
}

function saveStopField(stopIdx, field, value) {
    createState.stops[stopIdx][field] = value;
}

function saveActionField(stopIdx, actIdx, field, value) {
    createState.stops[stopIdx].actions[actIdx][field] = value;
}

// --- Map Picker ---
let mapInstance = null;
let mapMarker = null;
let mapCallback = null;

function openMapPicker(stopIdx) {
    const stop = createState.stops[stopIdx];
    const lat = stop.lat || 5.3600;
    const lng = stop.lng || -4.0083;

    showModal(`
        <div class="modal-title">📍 Choisir un emplacement</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">Déplacez la carte pour positionner le curseur</div>
        <div id="map-container" style="width:100%;height:350px;border-radius:20px;overflow:hidden;position:relative;">
            <div id="map" style="width:100%;height:100%;"></div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-100%);z-index:1000;pointer-events:none;font-size:32px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">📍</div>
        </div>
        <div id="map-coords" style="text-align:center;margin-top:12px;font-size:12px;color:var(--text-muted);font-weight:600;">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
        <div id="map-address" style="text-align:center;margin-top:4px;font-size:13px;color:var(--text-primary);font-weight:700;">Chargement...</div>
        <button class="btn btn-success mt-4" onclick="confirmMapSelection(${stopIdx})">✓ Confirmer cet emplacement</button>
    `);

    // Initialize Leaflet map after DOM is ready
    setTimeout(() => initMap(lat, lng), 100);
}

function initMap(lat, lng) {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // Load Leaflet if not already loaded
    if (typeof L === 'undefined') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => createMap(lat, lng);
        document.head.appendChild(script);
    } else {
        createMap(lat, lng);
    }
}

function createMap(lat, lng) {
    const mapEl = document.getElementById('map');
    if (!mapEl || typeof L === 'undefined') return;

    mapInstance = L.map('map', { zoomControl: false }).setView([lat, lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM'
    }).addTo(mapInstance);

    // Update coords on move
    mapInstance.on('moveend', () => {
        const center = mapInstance.getCenter();
        document.getElementById('map-coords').textContent = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
        reverseGeocode(center.lat, center.lng);
    });

    // Initial reverse geocode
    reverseGeocode(lat, lng);
}

async function reverseGeocode(lat, lng) {
    const addrEl = document.getElementById('map-address');
    if (!addrEl) return;
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`);
        const d = await r.json();
        const parts = [];
        if (d.address?.road) parts.push(d.address.road);
        if (d.address?.neighbourhood) parts.push(d.address.neighbourhood);
        if (d.address?.suburb) parts.push(d.address.suburb);
        if (d.address?.city || d.address?.town) parts.push(d.address.city || d.address.town);
        addrEl.textContent = parts.join(', ') || d.display_name?.split(',').slice(0, 3).join(',') || 'Emplacement sélectionné';
    } catch { addrEl.textContent = 'Emplacement sélectionné'; }
}

function confirmMapSelection(stopIdx) {
    if (!mapInstance) return;
    const center = mapInstance.getCenter();
    createState.stops[stopIdx].lat = center.lat;
    createState.stops[stopIdx].lng = center.lng;
    const addrText = document.getElementById('map-address')?.textContent || '';
    if (addrText && addrText !== 'Chargement...' && addrText !== 'Emplacement sélectionné') {
        createState.stops[stopIdx].street = addrText;
    }
    mapInstance.remove();
    mapInstance = null;
    closeModal();
    renderCreateView();
    showToast('Emplacement confirmé', 'success');
}

function selectMode(mode) {
    createState.mode = mode;
    renderCreateView();
}

function renderCreateView() {
    const c = document.getElementById('create-content');
    if (!c) return;

    // --- Mode selector ---
    let h = `
        <div class="card">
            <div class="card-title mb-3">Mode d'assignation</div>
            <div class="template-selector">
                <div class="template-option ${createState.mode === 'GLOBAL' ? 'selected' : ''}" data-mode="GLOBAL" onclick="selectMode('GLOBAL')">
                    <div class="template-icon">🌐</div>
                    <div class="template-name">Global</div>
                    <div class="template-desc">Dispatch auto</div>
                </div>
                <div class="template-option ${createState.mode === 'TARGET' ? 'selected' : ''}" data-mode="TARGET" onclick="selectMode('TARGET')">
                    <div class="template-icon">🎯</div>
                    <div class="template-name">Target</div>
                    <div class="template-desc">Cibler une entreprise</div>
                </div>
            </div>
    `;

    // --- Company search for TARGET mode ---
    if (createState.mode === 'TARGET') {
        h += `
            <div class="input-group" style="position:relative;">
                <label class="input-label">Entreprise cible</label>
                <input class="input" id="company-search-input" 
                    placeholder="Rechercher par nom..." 
                    value="${createState.targetCompany?.name || ''}" 
                    oninput="onCompanyInput(event)" 
                    autocomplete="off">
                <div id="company-suggestions" class="suggestions-dropdown hidden"></div>
                <div id="selected-company-badge" class="mt-2">
                    ${createState.targetCompany ? `<span class="badge badge-active">✓ ${createState.targetCompany.name}</span>` : ''}
                </div>
                <div style="margin-top:8px;">
                    <label class="input-label" style="font-size:9px;opacity:0.5;">Ou saisir l'ID directement</label>
                    <input class="input" id="target-company-id-direct" placeholder="cmp_xxxxxxxxx" 
                        value="${createState.targetCompany?.id || ''}" 
                        style="font-size:12px;font-family:monospace;"
                        onchange="createState.targetCompany={id:this.value,name:this.value}">
                </div>
            </div>
        `;
    }
    h += '</div>';

    // --- Transit Items Manager ---
    h += `
        <div class="card">
            <div class="flex items-center justify-between mb-3">
                <div class="card-title">📦 Objets à transporter</div>
                <button class="btn btn-xs btn-outline" onclick="addTransitItem()">+ Ajouter Objet</button>
            </div>
            <div id="items-list">
                ${createState.transitItems.map((item, idx) => `
                    <div class="action-row" style="margin-bottom:8px;">
                        <input class="input" style="flex:2;" placeholder="Nom de l'objet" value="${item.name}" 
                            onchange="saveItemField(${idx},'name',this.value)">
                        <input class="input" style="flex:1;" type="number" placeholder="kg" value="${item.weight}" 
                            onchange="saveItemField(${idx},'weight',parseFloat(this.value))">
                        ${createState.transitItems.length > 1 ? `<button class="luggage-remove" onclick="removeTransitItem(${idx})">✕</button>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    // --- Dynamic Stops ---
    h += `<div class="section-header"><span class="section-title">📍 Itinéraire</span><button class="btn btn-xs btn-outline" onclick="addStop()">+ Arrêt</button></div>`;

    createState.stops.forEach((stop, si) => {
        const isFirst = si === 0;
        const isLast = si === createState.stops.length - 1;
        const dotColor = isFirst ? 'var(--warning)' : isLast ? 'var(--success)' : 'var(--accent)';
        const label = isFirst ? 'Départ (Collecte)' : isLast ? 'Destination (Livraison)' : `Arrêt ${si + 1}`;
        const coordsText = stop.lat && stop.lng ? `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}` : 'Non défini';

        h += `
            <div class="card" style="border-left:3px solid ${dotColor};position:relative;">
                ${createState.stops.length > 2 ? `<button class="btn btn-xs btn-danger" style="position:absolute;top:12px;right:12px;" onclick="removeStop(${si})">✕</button>` : ''}
                <div class="flex items-center gap-3 mb-3">
                    <div style="width:12px;height:12px;border-radius:50%;background:${dotColor};box-shadow:0 0 8px ${dotColor}40;flex-shrink:0;"></div>
                    <div class="card-title">${label}</div>
                </div>
                
                <div class="input-group">
                    <label class="input-label">Adresse</label>
                    <div class="flex gap-2">
                        <input class="input" value="${stop.street}" 
                            onchange="saveStopField(${si},'street',this.value)" 
                            placeholder="Rue, Quartier, Ville" style="flex:1;">
                        <button class="btn btn-sm btn-primary" onclick="openMapPicker(${si})" 
                            style="width:auto;flex-shrink:0;padding:10px 14px;border-radius:14px;" title="Choisir sur la carte">
                            🗺️
                        </button>
                    </div>
                </div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:-8px;margin-bottom:12px;font-weight:600;">
                    📌 ${coordsText}
                </div>

                <div class="flex items-center justify-between mb-2">
                    <span style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Actions</span>
                    <button class="btn btn-xs btn-outline" onclick="addAction(${si})">+ Action</button>
                </div>
        `;

        stop.actions.forEach((act, ai) => {
            const itemOptions = createState.transitItems.map(item => `
                <option value="${item.id}" ${act.transitItemId === item.id ? 'selected' : ''}>${item.name} (${item.weight}kg)</option>
            `).join('');

            h += `
                <div class="action-row">
                    <select class="input action-type-select" 
                        onchange="saveActionField(${si},${ai},'type',this.value)">
                        <option value="pickup" ${act.type === 'pickup' ? 'selected' : ''}>📤 Pickup</option>
                        <option value="delivery" ${act.type === 'delivery' ? 'selected' : ''}>📥 Delivery</option>
                        <option value="service" ${act.type === 'service' ? 'selected' : ''}>🔧 Service</option>
                    </select>
                    <select class="input action-item-input" 
                        onchange="saveActionField(${si},${ai},'transitItemId',this.value)">
                        <option value="">— Choisir Objet —</option>
                        ${itemOptions}
                    </select>
                    <input class="input action-qty-input" type="number" placeholder="Qté" value="${act.qty || 1}" min="1"
                        onchange="saveActionField(${si},${ai},'qty',parseInt(this.value))">
                    ${stop.actions.length > 1 ? `<button class="luggage-remove" onclick="removeAction(${si},${ai})">✕</button>` : ''}
                </div>
            `;
        });

        h += '</div>';
    });

    // --- Submit ---
    h += `<button class="btn btn-success mt-3" id="btn-create-order" onclick="createOrder()">Créer la commande</button>`;

    c.innerHTML = h;
}

async function createOrder() {
    const btn = document.getElementById('btn-create-order');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Création...';

    const stopsPayload = [];
    createState.stops.forEach((stop, si) => {
        const actions = stop.actions.map(act => ({
            type: act.type,
            transit_item_id: act.transitItemId,
            quantity: act.qty || 1
        }));
        stopsPayload.push({
            display_order: si + 1,
            address: {
                street: stop.street || `Point ${si + 1}`,
                lat: stop.lat || 5.36,
                lng: stop.lng || -4.01,
                city: 'Abidjan',
                country: "Cote d'Ivoire"
            },
            actions
        });
    });

    const payload = {
        template: 'COMMANDE',
        assignment_mode: createState.mode,
        priority: createState.priority,
        transit_items: createState.transitItems,
        steps: [{ sequence: 1, stops: stopsPayload }]
    };

    if (createState.mode === 'TARGET') {
        const companyId = createState.targetCompany?.id || document.getElementById('target-company-id-direct')?.value?.trim();
        if (!companyId) {
            showToast("Sélectionnez ou entrez l'entreprise cible", 'error');
            btn.disabled = false; btn.innerHTML = 'Créer la commande'; return;
        }
        payload.targetCompanyId = companyId;
    }

    try {
        const result = await api('POST', '/orders', payload);
        const order = result.order || result;
        showToast(`Commande ${formatId(order.id)} créée !`, 'success');
        try { await api('POST', `/orders/${order.id}/submit`); showToast('Soumise automatiquement', 'success'); }
        catch (e) { showToast(`DRAFT — soumission: ${e.message}`, 'info'); }
        switchView('orders');
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Créer la commande'; }
}

// ============ SEAT CANVAS CLASS ============
class SeatCanvas {
    constructor(canvasId, onToggle) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.onToggle = onToggle;
        this.seats = [];
        this.reserved = [];
        this.selected = [];
        this.hoveredId = null;

        this.seatSize = 40;
        this.gap = 15;
        this.padding = 30;

        this.init();
    }

    init() {
        this.canvas.addEventListener('mousemove', e => {
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
            const seat = this.getSeatAt(x, y);

            if (seat?.id !== this.hoveredId) {
                this.hoveredId = seat?.id || null;
                this.canvas.style.cursor = seat && !this.reserved.includes(seat.id) ? 'pointer' : 'default';
                this.render();
            }
        });

        this.canvas.addEventListener('click', e => {
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
            const seat = this.getSeatAt(x, y);

            if (seat && !this.reserved.includes(seat.id)) {
                this.onToggle(seat.id);
            }
        });
    }

    setData(seats, reserved, selected) {
        this.seats = seats;
        this.reserved = reserved;
        this.selected = selected;
        this.resize();
        this.render();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;

        const cols = 4;
        const rows = Math.ceil(this.seats.length / cols);
        this.canvas.height = (rows * (this.seatSize + this.gap) + this.padding * 2) * dpr;
    }

    getSeatAt(x, y) {
        const dpr = window.devicePixelRatio || 1;
        const cols = 4;
        return this.seats.find((s, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const sx = this.padding * dpr + col * (this.seatSize + this.gap) * dpr;
            const sy = this.padding * dpr + row * (this.seatSize + this.gap) * dpr;
            return x >= sx && x <= sx + this.seatSize * dpr && y >= sy && y <= sy + this.seatSize * dpr;
        });
    }

    render() {
        if (!this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const cols = 4;
        this.seats.forEach((s, i) => {
            const sid = s.id || s;
            const num = s.number || sid;
            const col = i % cols;
            const row = Math.floor(i / cols);

            const x = this.padding * dpr + col * (this.seatSize + this.gap) * dpr;
            const y = this.padding * dpr + row * (this.seatSize + this.gap) * dpr;
            const isReserved = this.reserved.includes(sid);
            const isSelected = this.selected.includes(sid);
            const isHovered = this.hoveredId === sid;

            // Seat background
            this.ctx.beginPath();
            if (this.ctx.roundRect) {
                this.ctx.roundRect(x, y, this.seatSize * dpr, this.seatSize * dpr, 8 * dpr);
            } else {
                // Fallback for roundRect
                const r = 8 * dpr;
                const w = this.seatSize * dpr;
                const h = this.seatSize * dpr;
                this.ctx.moveTo(x + r, y);
                this.ctx.arcTo(x + w, y, x + w, y + h, r);
                this.ctx.arcTo(x + w, y + h, x, y + h, r);
                this.ctx.arcTo(x, y + h, x, y, r);
                this.ctx.arcTo(x, y, x + w, y, r);
                this.ctx.closePath();
            }

            if (isReserved) {
                this.ctx.fillStyle = 'rgba(100, 116, 139, 0.2)';
                this.ctx.strokeStyle = 'transparent';
            } else if (isSelected) {
                this.ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
                this.ctx.strokeStyle = '#0ea5e9';
            } else if (isHovered) {
                this.ctx.fillStyle = 'rgba(14, 165, 233, 0.05)';
                this.ctx.strokeStyle = 'rgba(14, 165, 233, 0.4)';
            } else {
                this.ctx.fillStyle = '#1e293b';
                this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
            }

            this.ctx.fill();
            this.ctx.lineWidth = 2 * dpr;
            this.ctx.stroke();

            // Seat number
            this.ctx.fillStyle = isReserved ? '#64748b' : isSelected ? '#0ea5e9' : '#ffffff';
            this.ctx.font = `600 ${13 * dpr}px 'Outfit'`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(num, x + (this.seatSize / 2) * dpr, y + (this.seatSize / 2) * dpr);

            // VIP indicator
            if (s.isVip) {
                this.ctx.fillStyle = '#f59e0b'; // warning color
                this.ctx.font = `${10 * dpr}px sans-serif`;
                this.ctx.fillText('⭐', x + (this.seatSize - 8) * dpr, y + 8 * dpr);
            }
        });
    }
}

let seatSelector = null;

// ============ VOYAGES MODULE ============
let voyagesCache = [];
let myTicketsCache = [];
let bookingState = {
    voyageId: null,
    pickupStopId: null,
    dropoffStopId: null,
    selectedSeats: [],
    luggage: [],
    bookingId: null,
    bookingId: null,
    amount: 0
};

let currentVoyageCompanyId = null;

async function loadVoyages(companyId) {
    if (!companyId) {
        voyagesCache = [];
        renderVoyages();
        return;
    }

    const c = document.getElementById('voyages-list');
    c.innerHTML = '<div class="skeleton loading-card"></div><div class="skeleton loading-card"></div>';
    try {
        const r = await api('GET', `/voyages?companyId=${companyId}`, null, false);
        voyagesCache = Array.isArray(r) ? r : (r?.data || []);
        renderVoyages();
    } catch (e) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Erreur</div><div class="empty-desc">${e.message}</div></div>`; }
}

function resetVoyageSearch() {
    currentVoyageCompanyId = null;
    voyagesCache = [];
    const searchInput = document.getElementById('voyage-company-search');
    if (searchInput) searchInput.value = '';
    renderVoyages();
}

async function loadMyTickets() {
    const c = document.getElementById('my-tickets-list');
    c.innerHTML = '<div class="skeleton loading-card"></div>';
    try {
        const res = await api('GET', '/bookings');
        const list = res?.data || [];
        myTicketsCache = list.map(b => ({
            bookingId: b.id,
            voyageId: b.orderId || b.order_id,
            status: b.status,
            seats: Array.isArray(b.seatsReserved || b.seats_reserved) ? (b.seatsReserved || b.seats_reserved) : [],
            amount: b.transitItems?.reduce((sum, item) => sum + (item.unitaryPrice || 0), 0) || 0,
            createdAt: b.createdAt || b.created_at
        }));
        renderMyTickets();
    } catch (e) {
        c.innerHTML = `<div class="empty-state">⚠️ ${e.message}</div>`;
    }
}

function renderMyTickets() {
    const c = document.getElementById('my-tickets-list');
    if (!c) return;
    if (!myTicketsCache.length) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon">🎟️</div><div class="empty-title">Aucun billet</div><div class="empty-desc">Vous n'avez pas encore de réservations</div></div>`;
        return;
    }

    c.innerHTML = myTicketsCache.map(t => {
        const amount = t.amount || 0;
        return `
        <div class="card ticket-card" style="border-left: 4px solid var(--cyan)">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <div class="order-id">BILLET ${formatId(t.bookingId)}</div>
                    <div class="order-date">${formatDate(t.createdAt)}</div>
                </div>
                <div class="flex flex-col items-end gap-1">
                    <span class="badge ${statusBadge(t.status)}">${t.status}</span>
                    <div style="font-size: 14px; font-weight: 900; color: var(--text-primary)">${amount.toLocaleString()} <span style="font-size: 10px; color: var(--text-muted)">XOF</span></div>
                </div>
            </div>
            <div class="flex gap-2 items-center mb-2">
                <span class="text-xs font-bold text-muted">VOYAGE:</span>
                <span class="font-mono text-xs">${formatId(t.voyageId)}</span>
            </div>
            <div class="flex justify-between items-center mt-3 pt-3" style="border-top: 1px dashed rgba(148, 163, 184, 0.1)">
                <div class="flex gap-2 flex-wrap">
                    ${t.seats.map(s => `<span class="badge badge-outline">Siège ${s}</span>`).join('')}
                </div>
                ${t.status === 'PENDING' ? `<button class="btn btn-xs btn-primary" onclick="paySpecificBooking('${t.bookingId}', ${amount})">🚀 Payer</button>` : ''}
            </div>
        </div>
    `}).join('');
}

async function paySpecificBooking(bookingId, amount) {
    bookingState.bookingId = bookingId;
    bookingState.amount = amount;

    // Set UI for modal
    document.getElementById('pay-booking-id').textContent = formatId(bookingId);
    document.getElementById('pay-seats-list').textContent = '—'; // Would need more data to show seats here
    document.getElementById('pay-total-amount').textContent = `${amount.toLocaleString()} XOF`;

    openModal('modal-payment');
}

// --- Voyage Company Autocomplete ---
let voyageCompanySearchTimeout = null;
let voyageCompanySuggestions = [];

async function searchVoyageCompanies(query) {
    if (query.length < 2) { voyageCompanySuggestions = []; renderVoyageCompanySuggestions(); return; }
    try {
        voyageCompanySuggestions = await api('GET', `/companies/search?q=${encodeURIComponent(query)}`, null, false);
        renderVoyageCompanySuggestions();
    } catch { voyageCompanySuggestions = []; renderVoyageCompanySuggestions(); }
}

function onVoyageCompanyInput(e) {
    clearTimeout(voyageCompanySearchTimeout);
    voyageCompanySearchTimeout = setTimeout(() => searchVoyageCompanies(e.target.value), 300);
}

function renderVoyageCompanySuggestions() {
    const box = document.getElementById('voyage-company-suggestions');
    if (!box) return;
    if (!voyageCompanySuggestions.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = voyageCompanySuggestions.map(c => `
        <div class="suggestion-item" onclick="selectVoyageCompany('${c.id}', '${(c.name || '').replace(/'/g, "\\'")}')">
            <div class="suggestion-name">${c.name}</div>
            <div class="suggestion-meta">${c.activityType || ''} · ${formatId(c.id)}</div>
        </div>
    `).join('');
}

async function selectVoyageCompany(id, name) {
    currentVoyageCompanyId = id;
    document.getElementById('voyage-company-search').value = name;
    document.getElementById('voyage-company-suggestions').classList.add('hidden');
    voyageCompanySuggestions = [];

    // Perform targeted retrieval
    loadVoyages(id);
}

function renderVoyages() {
    const c = document.getElementById('voyages-list');
    if (!voyagesCache.length) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon">🚐</div><div class="empty-title">Aucun voyage publié</div><div class="empty-desc">Cette compagnie n'a pas de voyages publiés</div></div>`;
        return;
    }

    c.innerHTML = voyagesCache.map(v => {
        const stops = v.steps?.flatMap(s => s.stops || []) || [];
        const stopsH = stops.map((s, i) => `
            <div class="voyage-stop-item">
                <div class="voyage-stop-dot" style="background:${i === 0 ? 'var(--warning)' : i === stops.length - 1 ? 'var(--success)' : 'var(--accent)'}"></div>
                ${s.address?.street || s.address?.formattedAddress || 'Point ' + (i + 1)}
            </div>
        `).join('');

        return `<div class="card voyage-card">
            <div class="card-glow" style="background:var(--cyan)"></div>
            <div class="card-header">
                <div>
                    <div class="order-id">🚐 ${formatId(v.id)}</div>
                    <div class="order-date">${formatDate(v.createdAt)}</div>
                </div>
                <span class="badge badge-active">OUVERT</span>
            </div>
            <div class="voyage-stops">${stopsH}</div>
            <div class="order-footer" style="margin-top: 15px;">
                <span class="text-muted text-xs font-bold">${stops.length} ARRÊTS</span>
                <button class="btn btn-sm btn-primary" onclick="openBookingFlow('${v.id}')">Réserver</button>
            </div>
        </div>`;
    }).join('');
}

async function openBookingFlow(voyageId) {
    if (!AUTH_TOKEN) { showToast('Connectez-vous d\'abord', 'error'); switchView('auth'); return; }

    // Reset state
    bookingState = {
        voyageId,
        pickupStopId: null,
        dropoffStopId: null,
        selectedSeats: [],
        luggage: [],
        bookingId: null,
        amount: 0
    };

    try {
        const v = await api('GET', `/voyages/${voyageId}`, null, false);
        const stops = v.steps?.flatMap(s => s.stops || []) || [];

        const pickupSelect = document.getElementById('booking-pickup-stop');
        const dropoffSelect = document.getElementById('booking-dropoff-stop');

        const optionsHtml = '<option value="">— Sélectionner un arrêt —</option>' + stops.map((s, i) =>
            `<option value="${s.id}">${i + 1}. ${s.address?.street || s.address?.formattedAddress || 'Point ' + (i + 1)}</option>`
        ).join('');

        pickupSelect.innerHTML = optionsHtml;
        dropoffSelect.innerHTML = optionsHtml;

        openModal('modal-segment');
    } catch (e) { showToast(e.message, 'error'); }
}

async function proceedToSeats() {
    const pickupId = document.getElementById('booking-pickup-stop').value;
    const dropoffId = document.getElementById('booking-dropoff-stop').value;

    if (!pickupId || !dropoffId) return showToast('Veuillez choisir les deux points', 'error');
    if (pickupId === dropoffId) return showToast('Le départ et l\'arrivée doivent être différents', 'error');

    bookingState.pickupStopId = pickupId;
    bookingState.dropoffStopId = dropoffId;

    const btn = document.querySelector('#modal-segment .btn-primary');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Chargement...';

    try {
        const data = await api('GET', `/voyages/${bookingState.voyageId}/seats?pickup_stop_id=${pickupId}&dropoff_stop_id=${dropoffId}`, null, false);

        closeModal('modal-segment');
        openModal('modal-seats');

        // Give a frame for the modal to be visible so getBoundingClientRect works
        requestAnimationFrame(() => {
            if (!seatSelector) {
                seatSelector = new SeatCanvas('seats-canvas', toggleSeatSelection);
            }
            seatSelector.setData(data.seats || [], data.reservedSeats || [], bookingState.selectedSeats);
        });
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Continuer'; }
}

function toggleSeatSelection(seatId) {
    if (bookingState.selectedSeats.includes(seatId)) {
        bookingState.selectedSeats = bookingState.selectedSeats.filter(id => id !== seatId);
    } else {
        bookingState.selectedSeats.push(seatId);
    }

    if (seatSelector) {
        seatSelector.setData(seatSelector.seats, seatSelector.reserved, bookingState.selectedSeats);
    }

    updateSeatSelectionUI();
}

function updateSeatSelectionUI() {
    document.getElementById('selected-seats-count').textContent = bookingState.selectedSeats.length;
    document.getElementById('btn-proceed-to-luggage').disabled = bookingState.selectedSeats.length === 0;
}

function proceedToLuggage() {
    renderLuggageList();
    closeModal('modal-seats');
    openModal('modal-luggage');
}

function addLuggageItem() {
    const nameInput = document.getElementById('luggage-name');
    const weightInput = document.getElementById('luggage-weight');
    const name = nameInput.value.trim();
    const weight = parseFloat(weightInput.value);

    if (!name) return showToast('Entrez une description', 'error');

    bookingState.luggage.push({ description: name, weight });
    nameInput.value = '';
    weightInput.value = '5';

    renderLuggageList();
}

function removeLuggageItem(idx) {
    bookingState.luggage.splice(idx, 1);
    renderLuggageList();
}

function renderLuggageList() {
    const container = document.getElementById('luggage-list');
    if (bookingState.luggage.length === 0) {
        container.innerHTML = '<div class="text-center p-4 text-muted text-xs">Aucun bagage enregistré</div>';
        return;
    }

    container.innerHTML = bookingState.luggage.map((l, i) => `
        <div class="luggage-item">
            <div class="luggage-info">
                <div class="luggage-name">${l.description}</div>
                <div class="luggage-weight">${l.weight} kg</div>
            </div>
            <div class="luggage-price">${(l.weight * 100).toLocaleString()} F</div>
            <button class="luggage-remove" onclick="removeLuggageItem(${i})">✕</button>
        </div>
    `).join('');
}

async function confirmBooking() {
    const btn = document.querySelector('#modal-luggage .btn-success');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Réservation...';

    const payload = {
        pickupStopId: bookingState.pickupStopId,
        dropoffStopId: bookingState.dropoffStopId,
        seats: bookingState.selectedSeats
    };

    if (bookingState.luggage.length > 0) {
        payload.luggage = bookingState.luggage;
    }

    try {
        const res = await api('POST', `/voyages/${bookingState.voyageId}/bookings`, payload);
        const booking = res.entity || res.booking || res;

        bookingState.bookingId = booking.id;
        bookingState.amount = booking.amount || 0;

        // Prepare Payment Modal
        document.getElementById('pay-booking-id').textContent = formatId(booking.id);
        document.getElementById('pay-seats-list').textContent = bookingState.selectedSeats.join(', ');
        document.getElementById('pay-total-amount').textContent = `${(bookingState.amount).toLocaleString()} XOF`;

        closeModal('modal-luggage');
        openModal('modal-payment');
        showToast('Réservation créée ! En attente de paiement.', 'success');
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Confirmer la réservation'; }
}

async function authorizeBookingPayment() {
    const btn = document.getElementById('btn-pay-now');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Autorisation...';

    try {
        // 1. Get payment intents for this booking
        const intents = await api('GET', `/order-payments?orderId=${bookingState.bookingId}`);
        const intent = Array.isArray(intents) ? intents[0] : (intents?.data?.[0]);

        if (!intent) throw new Error('Aucun paiement trouvé pour cette réservation');

        // 2. Authorize payment
        const result = await api('POST', `/order-payments/${intent.id}/authorize`, {
            successUrl: 'https://wave.sublymus.com/success',
            errorUrl: 'https://wave.sublymus.com/error'
        });

        if (result.checkoutUrl) {
            window.location.href = result.checkoutUrl;
            return;
        }

        showToast('Paiement autorisé avec succès ! 🎉', 'success');
        closeModal('modal-payment');
        switchView('orders');
        loadOrders();
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '🚀 Payer maintenant'; }
}

// ============ MODAL HELPERS ============
function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    if (typeof id === 'string') {
        document.getElementById(id).classList.add('hidden');
    } else {
        // Close all modals
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    }
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
}

// Generic alert modal (stays for back-compat or quick alerts)
function showModal(content) {
    closeModal(); // Close fixed modals
    const existing = document.getElementById('modal-dynamic');
    if (existing) existing.remove();

    const o = document.createElement('div');
    o.id = 'modal-dynamic'; o.className = 'modal-overlay';
    o.onclick = e => { if (e.target === o) o.remove(); };
    o.innerHTML = `<div class="modal-content"><div class="modal-handle"></div>${content}</div>`;
    document.body.appendChild(o);
}

function updateApiUrl() {
    const u = document.getElementById('api-url').value.trim();
    if (u) { API_BASE = u; localStorage.setItem('tc_api_base', u); showToast('API URL mise à jour', 'success'); }
}

// ============ INIT ============
if (isBrowser) {
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('api-url').value = API_BASE;
        document.querySelectorAll('.nav-item').forEach(i => i.addEventListener('click', () => switchView(i.dataset.view)));
        if (AUTH_TOKEN) fetchMe();
        switchView(AUTH_TOKEN ? 'orders' : 'auth');
    });
}
