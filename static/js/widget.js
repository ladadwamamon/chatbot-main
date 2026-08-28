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

  const state = {
    open: false,
    loading: false,
    history: [],
    sessionId: sessionStorage.getItem('bbq_session') || null,
  };
  const MAX_HISTORY = 6;

  const escapeHtml = (t) => String(t ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

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

  function addMessage(text, role, isError = false) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}${isError ? ' error' : ''}`;
    msg.innerHTML = `
      <div class="msg-avatar">${role === 'user' ? '👤' : '🤖'}</div>
      <div class="msg-bubble ${role === 'bot' && !isError ? 'rich' : ''}">
        ${role === 'bot' && !isError ? renderRich(text) : escapeHtml(text)}
      </div>`;
    bodyEl.appendChild(msg);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'msg bot typing';
    el.id = 'typing-msg';
    el.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble">
        <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
      </div>`;
    bodyEl.appendChild(el);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function hideTyping() {
    document.getElementById('typing-msg')?.remove();
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
      addMessage(data.reply, 'bot');
      state.history.push({ role: 'assistant', content: data.reply });
      while (state.history.length > MAX_HISTORY) state.history.shift();
    } catch (e) {
      hideTyping();
      addMessage('تعذر الاتصال بالخادم. تأكد من اتصالك بالإنترنت.', 'bot', true);
    } finally {
      state.loading = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  function openChat() {
    if (state.open) return;
    state.open = true;
    fabBtn.classList.add('hidden');
    panelEl.classList.remove('hidden');
    setTimeout(() => inputEl.focus(), 200);
  }
  function closeChat() {
    state.open = false;
    fabBtn.classList.remove('hidden');
    panelEl.classList.add('hidden');
  }

  fabBtn.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);
  document.addEventListener('open-chat', openChat);

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

    // Wait briefly for main.js to detect the table (fires bbq-table-ready)
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
      <button data-q="شو الأصناف النباتية؟">🥗 نباتي</button>
      <button data-q="شو الأصناف الحارة؟">🌶 حار</button>
      <button data-q="اقترحي عليّ وجبة">💡 اقتراح</button>
    `;
    quickEl.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => send(b.dataset.q));
    });
  }
  init();
})();
