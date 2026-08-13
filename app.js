(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const state = {
    messages: [],
    provider: localStorage.getItem('nx9_provider') || 'gemini',
    apiKey: localStorage.getItem('nx9_key') || '',
    model: localStorage.getItem('nx9_model') || '',
    dark: localStorage.getItem('nx9_dark') !== '0',
    haptic: localStorage.getItem('nx9_haptic') !== '0',
    tokens: 0,
    startedAt: Date.now(),
    shopeeLogged: localStorage.getItem('nx9_shopee') === '1',
  };

  const MODELS = {
    gemini: 'gemini-2.5-flash',
    groq: 'llama-3.3-70b-versatile',
    openai: 'gpt-4o-mini',
    claude: 'claude-3-5-haiku-latest',
  };

  const haptic = () => { if (state.haptic && navigator.vibrate) navigator.vibrate(12); };
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtTime = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  function setStatus(text, online = false) {
    const bar = $('#statusBar');
    if (!text) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.classList.toggle('online', online);
    bar.innerHTML = `<span class="dot"></span>${esc(text)}`;
  }

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      haptic();
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab.dataset.view}`));
    });
  });

  const linkify = (t) => esc(t).replace(
    /(https?:\/\/[^\s<>"']+|shopee:\/\/[^\s<>"']+)/g,
    (u) => `<a href="${u}" target="_blank" rel="noopener" style="color:var(--accent2);text-decoration:underline">${u}</a>`
  );

  function renderMarkup(text) {
    const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
    if (parts.length === 1) return linkify(text).replace(/\n/g, '<br>');
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 3 === 0) out += linkify(parts[i]).replace(/\n/g, '<br>');
      else if (i % 3 === 1) out += `<div class="tool-result">⌨️ menjalankan blok <b>${esc(parts[i] || 'code')}</b>…</div>`;
      else out += `<pre class="code">${esc(parts[i])}</pre>`;
    }
    return out;
  }

  function addMessage(role, text, extra = '') {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.innerHTML = `
      <div class="avatar">${role === 'user' ? '🧑' : '🤖'}</div>
      <div>
        <div class="bubble">${renderMarkup(text)}${extra}</div>
        <div class="meta"><span>${fmtTime()}</span>${role === 'bot' ? '<span>NEXUS-9</span>' : ''}</div>
      </div>`;
    $('#chatList').appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return el;
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML = `<div class="avatar">🤖</div><div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
    $('#chatList').appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return el;
  }

  async function askAgent(userText, tool) {
    if (!state.apiKey) {
      addMessage('bot', 'Belum ada API key nih. Buka tab ⚙️ Setelan, isi key dari Gemini/Groq/GPT/Claude, lalu simpan. Key kamu hanya tersimpan di browser ini.');
      return;
    }
    const typingEl = addTyping();
    const payload = {
      provider: state.provider,
      apiKey: state.apiKey,
      model: state.model || MODELS[state.provider],
      messages: state.messages.slice(-12).concat({ role: 'user', content: userText }),
      tool,
      shopeeLogged: state.shopeeLogged,
    };
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      typingEl.remove();
      state.tokens += (data.usage?.total || data.usage || 0);
      $('#statTokens').textContent = state.tokens.toLocaleString('id-ID');
      addMessage('bot', data.text);
      state.messages.push({ role: 'assistant', content: data.text });
    } catch (err) {
      typingEl.remove();
      addMessage('bot', `⚠️ Gagal menghubungi provider: ${err.message}`, `<div class="tool-result error">Cek API key & model di ⚙️ Setelan.</div>`);
    }
  }

  function send() {
    const input = $('#input');
    const text = input.value.trim();
    if (!text) return;
    haptic();
    addMessage('user', text);
    state.messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    $('#statMessages').textContent = state.messages.length;
    askAgent(text, null);
  }

  $('#btnSend').addEventListener('click', send);
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#input').addEventListener('input', () => {
    const el = $('#input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  });

  $('#btnReset').addEventListener('click', () => {
    if (!confirm('Hapus seluruh percakapan?')) return;
    state.messages = [];
    $('#chatList').innerHTML = `
      <div class="welcome card">
        <div class="welcome-glow"></div>
        <h2>Halo, aku NEXUS-9 👋</h2>
        <p>Aku agent AI kamu — bisa browsing web, cari & pesan di Shopee, tulis kode, dan bantu apa saja. Pakai <b>API key kamu sendiri</b>, tersimpan aman cuma di browser ini.</p>
        <div class="welcome-tools">
          <span class="chip">🌐 Web Search</span>
          <span class="chip">🛒 Shopee</span>
          <span class="chip">⌨️ Code</span>
          <span class="chip">🧩 MCP Tools</span>
        </div>
      </div>`;
    $('#statMessages').textContent = '0';
  });

  $$('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic();
      const tool = btn.dataset.tool;
      const prompts = {
        web: 'Cari info terkini dari internet lalu rangkum dalam bahasa Indonesia:',
        shopee: 'Cari produk di Shopee (live):',
        code: 'Gunakan tool code: tulis kode yang rapi, lengkap dengan penjelasan singkat.',
      };
      let v = prompts[tool] || '';
      if (tool === 'shopee' && state.shopeeLogged) v = 'Saya sudah login Shopee. Cari produk lalu siapkan pesanan:';
      $('#input').value = v;
      $('#input').focus();
    });
  });

  function renderShopee() {
    const el = $('#shopeeStatus');
    el.classList.toggle('logged', state.shopeeLogged);
    el.innerHTML = `<div class="status-dot"></div>${state.shopeeLogged ? 'Terhubung — NEXUS-9 boleh membuat pesanan di sesi Shopee kamu.' : 'Belum login — auto order belum aktif.'}`;
    $('#btnShopeeConfirm').hidden = state.shopeeLogged;
    $('#btnShopeeLogout').hidden = !state.shopeeLogged;
  }
  $('#shopeeLoginWeb').addEventListener('click', () => { haptic(); setStatus('Login di tab Shopee, lalu tekan "Saya sudah login"', false); });
  $('#shopeeOpenApp').addEventListener('click', () => haptic());
  $('#btnShopeeConfirm').addEventListener('click', () => {
    haptic();
    state.shopeeLogged = true;
    localStorage.setItem('nx9_shopee', '1');
    renderShopee();
    setStatus('Sesi Shopee aktif — auto order siap.', true);
    setTimeout(() => setStatus(''), 2200);
  });
  $('#btnShopeeLogout').addEventListener('click', () => {
    haptic();
    state.shopeeLogged = false;
    localStorage.setItem('nx9_shopee', '0');
    renderShopee();
  });
  renderShopee();

  $('#provider').value = state.provider;
  $('#apiKey').value = state.apiKey;
  $('#modelName').value = state.model;
  $('#apiKey').placeholder = `Masukkan API key ${state.provider}…`;

  $('#provider').addEventListener('change', () => {
    const p = $('#provider').value;
    if (!$('#modelName').value) $('#modelName').placeholder = `contoh: ${MODELS[p]}`;
    $('#apiKey').placeholder = `Masukkan API key ${p}…`;
  });

  $('#btnToggleKey').addEventListener('click', () => {
    const el = $('#apiKey');
    el.type = el.type === 'password' ? 'text' : 'password';
  });

  $('#btnSave').addEventListener('click', () => {
    haptic();
    state.provider = $('#provider').value;
    state.apiKey = $('#apiKey').value.trim();
    state.model = $('#modelName').value.trim();
    localStorage.setItem('nx9_provider', state.provider);
    localStorage.setItem('nx9_key', state.apiKey);
    localStorage.setItem('nx9_model', state.model);
    const msg = $('#settingsMsg');
    msg.textContent = state.apiKey ? `✅ Tersimpan — provider ${state.provider} siap dipakai.` : '⚠️ Key kosong, simpan key dulu agar bisa chat.';
    msg.style.color = state.apiKey ? 'var(--green)' : 'var(--danger)';
    setStatus('Pengaturan tersimpan', true);
    setTimeout(() => setStatus(''), 1800);
  });

  $('#themeSwitch').addEventListener('click', () => {
    const sw = $('#themeSwitch');
    sw.classList.toggle('on');
    sw.setAttribute('aria-checked', sw.classList.contains('on'));
    state.dark = sw.classList.contains('on');
    localStorage.setItem('nx9_dark', state.dark ? '1' : '0');
    document.documentElement.style.filter = state.dark ? '' : 'invert(1) hue-rotate(180deg)';
  });
  if (!state.dark) $('#themeSwitch').click();

  $('#hapticSwitch').addEventListener('click', () => {
    const sw = $('#hapticSwitch');
    sw.classList.toggle('on');
    state.haptic = sw.classList.contains('on');
    localStorage.setItem('nx9_haptic', state.haptic ? '1' : '0');
  });

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#btnInstall').hidden = false;
  });
  $('#btnInstall').addEventListener('click', () => {
    haptic();
    if (deferredPrompt) { deferredPrompt.prompt(); $('#installSheet').hidden = true; }
    else $('#installSheet').hidden = false;
  });
  $('#btnInstallCta').addEventListener('click', async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; }
    $('#installSheet').hidden = true;
  });
  $('#btnInstallLater').addEventListener('click', () => { $('#installSheet').hidden = true; });

  const updateOnline = () => setStatus(navigator.onLine ? 'Online — terhubung ke provider AI' : 'Offline — mode offline aktif', navigator.onLine);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  if (!navigator.onLine) updateOnline();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  $('#statMessages').textContent = '0';
  setInterval(() => {
    $('#statTime').textContent = Math.floor((Date.now() - state.startedAt) / 60000) + 'm';
  }, 15000);
})();
