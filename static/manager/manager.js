(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

  const KIND = {
    restaurant: { label: 'مطعم', ico: '🍕' },
    cafe: { label: 'كوفي شوب', ico: '☕' },
    cloud_kitchen: { label: 'مطبخ سحابي', ico: '🥡' },
    other: { label: 'أخرى', ico: '🏪' },
  };
  const STATUS = {
    live: 'يعمل',
    setup: 'قيد الإعداد',
    paused: 'متوقف',
    archived: 'مؤرشف',
  };

  const WIZARD_STEPS = ['النشاط', 'الهوية', 'الاستضافة', 'الشات بوت', 'المراجعة'];
  const PALETTES = [
    { id: 'navy', primary: '#1e3a5f', dark: '#0f2744', label: 'كحلي' },
    { id: 'forest', primary: '#1b4332', dark: '#081c15', label: 'أخضر' },
    { id: 'wine', primary: '#6b2d3c', dark: '#3d1822', label: 'عنابي' },
    { id: 'ember', primary: '#9a3412', dark: '#7c2d12', label: 'برتقالي' },
    { id: 'slate', primary: '#334155', dark: '#1e293b', label: 'رمادي' },
    { id: 'gold', primary: '#92400e', dark: '#78350f', label: 'ذهبي' },
  ];

  const state = {
    wizard: null,
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('غير مصرح');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'فشل الطلب');
    return data;
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function fmtDate(s) {
    if (!s) return '—';
    try {
      return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ar', { hour12: false });
    } catch { return s; }
  }

  function pillStatus(st) {
    return `<span class="pill ${esc(st)}">${st === 'live' ? '<span class="pulse"></span>' : ''}${esc(STATUS[st] || st)}</span>`;
  }

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => toast('تم النسخ'), () => toast('تعذر النسخ'));
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebar-backdrop').classList.add('hidden');
  }

  // ---------- Auth ----------
  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  }
  function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    route();
  }

  async function checkAuth() {
    try {
      const me = await fetch('/manager/api/me').then((r) => r.json());
      if (me.authenticated) showApp();
      else showLogin();
    } catch { showLogin(); }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').classList.add('hidden');
    try {
      await api('/manager/api/login', { method: 'POST', body: { password: $('#login-password').value } });
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
      $('#login-error').classList.remove('hidden');
    }
  });
  $('#logout-btn').addEventListener('click', async () => {
    await api('/manager/api/logout', { method: 'POST' });
    showLogin();
  });
  $('#menu-toggle').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    $('#sidebar-backdrop').classList.remove('hidden');
  });
  $('#sidebar-backdrop').addEventListener('click', closeSidebar);
  $('#ping-all-btn').addEventListener('click', async () => {
    try {
      toast('جاري تحديث الحالات…');
      await api('/manager/api/ping-all', { method: 'POST' });
      toast('تم التحديث');
      route();
    } catch (e) { toast(e.message); }
  });

  // ---------- Router ----------
  function parseHash() {
    const raw = (location.hash.replace(/^#\/?/, '') || '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length) return { view: 'dashboard' };
    if (parts[0] === 'venues' && parts[1] === 'new') return { view: 'wizard' };
    if (parts[0] === 'venues' && parts[1]) return { view: 'detail', id: Number(parts[1]) };
    if (parts[0] === 'venues') return { view: 'venues' };
    if (parts[0] === 'errors') return { view: 'errors' };
    return { view: 'dashboard' };
  }

  function setChrome(view, title, crumb) {
    $$('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    $('#view-title').textContent = title;
    $('#crumb').textContent = crumb || 'المنصة';
    closeSidebar();
  }

  async function route() {
    const r = parseHash();
    try {
      if (r.view === 'wizard') return renderWizard();
      if (r.view === 'venues') return renderVenues();
      if (r.view === 'detail') return renderDetail(r.id);
      if (r.view === 'errors') return renderErrors();
      return renderDashboard();
    } catch (e) {
      $('#view').innerHTML = `<div class="empty"><h3>تعذر التحميل</h3><p>${esc(e.message)}</p></div>`;
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- Dashboard ----------
  async function renderDashboard() {
    setChrome('dashboard', 'الملخص', 'المنصة / نظرة عامة');
    $('#view').innerHTML = `<div class="empty">جاري تحميل الملخص…</div>`;
    const o = await api('/manager/api/overview');
    $('#env-pill').textContent = `v${o.version}`;
    const badge = $('#badge-errors');
    if (o.local.errors_open > 0) { badge.hidden = false; badge.textContent = o.local.errors_open; }
    else badge.hidden = true;

    $('#view').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">الأسطول</div><div class="v">${o.venues.total}</div><div class="s">${o.venues.connected || 0} متصل · ${o.venues.waiting || 0} بانتظار النبضة</div></div>
        <div class="stat"><div class="k">يعمل / إعداد</div><div class="v">${o.venues.live}</div><div class="s">${o.venues.setup} قيد التجهيز · ${o.venues.paused} متوقف</div></div>
        <div class="stat"><div class="k">طلبات اليوم (المحلي)</div><div class="v">${o.local.orders_today}</div><div class="s">${esc(o.local.name || '')}</div></div>
        <div class="stat"><div class="k">أخطاء مفتوحة</div><div class="v" style="color:${o.local.errors_open ? 'var(--danger)' : 'var(--ok)'}">${o.local.errors_open}</div><div class="s">${o.hub_url ? esc(o.hub_url.replace(/^https?:\/\//, '')) : (o.local.gemini_configured ? 'Gemini جاهز' : 'مفتاح Gemini غير مضبوط')}</div></div>
      </div>
      <div class="card-head"><div class="card-title">أسطول المطاعم</div><a href="#/venues">عرض الكل</a></div>
      <div class="grid-venues">
        ${o.list.map(venueCard).join('') || '<div class="empty">لا يوجد مطاعم بعد</div>'}
      </div>
    `;
    bindVenueCards();
  }

  function connPill(v) {
    const c = v.connection || {};
    const state = c.state || 'never';
    const cls = state === 'connected' || state === 'local' ? 'live'
      : state === 'stale' ? 'setup'
      : 'paused';
    return `<span class="pill ${cls}">${esc(c.label || 'بانتظار النبضة')}</span>`;
  }

  function venueCard(v) {
    const k = KIND[v.kind] || KIND.other;
    const health = v.last_health && typeof v.last_health === 'object' ? v.last_health
      : (v.last_health ? safeJson(v.last_health) : {});
    const orders = health.orders?.today;
    return `
      <article class="venue-card" data-id="${v.id}">
        <div class="row">
          <div class="venue-ico">${k.ico}</div>
          <div>
            <h3>${esc(v.name)}</h3>
            <div class="sub">${esc(v.slug)} ${v.public_url ? '· ' + esc(v.public_url.replace(/^https?:\/\//, '')) : ''}</div>
          </div>
        </div>
        <div class="venue-meta">
          ${pillStatus(v.status)}
          <span class="pill kind">${esc(k.label)}</span>
          ${v.is_local ? '<span class="pill local">هذا السيرفر</span>' : ''}
          ${connPill(v)}
        </div>
        <div class="venue-foot">
          <span>${[
            orders != null ? orders + ' طلب اليوم' : null,
            health.chats?.today != null ? health.chats.today + ' شات' : null,
            health.errors?.open ? health.errors.open + ' أخطاء' : null,
            health.version ? 'v' + health.version : null,
          ].filter(Boolean).join(' · ') || 'لا نبضة بعد'}</span>
          <span>${v.last_seen_at ? fmtDate(v.last_seen_at) : 'لم تصل نبضة بعد'}</span>
        </div>
      </article>`;
  }

  function bindVenueCards() {
    $$('.venue-card').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/venues/${el.dataset.id}`; });
    });
  }

  function safeJson(s) {
    try { return JSON.parse(s); } catch { return {}; }
  }

  // ---------- Venues ----------
  async function renderVenues() {
    setChrome('venues', 'المطاعم', 'المنصة / المطاعم');
    const list = await api('/manager/api/venues');
    $('#view').innerHTML = `
      <div class="toolbar">
        <input class="search" id="venue-search" placeholder="ابحث بالاسم أو الرابط…">
        <div style="flex:1"></div>
        <a class="btn primary" href="#/venues/new">+ إضافة</a>
      </div>
      <div class="grid-venues" id="venue-grid">
        ${list.map(venueCard).join('') || '<div class="empty"><h3>ما في مطاعم بعد</h3><p>أضف أول عميل من المعالج.</p></div>'}
      </div>
    `;
    bindVenueCards();
    $('#venue-search').addEventListener('input', (e) => {
      const q = e.target.value.trim();
      const filtered = list.filter((v) => `${v.name} ${v.slug} ${v.public_url || ''}`.includes(q));
      $('#venue-grid').innerHTML = filtered.map(venueCard).join('') || '<div class="empty">لا نتائج</div>';
      bindVenueCards();
    });
  }

  // ---------- Detail ----------
  async function renderDetail(id) {
    setChrome('venues', 'تفاصيل المطعم', 'المنصة / المطاعم');
    $('#view').innerHTML = `<div class="empty">جاري التحميل…</div>`;
    const packed = await api(`/manager/api/venues/${id}/snapshot`);
    let v = packed.venue || await api(`/manager/api/venues/${id}?secrets=1`);
    if (!v.kit) v = await api(`/manager/api/venues/${id}?secrets=1`);
    let snap = packed.snapshot || v.last_health || {};
    const k = KIND[v.kind] || KIND.other;
    const chatbot = snap.chatbot || {};
    $('#view-title').textContent = v.name;

    let errorsHtml = '<div class="hint">جاري جلب الأخطاء…</div>';
    $('#view').innerHTML = detailHtml(v, k, snap, chatbot, errorsHtml);
    wireDetail(v, snap);

    try {
      const errs = await api(`/manager/api/venues/${id}/errors?limit=40&only_open=true`);
      $('#venue-errors').innerHTML = renderErrorList(errs, v.id);
      wireErrors(v.id);
    } catch (e) {
      $('#venue-errors').innerHTML = `<div class="hint">${esc(e.message)}</div>`;
    }
  }

  function connBanner(snap, v) {
    const c = (snap && snap.connection) || v.connection || {};
    const state = c.state || 'never';
    if (state === 'connected' || state === 'local') {
      const via = snap.via === 'heartbeat' ? ' عبر نبضة الوكيل' : (snap.probed_url ? ` عبر <span class="mono">${esc(snap.probed_url)}</span>` : '');
      const ident = snap.identity_queued ? '<div class="hint">الهوية بالطابور — تتنفّذ عند النبضة الجاية.</div>' : (snap.identity_applied ? '<div class="hint">تم دفع الاسم والألوان إلى النسخة.</div>' : '');
      return `<div class="conn-banner ok"><strong>${esc(c.label || 'متصل')}</strong>${via}${c.age_sec != null ? ` · آخر نبضة قبل ${c.age_sec} ث` : ''}${ident}</div>`;
    }
    if (state === 'stale') {
      return `<div class="conn-banner warn"><strong>تأخرت النبضة</strong><p>آخر ظهور ${esc(fmtDate(v.last_seen_at))}. تأكد أن الحاوية شغّالة على VPS الزبون.</p></div>`;
    }
    return `<div class="conn-banner bad">
      <strong>بانتظار النبضة</strong>
      <p>انسخ الأمر الواحد أدناه، شغّله على VPS الزبون، واستنى «متصل». الموقع يبعث للمنصة خلال ~30 ثانية — بدون ما المنصة تطرق سيرفره.</p>
      <p class="hint">HUB_URL على نسخة الزبون لازم يساوي رابط لوحة المنصة، و MANAGER_TOKEN يطابق السجل.</p>
    </div>`;
  }

  function detailHtml(v, k, snap, chatbot, errorsHtml) {
    const meta = v.meta || {};
    const itemsTotal = snap.items?.total;
    const conn = v.connection || snap.connection || {};
    return `
      ${connBanner(snap, v)}
      ${installCard(v, conn)}
      <div class="detail-hero">
        <div>
          <div class="venue-meta" style="margin-bottom:8px">
            ${pillStatus(v.status)}
            <span class="pill kind">${esc(k.label)}</span>
            ${v.is_local ? '<span class="pill local">هذا السيرفر</span>' : ''}
            ${connPill(v)}
          </div>
          <h3>${esc(v.name)}</h3>
          <div class="sub" style="color:var(--muted)">${esc(v.name_en || '')} · ${esc(v.slug)}</div>
        </div>
        <div class="top-actions">
          ${v.public_url ? `<a class="btn ghost" href="${esc(v.public_url)}" target="_blank" rel="noopener">الموقع</a>` : ''}
          ${v.public_url ? `<a class="btn ghost" href="${esc(v.public_url)}/admin" target="_blank" rel="noopener">لوحة المطعم</a>` : (v.is_local ? '<a class="btn ghost" href="/admin" target="_blank">لوحة المطعم</a>' : '')}
          <button class="btn ghost" id="btn-probe">فحص الموقع</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="k">طلبات اليوم</div><div class="v">${snap.orders?.today ?? '—'}</div></div>
        <div class="stat"><div class="k">محادثات اليوم</div><div class="v">${snap.chats?.today ?? '—'}</div></div>
        <div class="stat"><div class="k">توكنات اليوم</div><div class="v">${((snap.chats?.tokens_in_today||0)+(snap.chats?.tokens_out_today||0)) || '—'}</div></div>
        <div class="stat"><div class="k">أصناف المنيو</div><div class="v">${itemsTotal ?? '—'}</div></div>
      </div>

      <div class="card">
        <div class="card-title">السيرفر</div>
        <div class="kv" style="margin-top:12px">
          <div class="k">الرابط</div><div>${v.public_url ? esc(v.public_url) : '— لم يُضبط'}</div>
          <div class="k">HUB_URL</div><div class="mono">${esc(v.kit?.hub_url || '— اضبط HUB_PUBLIC_URL على المنصة')}</div>
          <div class="k">منفذ الحاوية</div><div>${v.suggested_port ?? '8080'}</div>
          <div class="k">النبضة</div><div>${esc(conn.label || '—')}${conn.age_sec != null ? ' · ' + conn.age_sec + ' ث' : ''}</div>
          <div class="k">الإصدار</div><div>${esc(snap.version || '—')}</div>
          <div class="k">Gemini</div><div>${snap.gemini_configured == null ? '—' : (snap.gemini_configured ? 'مضبوط' : 'ناقص')}</div>
          <div class="k">الاسم على النسخة</div><div>${esc(snap.restaurant_name || '—')}</div>
          <div class="k">آخر ظهور</div><div>${fmtDate(v.last_seen_at)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">بيانات المطعم</div></div>
        <div class="form-grid" id="venue-edit">
          <div class="field"><label>الاسم</label><input data-f="name" value="${esc(v.name)}"></div>
          <div class="field"><label>English</label><input data-f="name_en" value="${esc(v.name_en || '')}"></div>
          <div class="field"><label>الحالة</label>
            <select data-f="status">${Object.entries(STATUS).map(([k,l]) => `<option value="${k}" ${v.status===k?'selected':''}>${l}</option>`).join('')}</select>
          </div>
          <div class="field"><label>الخطة</label>
            <select data-f="plan">${['starter','pro','custom'].map(p => `<option ${v.plan===p?'selected':''}>${p}</option>`).join('')}</select>
          </div>
          <div class="field full"><label>دومين الموقع العام</label><input data-f="public_url" dir="ltr" placeholder="https://ahmadrestaurant.com" value="${esc(v.public_url || '')}"></div>
          <div class="field"><label>منفذ الحاوية على الـ VPS</label><input data-f="suggested_port" dir="ltr" inputmode="numeric" placeholder="8080" value="${esc(v.suggested_port || '')}"></div>
          <div class="field"><label>ملاحظات الاستضافة</label><input data-f="server_host" dir="ltr" placeholder="اختياري" value="${esc(v.server_host || '')}"></div>
          <div class="field"><label>اسم المسؤول</label><input data-f="contact_name" value="${esc(v.contact_name || '')}"></div>
          <div class="field"><label>هاتف المسؤول</label><input data-f="contact_phone" value="${esc(v.contact_phone || '')}"></div>
          <div class="field full"><label>ملاحظات داخلية</label><textarea data-f="notes">${esc(v.notes || '')}</textarea></div>
        </div>
        <div class="wizard-nav"><span></span><button class="btn primary" id="save-venue">حفظ البيانات</button></div>
      </div>

      <div class="card">
        <div class="card-title">هوية المطعم على النسخة</div>
        <p class="hint" style="margin:8px 0 12px">الاسم والألوان تروح للنسخة الشغّالة. الشعار يرفعه صاحب المطعم من /admin → الإعدادات.</p>
        <div class="form-grid" id="ident-edit">
          <div class="field full"><label>سطر تعريفي</label><input id="ident-tagline" value="${esc(meta.tagline || '')}" placeholder="أهلاً بكم"></div>
          <div class="field"><label>اللون</label><input id="ident-primary" type="color" value="${esc(meta.primary_color || snap.theme?.primary || '#1e3a5f')}"></div>
          <div class="field"><label>اللون الداكن</label><input id="ident-dark" type="color" value="${esc(meta.primary_color_dark || snap.theme?.primary_dark || '#0f2744')}"></div>
        </div>
        <div class="wizard-nav">
          <span class="hint">إذا الموقع مش واصل من هون، الأمر ينحفظ ويتنفّذ عند النبضة.</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${v.is_local ? '' : '<button class="btn ghost" id="reset-catalog">إفراغ منيو القالب</button>'}
            <button class="btn primary" id="apply-ident">دفع الهوية للنسخة</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">إعدادات الشات بوت (تقنية)</div>
        <p class="hint" style="margin:8px 0 12px">صاحب المطعم يقدر يغيّر رسالة الترحيب من لوحته. الموديل والتعليمات هون.</p>
        <div class="form-grid" id="bot-edit">
          <div class="field check" style="flex-direction:row;align-items:center;gap:8px">
            <input type="checkbox" id="bot-enabled" ${chatbot.enabled ? 'checked' : ''}>
            <label for="bot-enabled">مفعّل</label>
          </div>
          <div class="field"><label>الموديل</label><input id="bot-model" value="${esc(chatbot.model || '')}"></div>
          <div class="field"><label>Temperature</label><input id="bot-temp" type="number" step="0.05" min="0" max="1" value="${esc(chatbot.temperature || '0.35')}"></div>
          <div class="field"><label>Thinking</label>
            <select id="bot-think">${['minimal','low','medium','high'].map(x => `<option ${String(chatbot.thinking||'minimal').toLowerCase()===x?'selected':''}>${x}</option>`).join('')}</select>
          </div>
          <div class="field"><label>حد الإخراج</label><input id="bot-max" type="number" value="${esc(chatbot.max_tokens || '800')}"></div>
          <div class="field full"><label>رسالة الترحيب</label><textarea id="bot-welcome">${esc(chatbot.welcome || '')}</textarea></div>
          <div class="field full"><label>System prompt</label><textarea id="bot-sys" style="min-height:140px;font-family:ui-monospace,monospace;font-size:.82rem;direction:ltr;text-align:left">${esc(chatbot.system_prompt || '')}</textarea></div>
        </div>
        <div class="wizard-nav"><span class="hint">يُحفظ على النسخة مباشرة أو بالطابور حتى النبضة الجاية</span>
          <button class="btn primary" id="save-bot">حفظ إعدادات البوت</button></div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">أخطاء هذا المطعم</div></div>
        <div id="venue-errors">${errorsHtml}</div>
      </div>

      ${v.is_local ? '' : `
      <div class="card">
        <div class="card-head">
          <div class="card-title">ملفات النشر</div>
          <button class="btn ghost small" id="regen-token">توليد توكن جديد</button>
        </div>
        <p class="hint">نفس محتوى الأمر الواحد، ملفات منفصلة إذا بدك تنسخهم يدوياً.</p>
        <div class="kv" style="margin:12px 0">
          <div class="k">ADMIN_PASSWORD</div><div class="mono">${esc(v.admin_password || '')} <button class="btn small ghost" data-copy="${esc(v.admin_password || '')}">نسخ</button></div>
          <div class="k">MANAGER_TOKEN</div><div class="mono">${esc(v.manager_token || '')} <button class="btn small ghost" data-copy="${esc(v.manager_token || '')}">نسخ</button></div>
        </div>
        <div class="card-head"><span class="hint">.env</span><button class="btn small ghost" data-copy-pre="kit-env">نسخ</button></div>
        <pre class="kit" id="kit-env">${esc(v.kit?.env || '')}</pre>
        <div class="card-head"><span class="hint">docker-compose.yml</span><button class="btn small ghost" data-copy-pre="kit-compose">نسخ</button></div>
        <pre class="kit" id="kit-compose">${esc(v.kit?.compose || '')}</pre>
        <div class="card-head"><span class="hint">bootstrap.sh</span><button class="btn small ghost" data-copy-pre="kit-bootstrap">نسخ</button></div>
        <pre class="kit" id="kit-bootstrap">${esc(v.kit?.bootstrap || '')}</pre>
        <button class="btn danger" id="delete-venue" style="margin-top:12px">حذف من السجل</button>
      </div>`}
    `;
  }

  function installCard(v, conn) {
    if (v.is_local || !v.kit) return '';
    const waiting = !conn || conn.state === 'never';
    return `
      <div class="card install-card ${waiting ? 'awaiting' : ''}">
        <div class="card-head">
          <div class="card-title">${waiting ? 'أمر واحد على VPS الزبون' : 'إعادة تشغيل الحزمة'}</div>
          <button class="btn primary" data-copy-pre="kit-oneshot">نسخ الأمر</button>
        </div>
        <p class="hint">الصق الأمر على سيرفر الزبون. يثبت Docker إن لزم، يرفع الحاوية، والوكيل يبعث نبضة للمنصة خلال ~30 ثانية — بدون ما المنصة تطرق سيرفره.</p>
        ${v.kit.hub_url ? '' : '<p class="hint" style="color:var(--warn)">HUB_PUBLIC_URL غير مضبوط على المنصة — النبضة ما رح توصل حتى تحط رابط اللوحة.</p>'}
        <pre class="kit one-shot" id="kit-oneshot">${esc(v.kit.one_shot || '')}</pre>
      </div>`;
  }

  function wireDetail(v) {
    $('#btn-probe').addEventListener('click', async () => {
      toast('جاري فحص الموقع…');
      try {
        await api(`/manager/api/venues/${v.id}/probe`, { method: 'POST' });
      } catch (e) { toast(e.message); }
      renderDetail(v.id);
    });
    $('#save-venue').addEventListener('click', async () => {
      const payload = {};
      $$('#venue-edit [data-f]').forEach((el) => { payload[el.dataset.f] = el.value; });
      if ('suggested_port' in payload) {
        const n = Number(payload.suggested_port);
        if (!payload.suggested_port || Number.isNaN(n)) delete payload.suggested_port;
        else payload.suggested_port = n;
      }
      try {
        await api(`/manager/api/venues/${v.id}`, { method: 'PATCH', body: payload });
        toast('تم حفظ بيانات المطعم');
        renderDetail(v.id);
      } catch (e) { toast(e.message); }
    });
    $('#apply-ident')?.addEventListener('click', async () => {
      try {
        await api(`/manager/api/venues/${v.id}`, {
          method: 'PATCH',
          body: {
            meta: {
              tagline: $('#ident-tagline')?.value?.trim() || '',
              primary_color: $('#ident-primary')?.value || '',
              primary_color_dark: $('#ident-dark')?.value || '',
            },
          },
        });
        const r = await api(`/manager/api/venues/${v.id}/apply-identity`, { method: 'POST' });
        toast(r.queued ? 'الهوية بالطابور — تتنفّذ عند النبضة' : 'تم دفع الهوية للنسخة');
        renderDetail(v.id);
      } catch (e) { toast(e.message); }
    });
    $('#reset-catalog')?.addEventListener('click', async () => {
      if (!confirm('هذا يحذف أصناف وفئات القالب من النسخة. الطلبات ما بتنحذف. متابعة؟')) return;
      try {
        const r = await api(`/manager/api/venues/${v.id}/reset-catalog`, { method: 'POST' });
        toast(r.queued ? 'الأمر بالطابور — تتنفّذ عند النبضة' : `تم إفراغ المنيو (${r.items || 0} صنف)`);
        renderDetail(v.id);
      } catch (e) { toast(e.message); }
    });
    $('#save-bot').addEventListener('click', async () => {
      try {
        const r = await api(`/manager/api/venues/${v.id}/settings`, {
          method: 'PATCH',
          body: { settings: {
            chatbot_enabled: $('#bot-enabled').checked ? 'true' : 'false',
            chatbot_model: $('#bot-model').value,
            chatbot_temperature: $('#bot-temp').value,
            chatbot_thinking_budget: $('#bot-think').value,
            chatbot_max_tokens: $('#bot-max').value,
            chatbot_welcome: $('#bot-welcome').value,
            chatbot_system_prompt: $('#bot-sys').value,
          }},
        });
        toast(r.queued ? 'الإعدادات بالطابور — تتنفّذ عند النبضة' : 'تم حفظ إعدادات البوت');
      } catch (e) { toast(e.message); }
    });
    $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
    $$('[data-copy-pre]').forEach((b) => b.addEventListener('click', () => copy($('#' + b.dataset.copyPre).innerText)));
    $('#regen-token')?.addEventListener('click', async () => {
      if (!confirm('سيحتاج العميل تحديث MANAGER_TOKEN على سيرفره. متابعة؟')) return;
      try {
        await api(`/manager/api/venues/${v.id}/regenerate-token`, { method: 'POST' });
        toast('تم توليد توكن جديد');
        renderDetail(v.id);
      } catch (e) { toast(e.message); }
    });
    $('#delete-venue')?.addEventListener('click', async () => {
      if (!confirm('حذف هذا المطعم من سجل المنصة؟ النسخة على سيرفره ما بتنحذف.')) return;
      try {
        await api(`/manager/api/venues/${v.id}`, { method: 'DELETE' });
        location.hash = '#/venues';
        toast('تم الحذف');
      } catch (e) { toast(e.message); }
    });
  }

  function renderErrorList(errors, venueId) {
    if (!errors.length) return '<div class="empty">لا يوجد أخطاء مفتوحة 🎉</div>';
    return errors.map((e) => `
      <div class="error-item">
        <div class="meta">
          <span>${esc(fmtDate(e.created_at))}</span>
          <span class="pill paused">${esc(e.source || 'server')}</span>
          ${e.path ? `<span>${esc(e.path)}</span>` : ''}
        </div>
        <div class="message">${esc(e.message)}</div>
        ${e.details ? `<details><summary>تفاصيل</summary><pre>${esc(e.details)}</pre></details>` : ''}
        ${!e.resolved ? `<button class="btn small ghost" data-resolve="${e.id}" data-venue="${venueId}">تحديد كمحلول</button>` : ''}
      </div>`).join('');
  }

  function wireErrors(venueId) {
    $$('[data-resolve]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await api(`/manager/api/venues/${b.dataset.venue}/errors/${b.dataset.resolve}/resolve`, { method: 'POST' });
          toast('تم');
          if (venueId) renderDetail(venueId);
          else renderErrors();
        } catch (e) { toast(e.message); }
      });
    });
  }

  // ---------- Errors (hub) ----------
  async function renderErrors() {
    setChrome('errors', 'أخطاء هذا السيرفر', 'المنصة / المراقبة');
    const errors = await api('/manager/api/errors?limit=150&only_open=true');
    const badge = $('#badge-errors');
    if (errors.length) { badge.hidden = false; badge.textContent = errors.length; }
    else badge.hidden = true;
    const local = (await api('/manager/api/venues')).find((v) => v.is_local);
    $('#view').innerHTML = `
      <p class="hint" style="margin-bottom:14px">هذه أخطاء النسخة المحلية (الـ hub). لأخطاء عميل بعيد افتح بطاقة المطعم.</p>
      <div class="card">
        <div class="card-title">${errors.length} خطأ مفتوح</div>
        <div style="margin-top:12px">${renderErrorList(errors, local?.id)}</div>
      </div>
    `;
    if (local) wireErrors(local.id);
  }

  // ---------- Wizard ----------
  function blankWizard() {
    return {
      step: 0,
      kind: 'restaurant',
      name: '',
      name_en: '',
      tagline: '',
      contact_name: '',
      contact_phone: '',
      notes: '',
      mode: 'new',
      public_url: '',
      manager_token: '',
      suggested_port: '',
      welcome: '',
      model: 'gemini-3.6-flash',
      primary: '#1e3a5f',
      primary_dark: '#0f2744',
      currency: '₪',
    };
  }

  function renderWizard() {
    setChrome('wizard', 'إضافة مطعم', 'المنصة / معالج الإعداد');
    if (!state.wizard) state.wizard = blankWizard();
    const w = state.wizard;
    const step = w.step;
    $('#view').innerHTML = `
      <div class="card">
        <div class="wizard-steps">
          ${WIZARD_STEPS.map((t, i) => `<span class="${i <= step ? 'on' : ''}">${i + 1}. ${t}</span>`).join('')}
        </div>
        <div class="wizard-progress">${WIZARD_STEPS.map((_, i) => `<div class="step ${i <= step ? 'on' : ''}"></div>`).join('')}</div>
        <div id="wiz-body"></div>
        <div class="wizard-nav">
          <button class="btn ghost" id="wiz-back" ${step === 0 ? 'disabled' : ''}>رجوع</button>
          <button class="btn primary" id="wiz-next">${step === WIZARD_STEPS.length - 1 ? 'إنشاء المطعم' : 'التالي'}</button>
        </div>
      </div>
    `;
    renderWizStep();
    $('#wiz-back').addEventListener('click', () => { w.step = Math.max(0, w.step - 1); renderWizard(); });
    $('#wiz-next').addEventListener('click', onWizNext);
  }

  function renderWizStep() {
    const w = state.wizard;
    const box = $('#wiz-body');
    if (w.step === 0) {
      box.innerHTML = `
        <p class="hint" style="margin-bottom:12px">شو نوع النشاط؟ بعدين الاسم التجاري.</p>
        <div class="choice-grid" id="kind-grid">
          ${Object.entries(KIND).map(([key, val]) => `
            <button type="button" class="choice ${w.kind === key ? 'on' : ''}" data-kind="${key}">
              <strong>${val.ico} ${val.label}</strong>
              <span>يظهر في السجل والفلاتر</span>
            </button>`).join('')}
        </div>
        <div class="form-grid" style="margin-top:16px">
          <div class="field"><label>الاسم بالعربي</label><input id="w-name" value="${esc(w.name)}" placeholder="مثلاً: مطعم السعادة"></div>
          <div class="field"><label>الاسم بالإنجليزي (للرابط)</label><input id="w-name-en" dir="ltr" value="${esc(w.name_en)}" placeholder="Al Saada"></div>
          <div class="field full"><label>سطر تعريفي</label><input id="w-tagline" value="${esc(w.tagline)}" placeholder="أهلاً بكم — نكهتنا غير"></div>
          <div class="field"><label>اسم المسؤول</label><input id="w-contact" value="${esc(w.contact_name)}" placeholder="اختياري"></div>
          <div class="field"><label>الهاتف</label><input id="w-phone" value="${esc(w.contact_phone)}" placeholder="اختياري"></div>
        </div>`;
      $$('#kind-grid .choice').forEach((b) => b.addEventListener('click', () => {
        w.kind = b.dataset.kind;
        $$('#kind-grid .choice').forEach((x) => x.classList.toggle('on', x === b));
      }));
    } else if (w.step === 1) {
      box.innerHTML = `
        <p class="hint" style="margin-bottom:12px">نفس قالب الموقع (QR، شات، سلة، إدارة) بدون منيو أو لوجو باربيكيو. الألوان هون، الشعار بعد التشغيل من لوحة المطعم.</p>
        <div class="swatch-grid" id="palette-grid">
          ${PALETTES.map((p) => `
            <button type="button" class="swatch ${w.primary === p.primary ? 'on' : ''}" data-primary="${p.primary}" data-dark="${p.dark}">
              <span class="swatch-chip" style="background:${p.primary}"></span>
              <span>${p.label}</span>
            </button>`).join('')}
        </div>
        <div class="brand-preview" style="--preview:${esc(w.primary)};--preview-dark:${esc(w.primary_dark)}">
          <div class="bp-mark">${esc((w.name || 'م').trim()[0] || 'م')}</div>
          <div>
            <div class="bp-name">${esc(w.name || 'اسم المطعم')}</div>
            <div class="bp-tag">${esc(w.tagline || w.name_en || 'سطر تعريفي')}</div>
          </div>
        </div>
        <div class="form-grid" style="margin-top:16px">
          <div class="field"><label>لون مخصص</label><input id="w-primary" type="color" value="${esc(w.primary)}"></div>
          <div class="field"><label>اللون الداكن</label><input id="w-dark" type="color" value="${esc(w.primary_dark)}"></div>
          <div class="field"><label>العملة</label><input id="w-currency" value="${esc(w.currency)}" placeholder="₪"></div>
          <div class="field full"><label>ملاحظات داخلية</label><textarea id="w-notes" placeholder="اتفاق، سعر الخطة، موعد التسليم…">${esc(w.notes)}</textarea></div>
        </div>`;
      $$('#palette-grid .swatch').forEach((b) => b.addEventListener('click', () => {
        w.primary = b.dataset.primary;
        w.primary_dark = b.dataset.dark;
        renderWizard();
      }));
      $('#w-primary')?.addEventListener('input', (e) => { w.primary = e.target.value; });
      $('#w-dark')?.addEventListener('input', (e) => { w.primary_dark = e.target.value; });
    } else if (w.step === 2) {
      box.innerHTML = `
        <p class="hint" style="margin-bottom:12px">كل مطعم على VPS ودومين لحاله. المنصة ما بضيف الموقع عندك — النسخة تبعث نبضة للمنصة.</p>
        <div class="choice-grid">
          <button type="button" class="choice ${w.mode === 'new' ? 'on' : ''}" data-mode="new">
            <strong>عميل جديد — حزمة نشر</strong>
            <span>توليد توكن + compose + أمر واحد تشغّله على VPS الزبون</span>
          </button>
          <button type="button" class="choice ${w.mode === 'connect' ? 'on' : ''}" data-mode="connect">
            <strong>نسخة قائمة — ربط</strong>
            <span>عنده موقع شغّال. حط الدومين و MANAGER_TOKEN واستنى النبضة</span>
          </button>
        </div>
        <div class="form-grid" style="margin-top:16px">
          <div class="field full"><label>دومين الموقع</label>
            <input id="w-url" dir="ltr" value="${esc(w.public_url)}" placeholder="https://ahmadrestaurant.com">
            <span class="hint">هذا PUBLIC_URL عند الزبون (QR والموقع). Cloudflare يقدر يقف قدامه.</span>
          </div>
          <div class="field"><label>منفذ الحاوية على الـ VPS</label>
            <input id="w-port" dir="ltr" inputmode="numeric" value="${esc(w.suggested_port)}" placeholder="8080">
            <span class="hint">HOST_PORT. غالباً 80 أو 8080 خلف Nginx/Cloudflare</span>
          </div>
          <div class="field full ${w.mode === 'connect' ? '' : 'hidden'}" id="w-token-wrap">
            <label>MANAGER_TOKEN الموجود على سيرفره</label>
            <input id="w-token" dir="ltr" value="${esc(w.manager_token)}" placeholder="الصق التوكن">
          </div>
        </div>`;
      $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
        w.mode = b.dataset.mode;
        collectWiz();
        renderWizard();
      }));
    } else if (w.step === 3) {
      box.innerHTML = `
        <p class="hint" style="margin-bottom:12px">قيم ابتدائية للشات. المنيو بيبدأ فاضي — صاحب المطعم يضيف الأصناف من لوحته.</p>
        <div class="form-grid">
          <div class="field"><label>موديل Gemini الابتدائي</label><input id="w-model" dir="ltr" value="${esc(w.model)}"></div>
          <div class="field full"><label>رسالة ترحيب مقترحة</label>
            <textarea id="w-welcome" placeholder="أهلاً! أنا مساعد المطعم…">${esc(w.welcome)}</textarea>
          </div>
        </div>`;
    } else {
      box.innerHTML = `
        <div class="kv">
          <div class="k">النوع</div><div>${esc((KIND[w.kind] || {}).label)}</div>
          <div class="k">الاسم</div><div>${esc(w.name)}</div>
          <div class="k">الهوية</div><div><span class="swatch-chip" style="background:${esc(w.primary)};display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:middle"></span> ${esc(w.tagline || '—')}</div>
          <div class="k">المنيو</div><div>قالب فارغ — بدون أصناف باربيكيو</div>
          <div class="k">الاستضافة</div><div>${w.mode === 'connect' ? 'ربط نسخة قائمة' : 'حزمة نشر على VPS الزبون'}</div>
          <div class="k">الدومين</div><div>${esc(w.public_url || '— يُضاف مع الحزمة')}</div>
          <div class="k">المنفذ</div><div>${esc(w.suggested_port || '8080')}</div>
        </div>
        <p class="hint" style="margin-top:14px">بعد الإنشاء تظهر بطاقة فيها أمر واحد: انسخه → شغّله على VPS الزبون → استنى «متصل».</p>`;
    }
  }

  function collectWiz() {
    const w = state.wizard;
    const val = (id) => $(id)?.value?.trim() ?? w[id.replace('#w-', '').replace(/-/g, '_')];
    if ($('#w-name')) w.name = $('#w-name').value.trim();
    if ($('#w-name-en')) w.name_en = $('#w-name-en').value.trim();
    if ($('#w-tagline')) w.tagline = $('#w-tagline').value.trim();
    if ($('#w-contact')) w.contact_name = $('#w-contact').value.trim();
    if ($('#w-phone')) w.contact_phone = $('#w-phone').value.trim();
    if ($('#w-notes')) w.notes = $('#w-notes').value.trim();
    if ($('#w-url')) w.public_url = $('#w-url').value.trim();
    if ($('#w-port')) w.suggested_port = $('#w-port').value.trim();
    if ($('#w-token')) w.manager_token = $('#w-token').value.trim();
    if ($('#w-model')) w.model = $('#w-model').value.trim();
    if ($('#w-welcome')) w.welcome = $('#w-welcome').value.trim();
    if ($('#w-primary')) w.primary = $('#w-primary').value;
    if ($('#w-dark')) w.primary_dark = $('#w-dark').value;
    if ($('#w-currency')) w.currency = $('#w-currency').value.trim() || '₪';
    return val;
  }

  async function onWizNext() {
    const w = state.wizard;
    collectWiz();
    if (w.step === 0 && !w.name) { toast('الاسم مطلوب'); return; }
    if (w.step === 2 && w.mode === 'connect' && !w.manager_token) {
      toast('التوكن مطلوب للربط'); return;
    }
    if (w.step === 2 && w.public_url && !/^https?:\/\//i.test(w.public_url)) {
      w.public_url = 'https://' + w.public_url;
    }
    if (w.step === 2 && !w.public_url) {
      toast('دومين الموقع مطلوب (مثلاً https://ahmadrestaurant.com)'); return;
    }
    if (w.step < WIZARD_STEPS.length - 1) {
      w.step += 1;
      renderWizard();
      return;
    }
    const btn = $('#wiz-next');
    btn.disabled = true;
    btn.textContent = 'جاري الإنشاء…';
    try {
      const created = await api('/manager/api/venues', {
        method: 'POST',
        body: {
          name: w.name,
          name_en: w.name_en || null,
          kind: w.kind,
          public_url: w.public_url || null,
          contact_name: w.contact_name || null,
          contact_phone: w.contact_phone || null,
          notes: w.notes || null,
          manager_token: w.mode === 'connect' ? w.manager_token : null,
          connect_existing: w.mode === 'connect',
          suggested_port: w.suggested_port ? Number(w.suggested_port) : null,
          meta: {
            welcome: w.welcome,
            model: w.model,
            tagline: w.tagline,
            primary_color: w.primary,
            primary_color_dark: w.primary_dark,
            currency: w.currency,
          },
        },
      });
      state.wizard = null;
      toast(w.mode === 'connect' ? 'تم الربط — بانتظار النبضة' : 'تم الإنشاء — انسخ الأمر إلى VPS الزبون');
      location.hash = `#/venues/${created.venue.id}`;
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.textContent = 'إنشاء المطعم';
    }
  }

  checkAuth();
})();
