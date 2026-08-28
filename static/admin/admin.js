/* ============================================
   Admin panel — mini SPA
   ============================================ */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => r.querySelectorAll(s);

  const state = {
    view: null,
    categories: [],
    items: [],
    settings: {},
    images: [],
    modal: null,
  };

  const esc = (t) => String(t ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const money = (n) => `${Number(n || 0).toLocaleString('en-US')} ${state.settings.currency || 'شيكل'}`;
  const fmtDate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '-';
  const toast = (msg) => {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._to); t._to = setTimeout(() => t.classList.add('hidden'), 2200);
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('غير مصرح');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `خطأ ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/admin/api/upload', { method: 'POST', body: fd, credentials: 'include' });
    if (!res.ok) throw new Error('فشل الرفع');
    return res.json();
  }

  // ---------- Auth ----------
  async function checkAuth() {
    try {
      const r = await fetch('/admin/api/me', { credentials: 'include' });
      const d = await r.json();
      if (d.authenticated) {
        showApp();
        return true;
      }
    } catch {}
    showLogin();
    return false;
  }

  function showLogin() {
    $('#login-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');
  }
  function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    boot();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#login-password').value;
    const errEl = $('#login-error');
    errEl.classList.add('hidden');
    try {
      await api('/admin/api/login', { method: 'POST', body: { password: pw } });
      showApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/admin/api/logout', { method: 'POST' });
    showLogin();
  });

  // ---------- Router ----------
  const routes = {
    dashboard: renderDashboard,
    menu: renderMenu,
    categories: renderCategories,
    tables: renderTables,
    orders: renderOrders,
    chats: renderChats,
    settings: renderSettings,
  };

  function currentRoute() {
    return (location.hash.replace(/^#\//, '') || 'dashboard').split('/')[0];
  }

  function activateNav(view) {
    $$('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    const titles = { dashboard: 'الملخص', menu: 'المنيو', categories: 'الفئات', tables: 'الطاولات', orders: 'الطلبات', chats: 'المحادثات', settings: 'الإعدادات' };
    $('#view-title').textContent = titles[view] || '';
  }

  async function navigate() {
    const view = currentRoute();
    const fn = routes[view] || renderDashboard;
    state.view = view;
    activateNav(view);
    $('#view').innerHTML = '<div class="empty-state">جاري التحميل...</div>';
    try {
      await fn();
    } catch (e) {
      $('#view').innerHTML = `<div class="empty-state" style="color:#b91c1c">${esc(e.message)}</div>`;
    }
    // close sidebar on mobile after nav
    $('.sidebar')?.classList.remove('open');
  }
  window.addEventListener('hashchange', navigate);

  $('#menu-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));

  // ---------- Bootstrap ----------
  async function boot() {
    setInterval(() => { $('#datetime').textContent = new Date().toLocaleString('ar-EG'); }, 1000);
    $('#datetime').textContent = new Date().toLocaleString('ar-EG');
    // load reference data once
    try {
      [state.categories, state.settings] = await Promise.all([
        api('/admin/api/categories'),
        api('/admin/api/settings'),
      ]);
    } catch (e) {
      // Not authenticated — showLogin already handled
      return;
    }
    await refreshBadges();
    navigate();
  }

  async function refreshBadges() {
    try {
      const s = await api('/admin/api/summary');
      const badgeOrders = $('#badge-orders');
      if (s.orders.today > 0) { badgeOrders.textContent = s.orders.today; badgeOrders.hidden = false; }
      else badgeOrders.hidden = true;
    } catch {}
  }

  // ---------- Dashboard ----------
  async function renderDashboard() {
    const s = await api('/admin/api/summary');
    $('#view').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">🍕</div>
          <div class="stat-label">إجمالي الأصناف</div>
          <div class="stat-value">${s.items.total}</div>
          <div class="stat-sub">${s.items.available} متوفر</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🧾</div>
          <div class="stat-label">طلبات اليوم</div>
          <div class="stat-value">${s.orders.today}</div>
          <div class="stat-sub">إجمالي: ${s.orders.total}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💰</div>
          <div class="stat-label">مبيعات اليوم</div>
          <div class="stat-value">${money(s.orders.revenue_today)}</div>
          <div class="stat-sub">قبل المصاريف</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💬</div>
          <div class="stat-label">محادثات اليوم</div>
          <div class="stat-value">${s.chats.today}</div>
          <div class="stat-sub">توكين اليوم: ${(s.chats.tokens_in_today||0) + (s.chats.tokens_out_today||0)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">آخر الطلبات</div>
        ${s.recent_orders.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>#</th><th>الزبون</th><th>المجموع</th><th>الحالة</th><th>الوقت</th></tr></thead>
            <tbody>
              ${s.recent_orders.map(o => `<tr>
                <td>#${o.id}</td>
                <td>${esc(o.customer_name || '-')}</td>
                <td>${money(o.total)}</td>
                <td>${orderBadge(o.status)}</td>
                <td>${fmtDate(o.created_at)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        ` : '<div class="empty-state">لا توجد طلبات بعد</div>'}
      </div>
    `;
  }

  function orderBadge(status) {
    const map = {
      'جديد': 'info', 'قيد التحضير': 'warning', 'جاهز': 'success', 'مسلّم': 'success', 'ملغي': 'danger',
    };
    return `<span class="badge ${map[status] || 'gray'}">${esc(status || '-')}</span>`;
  }

  // ---------- Menu (items) ----------
  async function renderMenu() {
    state.items = await api('/admin/api/items');
    if (!state.categories.length) state.categories = await api('/admin/api/categories');
    state.images = await api('/admin/api/images');

    const catOptions = state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('#view').innerHTML = `
      <div class="toolbar">
        <input class="search" id="items-search" placeholder="ابحث بالاسم..." />
        <select id="items-cat"><option value="">كل الفئات</option>${catOptions}</select>
        <button class="btn primary" id="add-item-btn">+ صنف جديد</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th style="width:60px">صورة</th>
              <th>الاسم</th>
              <th>الفئة</th>
              <th>السعر</th>
              <th>مميزات</th>
              <th>متوفر</th>
              <th></th>
            </tr></thead>
            <tbody id="items-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    const draw = () => {
      const q = $('#items-search').value.trim().toLowerCase();
      const cat = $('#items-cat').value;
      const rows = state.items.filter(it => {
        if (cat && String(it.category_id) !== cat) return false;
        if (q && !`${it.name} ${it.name_en || ''}`.toLowerCase().includes(q)) return false;
        return true;
      }).map(it => {
        const catName = state.categories.find(c => c.id === it.category_id)?.name || '-';
        const priceLabel = it.sizes && it.sizes.length
          ? `${it.sizes[0].price} - ${it.sizes[it.sizes.length - 1].price}`
          : (it.price != null ? String(it.price) : '-');
        const tags = [];
        if (it.vegetarian) tags.push('نباتي 🥗');
        if (it.spicy) tags.push('حار 🌶');
        return `<tr>
          <td>${it.image ? `<img class="thumb" src="/img/${esc(it.image)}?w=160" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb-placeholder',textContent:'🍕'}))">` : '<div class="thumb-placeholder">🍕</div>'}</td>
          <td><strong>${esc(it.name)}</strong>${it.name_en ? `<br><small style="color:#6b7280">${esc(it.name_en)}</small>` : ''}</td>
          <td>${esc(catName)}</td>
          <td>${priceLabel}</td>
          <td>${tags.join(' ') || '-'}</td>
          <td>
            <label class="switch">
              <input type="checkbox" ${it.available ? 'checked' : ''} data-toggle="${it.id}">
              <span class="slider"></span>
            </label>
          </td>
          <td class="row-actions">
            <button class="btn small ghost" data-edit="${it.id}">تعديل</button>
            <button class="btn small danger" data-del="${it.id}">حذف</button>
          </td>
        </tr>`;
      }).join('');
      $('#items-tbody').innerHTML = rows || '<tr><td colspan="7" class="empty-state">لا توجد أصناف</td></tr>';

      $$('#items-tbody [data-toggle]').forEach(cb => {
        cb.addEventListener('change', async () => {
          try {
            await api(`/admin/api/items/${cb.dataset.toggle}/toggle`, { method: 'POST' });
            const it = state.items.find(x => x.id === Number(cb.dataset.toggle));
            it.available = !it.available;
            toast('تم التحديث');
          } catch (e) { toast(e.message); }
        });
      });
      $$('#items-tbody [data-edit]').forEach(b => b.addEventListener('click', () => openItemEditor(Number(b.dataset.edit))));
      $$('#items-tbody [data-del]').forEach(b => b.addEventListener('click', () => deleteItem(Number(b.dataset.del))));
    };
    $('#items-search').addEventListener('input', draw);
    $('#items-cat').addEventListener('change', draw);
    $('#add-item-btn').addEventListener('click', () => openItemEditor(null));
    draw();
  }

  async function deleteItem(id) {
    if (!confirm('حذف هذا الصنف؟')) return;
    try {
      await api(`/admin/api/items/${id}`, { method: 'DELETE' });
      state.items = state.items.filter(x => x.id !== id);
      renderMenu();
      toast('تم الحذف');
    } catch (e) { toast(e.message); }
  }

  function openItemEditor(id) {
    const it = id ? state.items.find(x => x.id === id) : {
      category_id: state.categories[0]?.id, name: '', name_en: '', description: '',
      image: null, sizes: null, price: null, vegetarian: false, spicy: false, available: true, sort_order: 0,
    };
    const useSizes = !!(it.sizes && it.sizes.length);
    const catOptions = state.categories.map(c => `<option value="${c.id}" ${it.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

    openModal(`
      <h3>${id ? 'تعديل صنف' : 'صنف جديد'}</h3>
      <div class="form-grid">
        <div class="field"><label>الاسم بالعربي</label><input id="f-name" value="${esc(it.name || '')}"></div>
        <div class="field"><label>الاسم بالإنجليزي</label><input id="f-name-en" value="${esc(it.name_en || '')}"></div>
        <div class="field"><label>الفئة</label><select id="f-cat">${catOptions}</select></div>
        <div class="field"><label>ترتيب العرض</label><input type="number" id="f-order" value="${it.sort_order || 0}"></div>
      </div>
      <div class="field" style="margin-top:12px"><label>الوصف</label><textarea id="f-desc">${esc(it.description || '')}</textarea></div>

      <div class="field" style="margin-top:12px">
        <label>الصورة (اختر من المكتبة أو ارفع)</label>
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px">
          <input type="file" id="f-upload" accept="image/*">
          <button class="btn small ghost" id="f-clear-img">مسح</button>
          <span id="f-img-name" style="color:#6b7280; font-size:.85rem">${it.image ? esc(it.image) : 'لا شيء'}</span>
        </div>
        <div class="image-picker" id="f-images">
          ${state.images.map(img => `<img src="/img/${esc(img)}?w=160" loading="lazy" data-img="${esc(img)}" class="${it.image === img ? 'selected' : ''}" title="${esc(img)}">`).join('')}
        </div>
      </div>

      <div class="field" style="margin-top:12px">
        <label>
          <input type="checkbox" id="f-use-sizes" ${useSizes ? 'checked' : ''}> استخدام أحجام متعددة (S/M/L/XL)
        </label>
      </div>

      <div id="f-sizes-wrap" ${useSizes ? '' : 'style="display:none"'}>
        <div class="field"><label>الأحجام والأسعار</label></div>
        <div class="sizes-editor" id="f-sizes">
          ${(it.sizes || [{name:'S',price:0},{name:'M',price:0},{name:'L',price:0},{name:'XL',price:0}]).map((s, i) => `
            <div class="size-row" data-idx="${i}">
              <input placeholder="اسم" value="${esc(s.name)}" style="max-width:80px" data-key="name">
              <input placeholder="سعر" type="number" step="0.01" value="${s.price}" data-key="price">
              <button type="button" data-rm-size="${i}">🗑</button>
            </div>
          `).join('')}
        </div>
        <button class="btn small ghost" id="f-add-size" style="margin-top:6px">+ إضافة حجم</button>
      </div>

      <div id="f-price-wrap" ${!useSizes ? '' : 'style="display:none"'} class="field" style="margin-top:12px">
        <label>السعر (شيكل)</label>
        <input type="number" step="0.01" id="f-price" value="${it.price ?? ''}">
      </div>

      <div class="form-grid" style="margin-top:12px">
        <div class="field check"><input type="checkbox" id="f-veg" ${it.vegetarian ? 'checked' : ''}><label>نباتي</label></div>
        <div class="field check"><input type="checkbox" id="f-spicy" ${it.spicy ? 'checked' : ''}><label>حار</label></div>
        <div class="field check"><input type="checkbox" id="f-available" ${it.available !== false ? 'checked' : ''}><label>متوفر</label></div>
      </div>

      <div class="modal-actions">
        <button class="btn ghost" data-close>إلغاء</button>
        <button class="btn primary" id="f-save">${id ? 'حفظ التغييرات' : 'إضافة'}</button>
      </div>
    `);

    let selectedImage = it.image || null;

    $('#f-images').addEventListener('click', (e) => {
      const img = e.target.closest('img[data-img]');
      if (!img) return;
      $$('#f-images img').forEach(x => x.classList.remove('selected'));
      img.classList.add('selected');
      selectedImage = img.dataset.img;
      $('#f-img-name').textContent = selectedImage;
    });

    $('#f-clear-img').addEventListener('click', () => {
      selectedImage = null;
      $$('#f-images img').forEach(x => x.classList.remove('selected'));
      $('#f-img-name').textContent = 'لا شيء';
    });

    $('#f-upload').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const r = await uploadImage(file);
        state.images.unshift(r.image);
        selectedImage = r.image;
        $('#f-img-name').textContent = r.image;
        const html = state.images.map(img => `<img src="/img/${esc(img)}?w=160" loading="lazy" data-img="${esc(img)}" class="${selectedImage === img ? 'selected' : ''}" title="${esc(img)}">`).join('');
        $('#f-images').innerHTML = html;
        toast('تم رفع الصورة');
      } catch (err) { toast(err.message); }
    });

    $('#f-use-sizes').addEventListener('change', (e) => {
      $('#f-sizes-wrap').style.display = e.target.checked ? '' : 'none';
      $('#f-price-wrap').style.display = e.target.checked ? 'none' : '';
    });

    $('#f-add-size').addEventListener('click', () => {
      const idx = $$('#f-sizes .size-row').length;
      $('#f-sizes').insertAdjacentHTML('beforeend', `
        <div class="size-row" data-idx="${idx}">
          <input placeholder="اسم" value="" style="max-width:80px" data-key="name">
          <input placeholder="سعر" type="number" step="0.01" value="0" data-key="price">
          <button type="button" data-rm-size="${idx}">🗑</button>
        </div>`);
    });

    $('#f-sizes').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rm-size]');
      if (!btn) return;
      btn.closest('.size-row').remove();
    });

    $('#f-save').addEventListener('click', async () => {
      const useS = $('#f-use-sizes').checked;
      let sizes = null, price = null;
      if (useS) {
        sizes = [];
        $$('#f-sizes .size-row').forEach(row => {
          const name = row.querySelector('[data-key=name]').value.trim();
          const p = parseFloat(row.querySelector('[data-key=price]').value);
          if (name && !isNaN(p)) sizes.push({ name, price: p });
        });
        if (!sizes.length) { toast('أضف حجم واحد على الأقل'); return; }
      } else {
        const p = parseFloat($('#f-price').value);
        if (isNaN(p)) { toast('أدخل السعر'); return; }
        price = p;
      }
      const payload = {
        category_id: Number($('#f-cat').value),
        name: $('#f-name').value.trim(),
        name_en: $('#f-name-en').value.trim() || null,
        description: $('#f-desc').value.trim() || null,
        image: selectedImage || null,
        sizes, price,
        vegetarian: $('#f-veg').checked,
        spicy: $('#f-spicy').checked,
        available: $('#f-available').checked,
        sort_order: Number($('#f-order').value) || 0,
      };
      if (!payload.name) { toast('الاسم مطلوب'); return; }
      try {
        if (id) {
          await api(`/admin/api/items/${id}`, { method: 'PATCH', body: payload });
        } else {
          await api('/admin/api/items', { method: 'POST', body: payload });
        }
        closeModal();
        renderMenu();
        toast('تم الحفظ');
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- Categories ----------
  async function renderCategories() {
    state.categories = await api('/admin/api/categories');
    $('#view').innerHTML = `
      <div class="toolbar">
        <div style="flex:1"></div>
        <button class="btn primary" id="add-cat">+ فئة جديدة</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الأيقونة</th><th>الاسم</th><th>الاسم بالإنجليزي</th><th>الترتيب</th><th></th></tr></thead>
            <tbody>
              ${state.categories.map(c => `<tr>
                <td style="font-size:1.5rem">${esc(c.icon || '🍽️')}</td>
                <td>${esc(c.name)}</td>
                <td>${esc(c.name_en || '-')}</td>
                <td>${c.sort_order}</td>
                <td class="row-actions">
                  <button class="btn small ghost" data-edit-cat="${c.id}">تعديل</button>
                  <button class="btn small danger" data-del-cat="${c.id}">حذف</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="5" class="empty-state">لا توجد فئات</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
    $('#add-cat').addEventListener('click', () => openCatEditor(null));
    $$('[data-edit-cat]').forEach(b => b.addEventListener('click', () => openCatEditor(Number(b.dataset.editCat))));
    $$('[data-del-cat]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('حذف الفئة سيحذف جميع الأصناف داخلها. متأكد؟')) return;
      try {
        await api(`/admin/api/categories/${b.dataset.delCat}`, { method: 'DELETE' });
        renderCategories();
        toast('تم الحذف');
      } catch (e) { toast(e.message); }
    }));
  }

  function openCatEditor(id) {
    const c = id ? state.categories.find(x => x.id === id) : { name: '', name_en: '', icon: '🍽️', sort_order: 0 };
    openModal(`
      <h3>${id ? 'تعديل فئة' : 'فئة جديدة'}</h3>
      <div class="form-grid">
        <div class="field"><label>الاسم</label><input id="c-name" value="${esc(c.name)}"></div>
        <div class="field"><label>الاسم بالإنجليزي</label><input id="c-name-en" value="${esc(c.name_en || '')}"></div>
        <div class="field"><label>الأيقونة (إيموجي)</label><input id="c-icon" value="${esc(c.icon || '🍽️')}"></div>
        <div class="field"><label>الترتيب</label><input type="number" id="c-order" value="${c.sort_order || 0}"></div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>إلغاء</button>
        <button class="btn primary" id="c-save">${id ? 'حفظ' : 'إضافة'}</button>
      </div>
    `);
    $('#c-save').addEventListener('click', async () => {
      const payload = {
        name: $('#c-name').value.trim(),
        name_en: $('#c-name-en').value.trim() || null,
        icon: $('#c-icon').value.trim() || null,
        sort_order: Number($('#c-order').value) || 0,
      };
      if (!payload.name) { toast('الاسم مطلوب'); return; }
      try {
        if (id) await api(`/admin/api/categories/${id}`, { method: 'PATCH', body: payload });
        else await api('/admin/api/categories', { method: 'POST', body: payload });
        closeModal();
        renderCategories();
        toast('تم الحفظ');
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- Tables (QR-based dine-in) ----------
  async function renderTables() {
    // Always refresh settings so the toggle reflects the current server state
    state.settings = await api('/admin/api/settings');
    const requireTable = (state.settings.orders_require_table || 'true') === 'true';
    const tables = await api('/admin/api/tables');
    $('#view').innerHTML = `
      <div class="card mode-card">
        <div class="mode-head">
          <div>
            <div class="card-title" style="margin-bottom:2px">🪑 وضع الطاولات (QR)</div>
            <div class="mode-hint">
              ${requireTable
                ? 'الطلبات تحتاج مسح QR الطاولة. مناسب لتناول الطعام داخل المطعم.'
                : 'الطلبات مفتوحة للجميع مع رقم هاتف. مناسب للتوصيل أو الاستلام.'}
            </div>
          </div>
          <label class="switch" title="تفعيل / إيقاف">
            <input type="checkbox" id="mode-toggle" ${requireTable ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="mode-flags">
          <span class="badge ${requireTable ? 'info' : 'gray'}">🪑 طاولة QR</span>
          <span class="badge ${requireTable ? 'gray' : 'success'}">📞 وضع عام</span>
        </div>
      </div>

      <div class="toolbar">
        <button class="btn primary" id="add-table">+ إضافة طاولة</button>
        <div style="flex:1"></div>
        <button class="btn ghost" id="print-all-qr" ${tables.length ? '' : 'disabled'}>🖨️ طباعة كل رموز QR</button>
      </div>
      <div class="tables-grid">
        ${tables.length ? tables.map(tableCardHtml).join('') : ''}
      </div>
      ${tables.length ? '' : '<div class="empty-state">لا توجد طاولات بعد. اضغط "إضافة طاولة" لتبدأ.</div>'}
    `;

    $('#mode-toggle').addEventListener('change', async (e) => {
      const val = e.target.checked ? 'true' : 'false';
      try {
        await api('/admin/api/settings', {
          method: 'PATCH',
          body: { orders_require_table: val },
        });
        toast(e.target.checked ? '✓ وضع الطاولات مفعّل' : '✓ الوضع العام مفعّل');
        renderTables();
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast(err.message);
      }
    });

    $('#add-table').addEventListener('click', () => openTableEditor(null));
    if (tables.length) {
      $('#print-all-qr').addEventListener('click', () => printAllQr(tables));
    }
    wireTableCards(tables);
  }

  function tableCardHtml(t) {
    const inactive = t.active ? '' : 'inactive';
    return `
      <div class="table-card ${inactive}" data-id="${t.id}">
        <div class="tc-head">
          <div class="tc-num">#${esc(t.number)}</div>
          <div class="tc-status">
            ${t.active
              ? '<span class="badge success">مفعّلة</span>'
              : '<span class="badge gray">معطّلة</span>'}
          </div>
        </div>
        ${t.label ? `<div class="tc-label">${esc(t.label)}</div>` : ''}
        <div class="tc-qr">
          <img src="/admin/api/tables/${t.id}/qr.png?v=${encodeURIComponent(t.token)}" alt="QR طاولة ${esc(t.number)}" loading="lazy">
        </div>
        <div class="tc-url" title="${esc(t.scan_url || '')}">${esc(t.scan_url || '')}</div>
        <div class="tc-actions">
          <button class="btn small primary" data-print="${t.id}">🖨️ طباعة</button>
          <button class="btn small ghost" data-edit="${t.id}">✏️ تعديل</button>
          <button class="btn small ghost" data-toggle="${t.id}">${t.active ? '⏸️ تعطيل' : '▶️ تفعيل'}</button>
          <button class="btn small ghost" data-regen="${t.id}">🔄 توليد رمز جديد</button>
          <button class="btn small danger" data-del="${t.id}">🗑</button>
        </div>
      </div>
    `;
  }

  function wireTableCards(tables) {
    const byId = (id) => tables.find((x) => x.id === Number(id));
    $$('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => openTableEditor(byId(b.dataset.edit)))
    );
    $$('[data-toggle]').forEach((b) =>
      b.addEventListener('click', async () => {
        const t = byId(b.dataset.toggle);
        try {
          await api(`/admin/api/tables/${t.id}`, {
            method: 'PATCH',
            body: { active: !t.active },
          });
          toast(t.active ? 'تم تعطيل الطاولة' : 'تم تفعيل الطاولة');
          renderTables();
        } catch (e) {
          toast(e.message);
        }
      })
    );
    $$('[data-regen]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('توليد رمز جديد يبطل رمز QR القديم. متابعة؟')) return;
        try {
          await api(`/admin/api/tables/${b.dataset.regen}/regenerate`, { method: 'POST' });
          toast('تم توليد رمز جديد');
          renderTables();
        } catch (e) {
          toast(e.message);
        }
      })
    );
    $$('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('حذف الطاولة نهائياً؟')) return;
        try {
          await api(`/admin/api/tables/${b.dataset.del}`, { method: 'DELETE' });
          toast('تم الحذف');
          renderTables();
        } catch (e) {
          toast(e.message);
        }
      })
    );
    $$('[data-print]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = byId(b.dataset.print);
        printOneQr(t);
      })
    );
  }

  function openTableEditor(t) {
    const isNew = !t;
    openModal(`
      <h3>${isNew ? 'إضافة طاولة جديدة' : `تعديل طاولة #${esc(t.number)}`}</h3>
      <div class="form-grid">
        ${isNew
          ? '<div class="field"><label>رقم الطاولة *</label><input id="t-number" placeholder="مثلاً 1"></div>'
          : ''}
        <div class="field">
          <label>ملاحظة (اختياري)</label>
          <input id="t-label" placeholder="مثلاً: قرب النافذة" value="${esc((t && t.label) || '')}">
        </div>
        ${isNew ? '' : `
          <div class="field check">
            <input type="checkbox" id="t-active" ${t.active ? 'checked' : ''}>
            <label>مفعّلة</label>
          </div>`}
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>إلغاء</button>
        <button class="btn primary" id="t-save">💾 حفظ</button>
      </div>
    `);
    $('#t-save').addEventListener('click', async () => {
      try {
        if (isNew) {
          const number = $('#t-number').value.trim();
          const label = $('#t-label').value.trim() || null;
          if (!number) return toast('رقم الطاولة مطلوب');
          await api('/admin/api/tables', { method: 'POST', body: { number, label } });
        } else {
          const label = $('#t-label').value.trim();
          const active = $('#t-active').checked;
          await api(`/admin/api/tables/${t.id}`, {
            method: 'PATCH',
            body: { label, active },
          });
        }
        closeModal();
        toast('تم الحفظ');
        renderTables();
      } catch (e) {
        toast(e.message);
      }
    });
  }

  function printOneQr(t) {
    const restName = state.settings.restaurant_name || 'المطعم';
    const html = `
      <html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>QR طاولة ${t.number}</title>
      <style>
        body { font-family: 'Tajawal', sans-serif; margin: 0; padding: 20mm; text-align: center; }
        .sheet { page-break-after: always; padding: 30px 0; }
        .rest { font-size: 24pt; font-weight: 800; margin-bottom: 8px; }
        .tn { font-size: 60pt; font-weight: 800; color: #c1121f; margin: 18px 0 6px; }
        .lbl { font-size: 14pt; color: #444; }
        img { width: 260px; height: 260px; margin: 20px auto; display:block; }
        .hint { font-size: 13pt; color: #555; margin-top: 10px; }
      </style>
      <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
      </head><body>
        <div class="sheet">
          <div class="rest">${esc(restName)}</div>
          <div>امسح الرمز لعرض المنيو والطلب</div>
          <img src="/admin/api/tables/${t.id}/qr.png?size=18&v=${encodeURIComponent(t.token)}">
          <div class="tn">طاولة ${esc(t.number)}</div>
          ${t.label ? `<div class="lbl">${esc(t.label)}</div>` : ''}
          <div class="hint">استخدم كاميرا الهاتف</div>
        </div>
      </body></html>`;
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return toast('السماح بالنوافذ المنبثقة مطلوب للطباعة');
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 500);
  }

  function printAllQr(tables) {
    const restName = state.settings.restaurant_name || 'المطعم';
    const sheets = tables.map((t) => `
      <div class="sheet">
        <div class="rest">${esc(restName)}</div>
        <div>امسح الرمز لعرض المنيو والطلب</div>
        <img src="/admin/api/tables/${t.id}/qr.png?size=18&v=${encodeURIComponent(t.token)}">
        <div class="tn">طاولة ${esc(t.number)}</div>
        ${t.label ? `<div class="lbl">${esc(t.label)}</div>` : ''}
      </div>
    `).join('');
    const html = `
      <html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>رموز QR — جميع الطاولات</title>
      <style>
        body { font-family: 'Tajawal', sans-serif; margin: 0; padding: 15mm; text-align: center; }
        .sheet { page-break-after: always; padding: 20px 0; }
        .rest { font-size: 22pt; font-weight: 800; margin-bottom: 6px; }
        .tn { font-size: 54pt; font-weight: 800; color: #c1121f; margin: 14px 0 4px; }
        .lbl { font-size: 12pt; color: #444; }
        img { width: 260px; height: 260px; margin: 16px auto; display: block; }
      </style>
      <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
      </head><body>${sheets}</body></html>`;
    const w = window.open('', '_blank', 'width=700,height=900');
    if (!w) return toast('السماح بالنوافذ المنبثقة مطلوب للطباعة');
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 800);
  }

  // ---------- Orders ----------
  async function renderOrders() {
    const orders = await api('/admin/api/orders');
    $('#view').innerHTML = `
      <div class="card">
        <div class="card-title">جميع الطلبات (${orders.length})</div>
        ${orders.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>#</th><th>الطاولة</th><th>الزبون</th><th>عدد الأصناف</th><th>المجموع</th><th>الحالة</th><th>الوقت</th><th></th></tr></thead>
            <tbody>
              ${orders.map(o => `<tr>
                <td>#${o.id}</td>
                <td>${o.table_number ? `<span class="badge info">🪑 #${esc(o.table_number)}</span>` : '-'}</td>
                <td>${esc(o.customer_name || '-')}</td>
                <td>${o.items?.length || 0}</td>
                <td>${money(o.total)}</td>
                <td>${orderBadge(o.status)}</td>
                <td>${fmtDate(o.created_at)}</td>
                <td class="row-actions">
                  <button class="btn small ghost" data-view-order='${esc(JSON.stringify(o))}'>عرض</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        ` : '<div class="empty-state">لا توجد طلبات</div>'}
      </div>
    `;
    $$('[data-view-order]').forEach(b => b.addEventListener('click', () => showOrder(JSON.parse(b.dataset.viewOrder))));
  }

  function showOrder(o) {
    const itemsHtml = (o.items || []).map(it => `
      <div style="padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div>${esc(it.name)} ${it.size ? `<small>(${esc(it.size)})</small>` : ''} × ${it.quantity}</div>
          <div>${money(it.line_total)}</div>
        </div>
        ${it.note ? `<div class="item-note">🗒️ ${esc(it.note)}</div>` : ''}
      </div>
    `).join('');
    openModal(`
      <h3>الطلب #${o.id}</h3>
      <div class="form-grid">
        <div><strong>الطاولة:</strong> ${o.table_number ? `🪑 #${esc(o.table_number)}` : '-'}</div>
        <div><strong>الزبون:</strong> ${esc(o.customer_name)}</div>
        <div><strong>الحالة:</strong> ${orderBadge(o.status)}</div>
        <div><strong>الدفع:</strong> ${esc(o.payment_method || '-')}</div>
        <div><strong>الوقت:</strong> ${fmtDate(o.created_at)}</div>
      </div>
      ${o.notes ? `<div style="margin-top:10px"><strong>ملاحظات:</strong> ${esc(o.notes)}</div>` : ''}
      <div class="card" style="margin-top:12px;box-shadow:none;background:#fafafa">
        ${itemsHtml}
        <div style="display:flex;justify-content:space-between;padding:8px 0"><span>الفرعي</span><span>${money(o.subtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:0 0 8px"><span>التوصيل</span><span>${money(o.delivery_fee)}</span></div>
        <div style="display:flex;justify-content:space-between;font-weight:800;color:var(--primary-dark);border-top:1px dashed var(--border);padding-top:8px"><span>الإجمالي</span><span>${money(o.total)}</span></div>
      </div>
      <div class="field" style="margin-top:12px">
        <label>تغيير الحالة</label>
        <select id="o-status">
          ${['جديد','قيد التحضير','جاهز','مسلّم','ملغي'].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>إغلاق</button>
        <button class="btn primary" id="o-save">حفظ الحالة</button>
      </div>
    `);
    $('#o-save').addEventListener('click', async () => {
      const status = $('#o-status').value;
      try {
        await api(`/admin/api/orders/${o.id}`, { method: 'PATCH', body: { status } });
        closeModal();
        renderOrders();
        refreshBadges();
        toast('تم التحديث');
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- Chats ----------
  async function renderChats() {
    const chats = await api('/admin/api/chats?limit=100');
    $('#view').innerHTML = `
      <div class="card">
        <div class="card-title">آخر ${chats.length} محادثة</div>
        ${chats.length ? chats.map(c => `
          <div class="chat-log-item ${c.error ? 'errored' : ''}">
            <div class="meta">
              <span>${fmtDate(c.created_at)}</span>
              <span class="badge gray">${c.session_id ? c.session_id.slice(0,8) : '-'}</span>
              ${c.tokens_in ? `<span>📥 ${c.tokens_in}</span>` : ''}
              ${c.tokens_out ? `<span>📤 ${c.tokens_out}</span>` : ''}
              ${c.latency_ms ? `<span>⏱️ ${c.latency_ms}ms</span>` : ''}
              ${c.error ? `<span class="badge danger">خطأ</span>` : ''}
            </div>
            <div class="msg-user">👤 ${esc(c.user_message)}</div>
            ${c.bot_reply ? `<div class="msg-bot">🤖 ${esc(c.bot_reply)}</div>` : ''}
            ${c.error ? `<div class="msg-bot" style="color:#b91c1c">${esc(c.error)}</div>` : ''}
          </div>
        `).join('') : '<div class="empty-state">لا توجد محادثات بعد</div>'}
      </div>
    `;
  }

  // ---------- Errors ----------
  async function renderErrors() {
    const showResolved = location.hash.includes('show_resolved');
    const errors = await api(`/admin/api/errors?limit=200&only_open=${!showResolved}`);
    $('#view').innerHTML = `
      <div class="toolbar">
        <label class="chip-toggle" style="display:inline-flex;gap:6px;align-items:center;padding:6px 12px;background:#fff;border:1px solid var(--border);border-radius:10px;cursor:pointer">
          <input type="checkbox" id="show-resolved" ${showResolved ? 'checked' : ''}> إظهار المُحلولة
        </label>
        <div style="flex:1"></div>
        <button class="btn ghost" id="clear-resolved">🗑 مسح المحلولة</button>
      </div>
      <div class="card">
        <div class="card-title">${errors.length} خطأ</div>
        ${errors.length ? errors.map(e => `
          <div class="error-item ${e.resolved ? 'resolved' : ''}">
            <div class="meta">
              <span>${fmtDate(e.created_at)}</span>
              <span class="badge ${e.resolved ? 'success' : 'danger'}">${e.resolved ? 'محلول' : 'مفتوح'}</span>
              <span class="badge gray">${esc(e.source || '-')}</span>
              ${e.path ? `<span>${esc(e.path)}</span>` : ''}
            </div>
            <div class="message">${esc(e.message)}</div>
            ${e.details ? `<details><summary>تفاصيل</summary><pre>${esc(e.details)}</pre></details>` : ''}
            ${!e.resolved ? `<button class="btn small ghost" style="margin-top:6px" data-resolve="${e.id}">✓ تحديد كمحلول</button>` : ''}
          </div>
        `).join('') : '<div class="empty-state">لا يوجد أخطاء 🎉</div>'}
      </div>
    `;
    $('#show-resolved').addEventListener('change', (e) => {
      if (e.target.checked) location.hash = '#/errors?show_resolved=1';
      else location.hash = '#/errors';
    });
    $('#clear-resolved').addEventListener('click', async () => {
      if (!confirm('حذف الأخطاء المحلولة نهائياً؟')) return;
      try {
        await api('/admin/api/errors', { method: 'DELETE' });
        renderErrors();
        toast('تم المسح');
      } catch (e) { toast(e.message); }
    });
    $$('[data-resolve]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api(`/admin/api/errors/${b.dataset.resolve}/resolve`, { method: 'POST' });
        renderErrors();
        refreshBadges();
      } catch (e) { toast(e.message); }
    }));
  }

  // ---------- Settings ----------
  async function renderSettings() {
    state.settings = await api('/admin/api/settings');
    const s = state.settings;
    $('#view').innerHTML = `
      <div class="card">
        <div class="card-title">🏪 معلومات المطعم</div>
        <div class="form-grid">
          <div class="field"><label>اسم المطعم (عربي)</label><input data-k="restaurant_name" value="${esc(s.restaurant_name || '')}"></div>
          <div class="field"><label>الاسم بالإنجليزي</label><input data-k="restaurant_name_en" value="${esc(s.restaurant_name_en || '')}"></div>
          <div class="field"><label>الشعار</label><input data-k="restaurant_tagline" value="${esc(s.restaurant_tagline || '')}"></div>
          <div class="field"><label>الهاتف</label><input data-k="restaurant_phone" value="${esc(s.restaurant_phone || '')}"></div>
          <div class="field"><label>العنوان</label><input data-k="restaurant_address" value="${esc(s.restaurant_address || '')}"></div>
          <div class="field"><label>ساعات العمل</label><input data-k="restaurant_hours" value="${esc(s.restaurant_hours || '')}"></div>
          <div class="field"><label>العملة</label><input data-k="currency" value="${esc(s.currency || '')}"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🚗 التوصيل</div>
        <div class="form-grid">
          <div class="field check"><input type="checkbox" data-k="delivery_available" data-bool ${s.delivery_available === 'true' ? 'checked' : ''}><label>توصيل متاح</label></div>
          <div class="field"><label>رسوم التوصيل</label><input type="number" step="0.01" data-k="delivery_fee" value="${esc(s.delivery_fee || '')}"></div>
          <div class="field"><label>الحد الأدنى للطلب</label><input type="number" step="0.01" data-k="min_order" value="${esc(s.min_order || '')}"></div>
          <div class="field"><label>الوقت المتوقع</label><input data-k="estimated_time" value="${esc(s.estimated_time || '')}"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🤖 الشات بوت</div>
        <div class="form-grid">
          <div class="field check"><input type="checkbox" data-k="chatbot_enabled" data-bool ${s.chatbot_enabled === 'true' ? 'checked' : ''}><label>مُفعّل</label></div>
        </div>
        <div class="field" style="margin-top:12px"><label>رسالة الترحيب</label><textarea data-k="chatbot_welcome">${esc(s.chatbot_welcome || '')}</textarea></div>
      </div>

      <div class="card">
        <div class="card-title">🎨 المظهر</div>
        <div class="form-grid">
          <div class="field"><label>اللون الرئيسي</label><input type="color" data-k="primary_color" value="${esc(s.primary_color || '#e63946')}"></div>
          <div class="field"><label>اللون الرئيسي الداكن</label><input type="color" data-k="primary_color_dark" value="${esc(s.primary_color_dark || '#c1121f')}"></div>
        </div>
      </div>

      <div style="position:sticky;bottom:0;padding:12px 0;text-align:left;background:linear-gradient(180deg,transparent,var(--bg) 30%)">
        <button class="btn primary" id="save-settings">💾 حفظ جميع الإعدادات</button>
      </div>
    `;
    $('#save-settings').addEventListener('click', async () => {
      const payload = {};
      $$('[data-k]').forEach(el => {
        const key = el.dataset.k;
        if (el.dataset.bool !== undefined) payload[key] = el.checked ? 'true' : 'false';
        else payload[key] = el.value;
      });
      try {
        await api('/admin/api/settings', { method: 'PATCH', body: payload });
        toast('تم الحفظ');
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- Modal helpers ----------
  function openModal(inner) {
    closeModal();
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="modal-panel">${inner}</div>`;
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.matches('[data-close]')) closeModal();
    });
    document.body.appendChild(el);
    state.modal = el;
  }
  function closeModal() {
    if (state.modal) { state.modal.remove(); state.modal = null; }
  }

  // ---------- Start ----------
  checkAuth();
})();
