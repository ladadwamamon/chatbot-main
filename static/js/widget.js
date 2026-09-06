/* ============================================
   Chat widget — floating chatbot
   ============================================ */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const bodyEl = $('#chat-body');
  const inputEl = $('#chat-input');
  const formEl = $('#chat-form');
  const sendBtn = $('#chat-send');
  const fabBtn = $('#chat-fab');
  const panelEl = $('#chat-panel');
  const closeBtn = $('#chat-close');
  const quickEl = $('#chat-quick');

  const SIZE_LABELS = { S: 'صغير', M: 'وسط', L: 'كبير', XL: 'عائلي' };
  const CART_ASK_RE = /السلة|سلتك|سلتي|شو\s*في\s*السلة|شو\s*عندي|طلب(?:ي|ك)\s*الحالي/;

  const state = {
    open: false,
    loading: false,
    history: [],
    sessionId: sessionStorage.getItem('bbq_session') || null,
  };
  const MAX_HISTORY = 6;

  const escapeHtml = (t) => String(t ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

  const bbq = () => window.BBQ || {};
  const money = (n) => (bbq().money ? bbq().money(n) : `${Number(n).toLocaleString('en-US')} شيكل`);

  function sanitizeReply(text) {
    if (!text) return '';
    text = String(text).replace(/\[\[\s*cards[\s\S]*/i, '');
    text = text.replace(/\{[\s\S]{0,80}"items"[\s\S]*/i, '');
    const leak = /cards?\s+generation|ids?\s+mentioned|check\s+constraints?|no\s+markdown|show_cart|\[\[\s*\/?\s*cards/i;
    return text.split('\n').filter((l) => !leak.test(l.trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function renderRich(text) {
    const lines = text.split('\n');
    const html = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) { html.push('<div style="height:5px"></div>'); continue; }
      if (/[:：]$/.test(trimmed) && !trimmed.startsWith('•') && !/^(المكونات|التفاصيل|الأسعار|السعر)/.test(trimmed)) {
        html.push(`<div class="section-title">${escapeHtml(trimmed)}</div>`); continue;
      }
      if (/^[•·]/.test(trimmed)) {
        html.push(`<div class="item-name-line">${escapeHtml(trimmed.replace(/^[•·]\s*/, ''))}</div>`); continue;
      }
      if (/^\s*(المكونات|التفاصيل)\s*:/.test(trimmed)) {
        html.push(`<div class="item-desc-line">${escapeHtml(trimmed)}</div>`); continue;
      }
      if (/^\s*(الأسعار|السعر)\s*:/.test(trimmed)) {
        html.push(`<div class="item-prices-line">${escapeHtml(trimmed.replace(/^\s*(الأسعار|السعر)\s*:\s*/, ''))}</div>`); continue;
      }
      html.push(`<div class="plain-line">${escapeHtml(trimmed)}</div>`);
    }
    return html.join('');
  }

  function defaultSizeName(item) {
    if (!item?.sizes?.length) return '';
    return item.sizes[Math.floor(item.sizes.length / 2)].name;
  }

  function priceLabel(item, sizeName) {
    if (item.sizes?.length) {
      const size = item.sizes.find((s) => s.name === sizeName) || item.sizes[0];
      return money(size.price);
    }
    return item.price != null ? money(item.price) : '—';
  }

  function itemCardHtml(item) {
    const selected = defaultSizeName(item);
    const sizes = (item.sizes || []).map((s) => `
      <button type="button" class="chat-size ${s.name === selected ? 'selected' : ''}"
        data-chat-size="${escapeHtml(s.name)}">${SIZE_LABELS[s.name] || s.name}</button>
    `).join('');
    const img = item.image
      ? `<img src="/img/${item.image}?w=160" alt="" loading="lazy">`
      : `<span class="chat-item-ph">🍕</span>`;
    return `
      <article class="chat-item-card" data-chat-item="${item.id}" data-size="${escapeHtml(selected)}">
        <div class="chat-item-top">
          <div class="chat-item-img">${img}</div>
          <div class="chat-item-meta">
            <div class="chat-item-name">${escapeHtml(item.name)}</div>
            <div class="chat-item-price" data-chat-price>${priceLabel(item, selected)}</div>
          </div>
        </div>
        ${sizes ? `<div class="chat-sizes">${sizes}</div>` : ''}
        <div class="chat-item-actions">
          <button type="button" class="chat-btn primary" data-chat-add="${item.id}">أضف للسلة</button>
          <button type="button" class="chat-btn ghost" data-chat-goto-item="${item.id}">شوفه بالمنيو</button>
        </div>
      </article>
    `;
  }

  function categoryCardHtml(cat) {
    return `
      <article class="chat-cat-card">
        <div class="chat-cat-info">
          <span class="chat-cat-icon">${cat.icon || '🍽️'}</span>
          <div>
            <div class="chat-cat-name">${escapeHtml(cat.name)}</div>
            <div class="chat-cat-hint">انتقال مباشر لهذا القسم</div>
          </div>
        </div>
        <button type="button" class="chat-btn ghost" data-chat-goto-cat="${cat.id}">روح للقسم</button>
      </article>
    `;
  }

  function cartCardHtml() {
    const summary = bbq().getCartSummary ? bbq().getCartSummary() : { items: [], count: 0, total: 0 };
    if (!summary.items.length) {
      return `
        <article class="chat-cart-card">
          <div class="chat-cart-title">سلتك</div>
          <div class="chat-cart-empty">السلة فارغة — اختار صنف من البطاقات فوق.</div>
        </article>
      `;
    }
    const lines = summary.items.map((it) => `
      <div class="chat-cart-row">
        <span>${escapeHtml(it.name)}${it.size ? ` · ${escapeHtml(it.size)}` : ''} × ${it.quantity}</span>
        <strong>${money(it.line_total)}</strong>
      </div>
    `).join('');
    return `
      <article class="chat-cart-card">
        <div class="chat-cart-title">سلتك · ${summary.count} صنف</div>
        <div class="chat-cart-lines">${lines}</div>
        <div class="chat-cart-total">
          <span>المجموع</span>
          <strong>${money(summary.total)}</strong>
        </div>
        <button type="button" class="chat-btn primary block" data-chat-open-cart>فتح السلة</button>
      </article>
    `;
  }

  function inferIdsFromText(text, kind) {
    const menu = bbq().getMenu?.();
    if (!menu || !text) return [];
    const pairs = [];
    if (kind === 'item') {
      for (const cat of menu.categories || []) {
        for (const it of cat.items || []) {
          if (it.available === false) continue;
          if (it.name) pairs.push([it.name, it.id]);
          if (it.name_en) pairs.push([it.name_en, it.id]);
        }
      }
    } else {
      for (const cat of menu.categories || []) {
        if (cat.name) pairs.push([cat.name, cat.id]);
        if (cat.name_en) pairs.push([cat.name_en, cat.id]);
      }
    }
    const hits = [];
    for (const [name, id] of pairs) {
      if (name.length < 4) continue;
      let start = 0;
      while (true) {
        const i = text.indexOf(name, start);
        if (i < 0) break;
        hits.push({ s: i, e: i + name.length, id });
        start = i + name.length;
      }
    }
    hits.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
    const occupied = [];
    const found = [];
    const seen = new Set();
    for (const h of hits) {
      if (seen.has(h.id)) continue;
      if (occupied.some((o) => h.s < o.e && h.e > o.s)) continue;
      seen.add(h.id);
      occupied.push(h);
      found.push(h.id);
    }
    return found;
  }

  function resolveExtras(data, reply, userText) {
    const findItem = bbq().findItem;
    const menu = bbq().getMenu?.();
    let itemIds = (data.items || []).slice(0, 4);
    let catIds = (data.categories || []).slice(0, 2);
    if (!itemIds.length) itemIds = inferIdsFromText(reply, 'item').slice(0, 4);
    if (!catIds.length) catIds = inferIdsFromText(reply, 'category').slice(0, 2);
    const items = itemIds.map((id) => findItem?.(id)).filter((it) => it && it.available !== false);
    const cats = (menu?.categories || []).filter((c) => catIds.some((id) => String(c.id) === String(id)));
    const showCart = !!(data.show_cart || CART_ASK_RE.test(userText || '') || CART_ASK_RE.test(reply || ''));
    return { items, cats, showCart };
  }

  function extrasHtml(extras) {
    if (!extras) return '';
    const parts = [];
    extras.items?.forEach((it) => parts.push(itemCardHtml(it)));
    extras.cats?.forEach((c) => parts.push(categoryCardHtml(c)));
    if (extras.showCart) parts.push(cartCardHtml());
    if (!parts.length) return '';
    return `<div class="chat-cards">${parts.join('')}</div>`;
  }

  function addMessage(text, role, isError = false, extras = null) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}${isError ? ' error' : ''}`;
    const bubbleClass = role === 'bot' && !isError ? 'rich' : '';
    msg.innerHTML = `
      <div class="msg-avatar">${role === 'user' ? '👤' : '🤖'}</div>
      <div class="msg-stack">
        <div class="msg-bubble ${bubbleClass}">
          ${role === 'bot' && !isError ? renderRich(text) : escapeHtml(text)}
        </div>
        ${role === 'bot' && !isError ? extrasHtml(extras) : ''}
      </div>`;
    bodyEl.appendChild(msg);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return msg;
  }

  function refreshCartCards() {
    bodyEl.querySelectorAll('.chat-cart-card').forEach((el) => {
      el.outerHTML = cartCardHtml();
    });
  }

  function ensureCartCard(msgEl) {
    const stack = msgEl?.querySelector('.msg-stack');
    if (!stack) return;
    let cards = stack.querySelector('.chat-cards');
    if (!cards) {
      cards = document.createElement('div');
      cards.className = 'chat-cards';
      stack.appendChild(cards);
    }
    const existing = cards.querySelector('.chat-cart-card');
    if (existing) existing.outerHTML = cartCardHtml();
    else cards.insertAdjacentHTML('beforeend', cartCardHtml());
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'msg bot typing';
    el.id = 'typing-msg';
    el.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-stack">
        <div class="msg-bubble">
          <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
        </div>
      </div>`;
    bodyEl.appendChild(el);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function hideTyping() {
    document.getElementById('typing-msg')?.remove();
  }

  function currentCartPayload() {
    const cart = bbq().getCart?.() || [];
    return cart.map((i) => ({
      name: i.name,
      size: i.size || null,
      quantity: i.quantity,
      line_total: i.line_total,
    }));
  }

  async function send(text) {
    text = text.trim();
    if (!text || state.loading) return;
    state.loading = true;
    sendBtn.disabled = true;
    inputEl.value = '';

    addMessage(text, 'user');
    state.history.push({ role: 'user', content: text });
    showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: state.history.slice(0, -1).slice(-MAX_HISTORY),
          session_id: state.sessionId,
          cart: currentCartPayload(),
        }),
      });
      hideTyping();
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addMessage(err.detail || 'حدث خطأ، حاول مرة أخرى', 'bot', true);
        return;
      }
      const data = await res.json();
      if (data.session_id) {
        state.sessionId = data.session_id;
        sessionStorage.setItem('bbq_session', data.session_id);
      }
      const reply = sanitizeReply(data.reply);
      const extras = resolveExtras(data, reply, text);
      addMessage(reply, 'bot', false, extras);
      state.history.push({ role: 'assistant', content: reply });
      while (state.history.length > MAX_HISTORY) state.history.shift();
    } catch (e) {
      hideTyping();
      addMessage('تعذر الاتصال بالخادم. تأكد من اتصالك بالإنترنت.', 'bot', true);
    } finally {
      state.loading = false;
      sendBtn.disabled = false;
      if (!isMobile()) inputEl.focus();
    }
  }

  const overlayEl = $('#chat-overlay');

  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;

  function syncChatHeight() {
    if (!isMobile() || !state.open) {
      panelEl.style.removeProperty('--chat-h');
      return;
    }
    const vv = window.visualViewport;
    const visible = vv?.height || window.innerHeight;
    const keyboardOpen = !!(vv && (window.innerHeight - vv.height > 90));
    const gap = keyboardOpen ? 16 : Math.round(Math.min(120, visible * 0.22));
    const h = Math.max(260, Math.round(visible - gap));
    panelEl.style.setProperty('--chat-h', `${h}px`);
  }

  window.visualViewport?.addEventListener('resize', syncChatHeight);
  window.visualViewport?.addEventListener('scroll', syncChatHeight);
  window.addEventListener('resize', syncChatHeight);
  window.addEventListener('orientationchange', () => setTimeout(syncChatHeight, 200));

  function openChat() {
    if (state.open) return;
    state.open = true;
    fabBtn.classList.add('hidden');
    overlayEl?.classList.remove('hidden');
    panelEl.classList.remove('hidden');
    if (isMobile()) {
      document.body.classList.add('chat-open-mobile');
      syncChatHeight();
    } else {
      setTimeout(() => inputEl.focus(), 200);
    }
  }
  function closeChat() {
    state.open = false;
    fabBtn.classList.remove('hidden');
    overlayEl?.classList.add('hidden');
    panelEl.classList.add('hidden');
    document.body.classList.remove('chat-open-mobile');
    panelEl.style.removeProperty('--chat-h');
    inputEl.blur();
  }

  inputEl.addEventListener('focus', () => {
    if (!isMobile()) return;
    setTimeout(() => {
      syncChatHeight();
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }, 280);
  });

  fabBtn.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);
  overlayEl?.addEventListener('click', closeChat);
  document.addEventListener('open-chat', openChat);
  document.addEventListener('close-chat', closeChat);
  document.addEventListener('bbq-cart-changed', refreshCartCards);

  bodyEl.addEventListener('click', (e) => {
    const sizeBtn = e.target.closest('[data-chat-size]');
    if (sizeBtn) {
      const card = sizeBtn.closest('[data-chat-item]');
      if (!card) return;
      card.querySelectorAll('[data-chat-size]').forEach((b) => b.classList.remove('selected'));
      sizeBtn.classList.add('selected');
      card.dataset.size = sizeBtn.dataset.chatSize;
      const item = bbq().findItem?.(card.dataset.chatItem);
      const priceEl = card.querySelector('[data-chat-price]');
      if (item && priceEl) priceEl.textContent = priceLabel(item, card.dataset.size);
      return;
    }

    const addBtn = e.target.closest('[data-chat-add]');
    if (addBtn) {
      const card = addBtn.closest('[data-chat-item]');
      const item = bbq().findItem?.(addBtn.dataset.chatAdd);
      if (!item || !bbq().addToCart) return;
      const line = bbq().addToCart(item, { sizeName: card?.dataset.size || null, quantity: 1 });
      if (!line) return;
      addBtn.classList.add('done');
      addBtn.textContent = 'تمت الإضافة ✓';
      setTimeout(() => {
        addBtn.classList.remove('done');
        addBtn.textContent = 'أضف للسلة';
      }, 1400);
      ensureCartCard(card?.closest('.msg'));
      return;
    }

    const gotoItem = e.target.closest('[data-chat-goto-item]');
    if (gotoItem) {
      bbq().navigateToItem?.(gotoItem.dataset.chatGotoItem);
      return;
    }

    const gotoCat = e.target.closest('[data-chat-goto-cat]');
    if (gotoCat) {
      bbq().navigateToCategory?.(gotoCat.dataset.chatGotoCat);
      return;
    }

    if (e.target.closest('[data-chat-open-cart]')) {
      closeChat();
      setTimeout(() => bbq().openCart?.(), 160);
    }
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    send(inputEl.value);
  });

  function currentTable() {
    try {
      if (window.BBQ?.getTable) return window.BBQ.getTable();
      const raw = sessionStorage.getItem('bbq_table');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function greetingWithTable(base) {
    const t = currentTable();
    if (t && t.number != null) {
      return `${base}\n\n🪑 أنت على الطاولة رقم ${t.number} — الطلب رح يوصلك مباشرة.`;
    }
    return base;
  }

  async function init() {
    let welcome = 'أهلاً بك! أنا مساعد المطعم. اسألني عن أي صنف، السعر، أو المكونات 🍕';
    let chatEnabled = true;
    try {
      const r = await fetch('/api/restaurant');
      if (r.ok) {
        const data = await r.json();
        if (data.chatbot?.welcome) welcome = data.chatbot.welcome;
        chatEnabled = data.chatbot?.enabled !== false;
      }
    } catch {}

    if (!chatEnabled) {
      fabBtn.classList.add('hidden');
      return;
    }

    const tableReady = new Promise((resolve) => {
      if (currentTable()) return resolve();
      const done = () => { document.removeEventListener('bbq-table-ready', done); resolve(); };
      document.addEventListener('bbq-table-ready', done);
      setTimeout(done, 1500);
    });
    await tableReady;

    addMessage(greetingWithTable(welcome), 'bot');
    quickEl.innerHTML = `
      <button data-q="شو أنواع البيتزا الموجودة؟">🍕 البيتزا</button>
      <button data-q="اقترحي عليّ وجبة">💡 اقتراح</button>
      <button data-q="شو في السلة؟">🛒 السلة</button>
      <button data-q="وديني على قسم البيتزا">📍 الأقسام</button>
    `;
    quickEl.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => send(b.dataset.q));
    });
  }
  init();
})();
