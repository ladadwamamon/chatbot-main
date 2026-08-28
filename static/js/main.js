/* ============================================
   Barbeque Pizza — public site logic
   ============================================ */
(() => {
  'use strict';

  const STATE = {
    menu: null,
    restaurant: null,
    filters: { category: 'all', search: '', vegetarian: false, spicy: false },
    cart: JSON.parse(localStorage.getItem('bbq_cart') || '[]'),
    modalItem: null,
    modalSize: null,
    modalQty: 1,
    table: null,
  };

  window.BBQ = window.BBQ || {};
  window.BBQ.getTable = () => STATE.table;

  // ---------- Utils ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const currency = () => (STATE.restaurant?.currency || 'شيكل');
  const money = (n) => `${Number(n).toLocaleString('en-US')} ${currency()}`;
  const escapeHtml = (t) => String(t ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const saveCart = () => localStorage.setItem('bbq_cart', JSON.stringify(STATE.cart));
  const showToast = (msg) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._to);
    t._to = setTimeout(() => t.classList.add('hidden'), 2200);
  };

  const priceRange = (item) => {
    if (item.sizes && item.sizes.length) {
      const prices = item.sizes.map((s) => s.price);
      const min = Math.min(...prices), max = Math.max(...prices);
      return min === max ? money(min) : `${money(min)} - ${money(max)}`;
    }
    return item.price != null ? money(item.price) : '—';
  };
  const startPrice = (item) => {
    if (item.sizes && item.sizes.length) return Math.min(...item.sizes.map((s) => s.price));
    return item.price ?? 0;
  };

  // ---------- Table detection (QR scan) ----------
  function tokenFromUrl() {
    const m = location.pathname.match(/^\/t\/([A-Za-z0-9_\-]{4,64})\/?$/);
    return m ? m[1] : null;
  }

  async function detectTable() {
    const urlToken = tokenFromUrl();
    const savedRaw = sessionStorage.getItem('bbq_table');
    const saved = savedRaw ? JSON.parse(savedRaw) : null;
    const token = urlToken || saved?.token;
    if (!token) return null;
    try {
      const res = await fetch(`/api/table/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error('invalid');
      const data = await res.json();
      const tbl = { token: data.token, number: data.number, label: data.label || null };
      sessionStorage.setItem('bbq_table', JSON.stringify(tbl));
      if (urlToken) {
        // Clean URL so refresh doesn't retrigger — token kept in sessionStorage
        history.replaceState({}, '', '/');
      }
      return tbl;
    } catch {
      sessionStorage.removeItem('bbq_table');
      if (urlToken) history.replaceState({}, '', '/');
      showToast('رمز الطاولة غير صالح');
      return null;
    }
  }

  function applyTableBadge() {
    const el = $('#table-badge');
    if (!el) return;
    if (STATE.table) {
      el.classList.remove('hidden');
      $('#table-badge-number').textContent = `#${STATE.table.number}`;
    } else {
      el.classList.add('hidden');
    }
  }

  const requireTable = () =>
    STATE.restaurant?.orders?.require_table !== false;

  // ---------- Load data ----------
  async function load() {
    try {
      STATE.table = await detectTable();
      applyTableBadge();
      document.dispatchEvent(new CustomEvent('bbq-table-ready', { detail: STATE.table }));

      const [menuRes, restRes] = await Promise.all([
        fetch('/api/menu'),
        fetch('/api/restaurant'),
      ]);
      STATE.menu = await menuRes.json();
      STATE.restaurant = await restRes.json();
      applyBranding();
      renderChips();
      renderMenu();
      updateCartCount();
    } catch (e) {
      showToast('تعذر تحميل المنيو، حدّث الصفحة');
      console.error(e);
    }
  }

  function applyBranding() {
    const r = STATE.restaurant;
    if (!r) return;
    document.title = `${r.name_en || 'Barbeque Pizza'} — ${r.name || ''}`;
    $('#brand-name').textContent = r.name || '';
    $('#brand-tag').textContent = r.name_en || '';
    $('#hero-title').textContent = r.tagline || 'ألذ بيتزا في المدينة';
    $('#footer-name').textContent = r.name || '';

    if (r.theme?.primary) {
      document.documentElement.style.setProperty('--primary', r.theme.primary);
    }
    if (r.theme?.primary_dark) {
      document.documentElement.style.setProperty('--primary-dark', r.theme.primary_dark);
    }

    // Hero badges (dine-in mode: table + phone only)
    const badges = [];
    if (STATE.table) badges.push(`🪑 طاولة #${STATE.table.number}`);
    if (r.phone) badges.push(`📞 ${r.phone}`);
    $('#hero-badges').innerHTML = badges.map((b) => `<span class="badge">${escapeHtml(b)}</span>`).join('');

    // Footer info
    $('#footer-phone').textContent = r.phone ? `📞 ${r.phone}` : '';
    $('#footer-address').textContent = r.address ? `📍 ${r.address}` : '';
    $('#footer-hours').textContent = r.hours ? `🕒 ${r.hours}` : '';
  }

  // ---------- Category chips ----------
  function renderChips() {
    const chipsEl = $('#chips');
    const cats = STATE.menu?.categories || [];
    const html = ['<button class="chip active" data-cat="all">الكل</button>'];
    cats.forEach((c) => {
      html.push(
        `<button class="chip" data-cat="${c.id}">${c.icon || ''} ${escapeHtml(c.name)}</button>`
      );
    });
    chipsEl.innerHTML = html.join('');
    chipsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      $$('.chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.filters.category = btn.dataset.cat;
      renderMenu();
    });
  }

  // ---------- Menu grid ----------
  function itemMatchesFilters(item) {
    const f = STATE.filters;
    if (f.vegetarian && !item.vegetarian) return false;
    if (f.spicy && !item.spicy) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = `${item.name} ${item.name_en || ''} ${item.description || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderMenu() {
    const menuEl = $('#menu-content');
    const emptyEl = $('#menu-empty');
    const cats = STATE.menu?.categories || [];
    const html = [];
    let totalShown = 0;

    for (const cat of cats) {
      if (STATE.filters.category !== 'all' && String(cat.id) !== String(STATE.filters.category))
        continue;
      const items = cat.items.filter(itemMatchesFilters);
      if (!items.length) continue;
      totalShown += items.length;

      html.push(`
        <section class="category-block" data-cat="${cat.id}">
          <header class="category-header">
            <span class="category-icon">${cat.icon || '🍽️'}</span>
            <h2 class="category-title">${escapeHtml(cat.name)}</h2>
          </header>
          <div class="items-grid">
            ${items.map(itemCardHtml).join('')}
          </div>
        </section>
      `);
    }

    if (!totalShown) {
      menuEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
    } else {
      menuEl.innerHTML = html.join('');
      emptyEl.classList.add('hidden');
      wireItemCards();
    }
  }

  function itemCardHtml(item) {
    const tags = [];
    if (item.vegetarian) tags.push('<span class="item-tag veg">نباتي</span>');
    if (item.spicy) tags.push('<span class="item-tag spicy">حار 🌶</span>');
    if (!item.available) tags.push('<span class="item-tag off">غير متوفر</span>');
    const priceLabel = item.sizes ? `<small>يبدأ من</small>${money(startPrice(item))}` : money(startPrice(item));
    return `
      <article class="item-card ${item.available ? '' : 'unavailable'}" data-id="${item.id}">
        <div class="item-image">
          ${item.image
            ? `<img src="/img/${item.image}?w=400" srcset="/img/${item.image}?w=400 1x, /img/${item.image}?w=640 2x" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'placeholder',textContent:'🍕'}))">`
            : `<div class="placeholder">🍕</div>`}
          ${tags.length ? `<div class="item-tags">${tags.join('')}</div>` : ''}
        </div>
        <div class="item-body">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-desc">${escapeHtml(item.description || '')}</div>
          <div class="item-price-row">
            <div class="item-price">${priceLabel}</div>
            <button class="item-add" aria-label="إضافة" data-add="${item.id}">+</button>
          </div>
        </div>
      </article>
    `;
  }

  function wireItemCards() {
    $$('.item-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const id = card.dataset.id;
        const item = findItem(id);
        if (!item || !item.available) {
          if (!item?.available) showToast('هذا الصنف غير متوفر حالياً');
          return;
        }
        if (e.target.matches('[data-add]')) {
          e.stopPropagation();
        }
        openItemModal(item);
      });
    });
  }

  function findItem(id) {
    for (const c of STATE.menu.categories) {
      for (const i of c.items) if (String(i.id) === String(id)) return i;
    }
    return null;
  }

  // ---------- Item modal ----------
  function openItemModal(item) {
    STATE.modalItem = item;
    STATE.modalQty = 1;
    STATE.modalSize = item.sizes ? item.sizes[Math.floor(item.sizes.length / 2)] : null;

    const imgEl = $('#modal-img');
    imgEl.innerHTML = item.image
      ? `<img src="/img/${item.image}?w=800" alt="${escapeHtml(item.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'placeholder',textContent:'🍕'}))">`
      : `<div class="placeholder">🍕</div>`;

    const tags = [];
    if (item.vegetarian) tags.push('<span class="item-tag veg">نباتي</span>');
    if (item.spicy) tags.push('<span class="item-tag spicy">حار 🌶</span>');
    $('#modal-tags').innerHTML = tags.join('');
    $('#modal-name').textContent = item.name;
    $('#modal-desc').textContent = item.description || '';

    const sizesEl = $('#modal-sizes');
    if (item.sizes && item.sizes.length) {
      const labels = { S: 'صغير', M: 'وسط', L: 'كبير', XL: 'عائلي' };
      sizesEl.innerHTML = `
        <div class="sizes-title">اختر الحجم:</div>
        <div class="sizes-grid">
          ${item.sizes.map((s, idx) => `
            <div class="size-option ${idx === Math.floor(item.sizes.length / 2) ? 'selected' : ''}" data-size="${s.name}">
              <div class="label">${labels[s.name] || s.name} (${s.name})</div>
              <div class="price">${money(s.price)}</div>
            </div>
          `).join('')}
        </div>`;
      sizesEl.querySelectorAll('.size-option').forEach((el) => {
        el.addEventListener('click', () => {
          sizesEl.querySelectorAll('.size-option').forEach((o) => o.classList.remove('selected'));
          el.classList.add('selected');
          STATE.modalSize = item.sizes.find((s) => s.name === el.dataset.size);
          updateModalTotal();
        });
      });
    } else {
      sizesEl.innerHTML = '';
    }

    $('#qty-value').textContent = '1';
    updateModalTotal();
    $('#item-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function updateModalTotal() {
    const item = STATE.modalItem;
    const unit = STATE.modalSize ? STATE.modalSize.price : (item?.price ?? 0);
    const total = unit * STATE.modalQty;
    $('#modal-total').textContent = money(total);
  }

  function closeItemModal() {
    $('#item-modal').classList.add('hidden');
    document.body.style.overflow = '';
    STATE.modalItem = null;
  }

  $('#item-close').addEventListener('click', closeItemModal);
  $('#item-modal').addEventListener('click', (e) => { if (e.target.id === 'item-modal') closeItemModal(); });
  $('#qty-inc').addEventListener('click', () => {
    if (STATE.modalQty < 30) { STATE.modalQty++; $('#qty-value').textContent = STATE.modalQty; updateModalTotal(); }
  });
  $('#qty-dec').addEventListener('click', () => {
    if (STATE.modalQty > 1) { STATE.modalQty--; $('#qty-value').textContent = STATE.modalQty; updateModalTotal(); }
  });
  $('#add-to-cart').addEventListener('click', () => {
    const item = STATE.modalItem;
    if (!item) return;
    const size = STATE.modalSize;
    const unit = size ? size.price : item.price;
    STATE.cart.push({
      item_id: item.id,
      name: item.name,
      image: item.image,
      size: size ? size.name : null,
      quantity: STATE.modalQty,
      unit_price: unit,
      line_total: unit * STATE.modalQty,
    });
    saveCart();
    updateCartCount();
    closeItemModal();
    showToast(`تمت الإضافة: ${item.name}`);
  });

  // ---------- Cart ----------
  function updateCartCount() {
    const count = STATE.cart.reduce((s, i) => s + i.quantity, 0);
    $('#cart-count').textContent = count;
  }

  function openCart() {
    renderCart();
    $('#cart-drawer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeCart() {
    $('#cart-drawer').classList.add('hidden');
    document.body.style.overflow = '';
  }
  $('#open-cart').addEventListener('click', openCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#cart-drawer').addEventListener('click', (e) => { if (e.target.id === 'cart-drawer') closeCart(); });

  function renderCart() {
    const body = $('#cart-body');
    if (!STATE.cart.length) {
      body.innerHTML = '';
      $('#cart-totals').innerHTML = '';
      $('#checkout-btn').disabled = true;
      return;
    }
    $('#checkout-btn').disabled = false;
    body.innerHTML = STATE.cart.map((it, idx) => {
      const hasNote = !!(it.note && it.note.trim());
      const noteOpen = !!it._noteOpen || hasNote;
      return `
      <div class="cart-item-wrap ${noteOpen ? 'note-open' : ''}" data-idx="${idx}">
        <div class="cart-item">
          <div class="cart-item-img">${it.image
            ? `<img src="/img/${it.image}?w=160" alt="${escapeHtml(it.name)}" loading="lazy">`
            : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:1.4rem">🍕</div>'}
          </div>
          <div class="cart-item-info">
            <div class="cart-item-name">${escapeHtml(it.name)}</div>
            <div class="cart-item-meta">${it.size ? `الحجم ${it.size} · ` : ''}الكمية ${it.quantity} × ${money(it.unit_price)}</div>
            ${hasNote ? `<div class="cart-item-note-badge">🗒️ ${escapeHtml(it.note)}</div>` : ''}
          </div>
          <div class="cart-item-total">${money(it.line_total)}</div>
          <div class="cart-item-actions">
            <button class="cart-item-note-toggle ${hasNote ? 'active' : ''}" data-note-toggle="${idx}" title="ملاحظة على هذا الصنف" aria-label="ملاحظة">🗒️</button>
            <button class="cart-item-remove" data-idx="${idx}" aria-label="حذف">🗑</button>
          </div>
        </div>
        <div class="cart-item-note-box ${noteOpen ? '' : 'hidden'}">
          <textarea data-note-input="${idx}" rows="2" maxlength="200"
            placeholder="ملاحظة على ${escapeHtml(it.name)} (مثلاً: بدون بصل، حار زيادة)">${escapeHtml(it.note || '')}</textarea>
        </div>
      </div>`;
    }).join('');
    body.querySelectorAll('.cart-item-remove').forEach((b) => {
      b.addEventListener('click', () => {
        STATE.cart.splice(Number(b.dataset.idx), 1);
        saveCart();
        updateCartCount();
        renderCart();
      });
    });
    body.querySelectorAll('[data-note-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.noteToggle);
        STATE.cart[i]._noteOpen = !STATE.cart[i]._noteOpen && !(STATE.cart[i].note || '').trim();
        // If we're opening (no existing note): flip to open. If already showing (note exists), toggle closed.
        const wrap = b.closest('.cart-item-wrap');
        const box = wrap?.querySelector('.cart-item-note-box');
        if (!box) return;
        const wasHidden = box.classList.contains('hidden');
        box.classList.toggle('hidden');
        if (wasHidden) {
          const ta = box.querySelector('textarea');
          ta?.focus();
        }
      });
    });
    body.querySelectorAll('[data-note-input]').forEach((ta) => {
      ta.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.noteInput);
        STATE.cart[i].note = e.target.value.trim() || null;
        saveCart();
      });
      ta.addEventListener('blur', renderCart);
    });
    const subtotal = STATE.cart.reduce((s, i) => s + i.line_total, 0);
    const total = subtotal;
    let note = '';
    if (STATE.table) {
      note = `<div class="row" style="color:#2563eb"><span>🪑 الطاولة</span><span>#${escapeHtml(STATE.table.number)}</span></div>`;
    } else if (requireTable()) {
      note = `<div class="row" style="color:#b91c1c">⚠️ امسح رمز QR الموجود على طاولتك لتفعيل الطلب</div>`;
    }
    $('#cart-totals').innerHTML = `
      ${note}
      <div class="row total"><span>المجموع الكلي</span><span>${money(total)}</span></div>
    `;
    const checkoutBtn = $('#checkout-btn');
    if (checkoutBtn) {
      const blocked = requireTable() && !STATE.table;
      checkoutBtn.disabled = !STATE.cart.length || blocked;
    }
  }

  // ---------- Checkout ----------
  function applyCheckoutMode() {
    const usingTable = !!STATE.table;
    $('#field-table').classList.toggle('hidden', !usingTable);
    $('#table-notice-checkout').classList.toggle('hidden', !usingTable);
    if (usingTable) {
      $('#checkout-table-number').textContent = `#${STATE.table.number}`;
      $('#checkout-table-input').value = STATE.table.number;
    }
  }

  $('#checkout-btn').addEventListener('click', () => {
    if (!STATE.cart.length) return;
    if (requireTable() && !STATE.table) {
      showToast('امسح رمز QR الموجود على الطاولة لتفعيل الطلب');
      return;
    }
    closeCart();
    renderOrderSummary();
    applyCheckoutMode();
    $('#order-success').classList.add('hidden');
    $('#order-form').classList.remove('hidden');
    $('#checkout-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
  $('#checkout-close').addEventListener('click', () => {
    $('#checkout-modal').classList.add('hidden');
    document.body.style.overflow = '';
  });
  $('#checkout-modal').addEventListener('click', (e) => {
    if (e.target.id === 'checkout-modal') {
      $('#checkout-modal').classList.add('hidden');
      document.body.style.overflow = '';
    }
  });

  function renderOrderSummary() {
    const subtotal = STATE.cart.reduce((s, i) => s + i.line_total, 0);
    const total = subtotal;
    $('#order-summary').innerHTML = `
      <div class="row"><span>${STATE.cart.length} صنف</span><span>${money(subtotal)}</span></div>
      <div class="row total"><span>المجموع الكلي</span><span>${money(total)}</span></div>
    `;
  }

  $('#order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const needTable = requireTable();
    if (needTable && !STATE.table) {
      showToast('امسح رمز QR الموجود على الطاولة أولاً');
      return;
    }
    const payload = {
      customer_name: form.customer_name.value.trim(),
      table_token: STATE.table ? STATE.table.token : null,
      notes: form.notes.value.trim() || null,
      items: STATE.cart.map((it) => ({
        item_id: it.item_id,
        name: it.name,
        size: it.size,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
        note: it.note || null,
      })),
    };
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'جارٍ الإرسال...';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'تعذر إتمام الطلب');
      }
      const data = await res.json();
      STATE.cart = [];
      saveCart();
      updateCartCount();
      form.classList.add('hidden');
      const tblLine = data.table_number
        ? `<div>الطاولة: <strong>#${escapeHtml(data.table_number)}</strong></div>`
        : '';
      const doneNote = data.table_number
        ? 'النادل رح يجيك بأسرع وقت 🍕'
        : 'طلبك وصلنا، احتفظ برقم الطلب لاستلامه من الكاشير.';
      $('#order-success').innerHTML = `
        <div style="font-size:2rem;margin-bottom:8px">✅</div>
        <div style="font-weight:800;font-size:1.1rem;margin-bottom:4px">تم استلام طلبك بنجاح</div>
        <div>رقم الطلب: <strong>#${data.id}</strong></div>
        ${tblLine}
        <div>المجموع: <strong>${money(data.total)}</strong></div>
        <div style="color:#065f46;margin-top:10px;font-size:.9rem">${doneNote}</div>
      `;
      $('#order-success').classList.remove('hidden');
    } catch (err) {
      showToast(err.message || 'خطأ في الطلب');
    } finally {
      btn.disabled = false;
      btn.textContent = 'تأكيد الطلب';
    }
  });

  // ---------- Filters wiring ----------
  $('#search').addEventListener('input', (e) => {
    STATE.filters.search = e.target.value.trim();
    renderMenu();
  });
  $('#filter-veg').addEventListener('change', (e) => {
    STATE.filters.vegetarian = e.target.checked;
    renderMenu();
  });
  $('#filter-spicy').addEventListener('change', (e) => {
    STATE.filters.spicy = e.target.checked;
    renderMenu();
  });

  // Expose openChat via widget script trigger
  $('#hero-chat').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-chat'));
  });

  // Boot
  load();
})();
