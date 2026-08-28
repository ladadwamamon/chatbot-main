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

  const WIZARD_STEPS = ['النشاط', 'التواصل', 'الاستضافة', 'الشات بوت', 'المراجعة'];

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
    setTimeout(() => el.classList.add('hidden'), 2400);
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
      toast('جاري فحص السيرفرات…');
      await api('/manager/api/ping-all', { method: 'POST' });
      toast('تم الفحص');
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
        <div class="stat"><div class="k">المطاعم</div><div class="v">${o.venues.total}</div><div class="s">${o.venues.live} يعمل · ${o.venues.setup} إعداد</div></div>
        <div class="stat"><div class="k">طلبات اليوم (المحلي)</div><div class="v">${o.local.orders_today}</div><div class="s">${esc(o.local.name || '')}</div></div>
        <div class="stat"><div class="k">محادثات اليوم</div><div class="v">${o.local.chats_today}</div><div class="s">${o.local.tokens_today} توكن</div></div>
        <div class="stat"><div class="k">أخطاء مفتوحة</div><div class="v" style="color:${o.local.errors_open ? 'var(--danger)' : 'var(--ok)'}">${o.local.errors_open}</div><div class="s">${o.local.gemini_configured ? 'Gemini جاهز' : 'مفتاح Gemini غير مضبوط'}</div></div>
      </div>
      <div class="card-head"><div class="card-title">الحالات</div><a href="#/venues">عرض الكل</a></div>
      <div class="grid-venues">
        ${o.list.map(venueCard).join('') || '<div class="empty">لا يوجد مطاعم بعد</div>'}
      </div>
    `;
    bindVenueCards();
  }

  function venueCard(v) {
    const k = KIND[v.kind] || KIND.other;
    const health = v.last_health && typeof v.last_health === 'object' ? v.last_health
      : (v.last_health ? safeJson(v.last_health) : {});
    const unreachable = health && health.unreachable;
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
          ${unreachable ? '<span class="pill paused">غير متصل</span>' : ''}
        </div>
        <div class="venue-foot">
          <span>${v.last_latency_ms != null ? v.last_latency_ms + 'ms' : 'لم يُفحص'}</span>
          <span>${v.last_seen_at ? fmtDate(v.last_seen_at) : ''}</span>
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
    const v = await api(`/manager/api/venues/${id}?secrets=1`);
    let snap = {};
    try {
      const p = await api(`/manager/api/venues/${id}/probe`, { method: 'POST' });
      snap = p.snapshot || {};
    } catch (e) {
      snap = { ok: false, error: e.message, unreachable: true };
    }
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

  function detailHtml(v, k, snap, chatbot, errorsHtml) {
    const ok = !!snap.ok;
    return `
      <div class="detail-hero">
        <div>
          <div class="venue-meta" style="margin-bottom:8px">
            ${pillStatus(v.status)}
            <span class="pill kind">${esc(k.label)}</span>
            ${v.is_local ? '<span class="pill local">هذا السيرفر</span>' : ''}
            <span class="pill ${ok ? 'live' : 'paused'}">${ok ? 'متصل' : 'غير متصل'}</span>
          </div>
          <h3>${esc(v.name)}</h3>
          <div class="sub" style="color:var(--muted)">${esc(v.name_en || '')} · ${esc(v.slug)}</div>
        </div>
        <div class="top-actions">
          ${v.public_url ? `<a class="btn ghost" href="${esc(v.public_url)}" target="_blank" rel="noopener">الموقع</a>` : ''}
          ${v.public_url ? `<a class="btn ghost" href="${esc(v.public_url)}/admin" target="_blank" rel="noopener">لوحة المطعم</a>` : (v.is_local ? '<a class="btn ghost" href="/admin" target="_blank">لوحة المطعم</a>' : '')}
          <button class="btn ghost" id="btn-probe">إعادة الفحص</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="k">طلبات اليوم</div><div class="v">${snap.orders?.today ?? '—'}</div></div>
        <div class="stat"><div class="k">محادثات اليوم</div><div class="v">${snap.chats?.today ?? '—'}</div></div>
        <div class="stat"><div class="k">توكنات اليوم</div><div class="v">${((snap.chats?.tokens_in_today||0)+(snap.chats?.tokens_out_today||0)) || '—'}</div></div>
        <div class="stat"><div class="k">أخطاء مفتوحة</div><div class="v">${snap.errors?.open ?? '—'}</div></div>
      </div>

      <div class="card">
        <div class="card-title">السيرفر</div>
        <div class="kv" style="margin-top:12px">
          <div class="k">الرابط</div><div>${v.public_url ? esc(v.public_url) : '— غير مربوط'}</div>
          <div class="k">الاستجابة</div><div>${snap.latency_ms != null ? snap.latency_ms + ' ms' : '—'}</div>
          <div class="k">الإصدار</div><div>${esc(snap.version || '—')}</div>
          <div class="k">Gemini</div><div>${snap.gemini_configured == null ? '—' : (snap.gemini_configured ? 'مضبوط' : 'ناقص')}</div>
          <div class="k">آخر ظهور</div><div>${fmtDate(v.last_seen_at)}</div>
          <div class="k">ملاحظة</div><div>${esc(snap.error || v.notes || '—')}</div>
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
          <div class="field full"><label>رابط السيرفر العام</label><input data-f="public_url" dir="ltr" placeholder="https://pizza.example.com" value="${esc(v.public_url || '')}"></div>
          <div class="field"><label>اسم المسؤول</label><input data-f="contact_name" value="${esc(v.contact_name || '')}"></div>
          <div class="field"><label>هاتف المسؤول</label><input data-f="contact_phone" value="${esc(v.contact_phone || '')}"></div>
          <div class="field full"><label>ملاحظات داخلية</label><textarea data-f="notes">${esc(v.notes || '')}</textarea></div>
        </div>
        <div class="wizard-nav"><span></span><button class="btn primary" id="save-venue">حفظ البيانات</button></div>
      </div>

      <div class="card">
        <div class="card-title">إعدادات الشات بوت (تقنية)</div>
        <p class="hint" style="margin:8px 0 12px">صاحب المطعم يقدر يغيّر رسالة الترحيب من لوحته. الموديل والتعليمات هون.</p>
        <div class="form-grid" id="bot-edit">
          <div class="field check" style="flex-direction:row;align-items:center;gap:8px">
            <input type="checkbox" id="bot-enabled" ${chatbot.enabled ? 'checked' : ''} ${ok || v.is_local ? '' : 'disabled'}>
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
        <div class="wizard-nav"><span class="hint">${ok || v.is_local ? '' : 'اربط السيرفر أولاً حتى ينحفظ على النسخة البعيدة'}</span>
          <button class="btn primary" id="save-bot" ${ok || v.is_local ? '' : 'disabled'}>حفظ إعدادات البوت</button></div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">أخطاء هذا المطعم</div></div>
        <div id="venue-errors">${errorsHtml}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">بيانات النشر</div>
          ${v.is_local ? '' : '<button class="btn ghost small" id="regen-token">توليد توكن جديد</button>'}
        </div>
        <p class="hint">انسخها إلى Portainer لهذا العميل. لا تشاركها مع الزبائن.</p>
        <div class="kv" style="margin:12px 0">
          <div class="k">ADMIN_PASSWORD</div><div class="mono">${esc(v.admin_password || '')} <button class="btn small ghost" data-copy="${esc(v.admin_password || '')}">نسخ</button></div>
          <div class="k">MANAGER_TOKEN</div><div class="mono">${esc(v.manager_token || '')} <button class="btn small ghost" data-copy="${esc(v.manager_token || '')}">نسخ</button></div>
        </div>
        <div class="card-head"><span class="hint">.env</span><button class="btn small ghost" data-copy-pre="kit-env">نسخ</button></div>
        <pre class="kit" id="kit-env">${esc(v.kit?.env || '')}</pre>
        <div class="card-head"><span class="hint">docker-compose</span><button class="btn small ghost" data-copy-pre="kit-compose">نسخ</button></div>
        <pre class="kit" id="kit-compose">${esc(v.kit?.compose || '')}</pre>
        ${v.is_local ? '' : '<button class="btn danger" id="delete-venue" style="margin-top:12px">حذف من السجل</button>'}
      </div>
    `;
  }

  function wireDetail(v) {
    $('#btn-probe').addEventListener('click', () => renderDetail(v.id));
    $('#save-venue').addEventListener('click', async () => {
      const payload = {};
      $$('#venue-edit [data-f]').forEach((el) => { payload[el.dataset.f] = el.value; });
      try {
        await api(`/manager/api/venues/${v.id}`, { method: 'PATCH', body: payload });
        toast('تم حفظ بيانات المطعم');
      } catch (e) { toast(e.message); }
    });
    $('#save-bot').addEventListener('click', async () => {
      try {
        await api(`/manager/api/venues/${v.id}/settings`, {
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
        toast('تم حفظ إعدادات البوت');
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
      contact_name: '',
      contact_phone: '',
      notes: '',
      mode: 'new', // new | connect
      public_url: '',
      manager_token: '',
      welcome: '',
      model: 'gemini-3.5-flash-lite',
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
          <div class="field"><label>الاسم بالعربي</label><input id="w-name" value="${esc(w.name)}" placeholder="مثلاً: بيتزا باربيكيو"></div>
          <div class="field"><label>الاسم بالإنجليزي (للرابط)</label><input id="w-name-en" dir="ltr" value="${esc(w.name_en)}" placeholder="Barbeque Pizza"></div>
        </div>`;
      $$('#kind-grid .choice').forEach((b) => b.addEventListener('click', () => {
        w.kind = b.dataset.kind;
        $$('#kind-grid .choice').forEach((x) => x.classList.toggle('on', x === b));
      }));
    } else if (w.step === 1) {
      box.innerHTML = `
        <div class="form-grid">
          <div class="field"><label>اسم المسؤول عند العميل</label><input id="w-contact" value="${esc(w.contact_name)}" placeholder="أحمد"></div>
          <div class="field"><label>هاتفه</label><input id="w-phone" value="${esc(w.contact_phone)}" placeholder="05…"></div>
          <div class="field full"><label>ملاحظات داخلية</label><textarea id="w-notes" placeholder="اتفاق، سعر الخطة، موعد التسليم…">${esc(w.notes)}</textarea></div>
        </div>`;
    } else if (w.step === 2) {
      box.innerHTML = `
        <p class="hint" style="margin-bottom:12px">كل مطعم نسخة Docker مستقلة (سيرفر أو ستاك Portainer منفصل). هون بتحدد إذا عميل جديد أو سيرفر جاهز.</p>
        <div class="choice-grid">
          <button type="button" class="choice ${w.mode === 'new' ? 'on' : ''}" data-mode="new">
            <strong>عميل جديد — توليد نشر</strong>
            <span>منصة تولّد كلمة السر والتوكن وملف compose تنسخه على سيرفره</span>
          </button>
          <button type="button" class="choice ${w.mode === 'connect' ? 'on' : ''}" data-mode="connect">
            <strong>سيرفر قائم — ربط</strong>
            <span>عنده نسخة شغّالة. حط الرابط و MANAGER_TOKEN</span>
          </button>
        </div>
        <div class="form-grid" style="margin-top:16px">
          <div class="field full"><label>رابط الموقع العام</label>
            <input id="w-url" dir="ltr" value="${esc(w.public_url)}" placeholder="https://cafe.example.com">
            <span class="hint">${w.mode === 'connect' ? 'مطلوب للربط والفحص' : 'اختياري الآن، بتقدر تضيفه بعد النشر'}</span>
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
        <p class="hint" style="margin-bottom:12px">قيم ابتدائية. بعد ما يصير السيرفر Live بتقدر تعدّلها من بطاقة المطعم.</p>
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
          <div class="k">المسؤول</div><div>${esc(w.contact_name || '—')}</div>
          <div class="k">الاستضافة</div><div>${w.mode === 'connect' ? 'ربط سيرفر قائم' : 'توليد حزمة نشر'}</div>
          <div class="k">الرابط</div><div>${esc(w.public_url || '— لاحقاً')}</div>
        </div>
        <p class="hint" style="margin-top:14px">بعد الإنشاء بتظهر كلمات السر مرة واحدة في صفحة المطعم — احفظها.</p>`;
    }
  }

  function collectWiz() {
    const w = state.wizard;
    const val = (id) => $(id)?.value?.trim() ?? w[id.replace('#w-', '').replace(/-/g, '_')];
    if ($('#w-name')) w.name = $('#w-name').value.trim();
    if ($('#w-name-en')) w.name_en = $('#w-name-en').value.trim();
    if ($('#w-contact')) w.contact_name = $('#w-contact').value.trim();
    if ($('#w-phone')) w.contact_phone = $('#w-phone').value.trim();
    if ($('#w-notes')) w.notes = $('#w-notes').value.trim();
    if ($('#w-url')) w.public_url = $('#w-url').value.trim();
    if ($('#w-token')) w.manager_token = $('#w-token').value.trim();
    if ($('#w-model')) w.model = $('#w-model').value.trim();
    if ($('#w-welcome')) w.welcome = $('#w-welcome').value.trim();
    return val;
  }

  async function onWizNext() {
    const w = state.wizard;
    collectWiz();
    if (w.step === 0 && !w.name) { toast('الاسم مطلوب'); return; }
    if (w.step === 2 && w.mode === 'connect' && (!w.public_url || !w.manager_token)) {
      toast('الرابط والتوكن مطلوبان للربط'); return;
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
          meta: { welcome: w.welcome, model: w.model },
        },
      });
      state.wizard = null;
      toast('تم إنشاء المطعم');
      location.hash = `#/venues/${created.venue.id}`;
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.textContent = 'إنشاء المطعم';
    }
  }

  checkAuth();
})();
