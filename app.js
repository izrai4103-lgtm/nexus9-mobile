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

  /* ---------- RTK Token Saver ---------- */
  const rtkState = {
    chars: Number(localStorage.getItem('nx9_rtk_chars') || 0),
    runs: Number(localStorage.getItem('nx9_rtk_runs') || 0),
    on: localStorage.getItem('nx9_rtk_on') !== '0',
  };
  function rtkSave(meta) {
    if (meta && meta.saved > 0) {
      rtkState.chars += meta.saved;
      rtkState.runs += 1;
      localStorage.setItem('nx9_rtk_chars', String(rtkState.chars));
      localStorage.setItem('nx9_rtk_runs', String(rtkState.runs));
      renderRtk();
    }
  }
  function renderRtk() {
    $('#rtkChars').textContent = rtkState.chars > 1024 ? (rtkState.chars / 1024).toFixed(1) + 'KB' : rtkState.chars + 'B';
    $('#rtkTokens').textContent = Math.round(rtkState.chars / 4).toLocaleString('id-ID');
    $('#rtkRuns').textContent = rtkState.runs;
    $('#rtkSwitch').classList.toggle('on', rtkState.on);
  }
  const rtkBadge = (m) => (m && m.savedPct > 0 ? `<span class="rtk-badge">⚡ RTK −${m.savedPct}% · ${(m.saved / 1024).toFixed(1)}KB dihemat</span>` : '');

  /* ---------- Quota Tracking (real-time) ---------- */
  const DAY = 86400000;
  const quotaState = {
    on: localStorage.getItem('nx9_quota_on') !== '0',
    cycle: localStorage.getItem('nx9_quota_cycle') || 'daily',
    cap: Math.max(100, Number(localStorage.getItem('nx9_quota_cap') || 200000)),
    reqCap: Math.max(1, Number(localStorage.getItem('nx9_quota_reqcap') || 1000)),
    custom: Number(localStorage.getItem('nx9_quota_custom') || 0),
    resetAt: Number(localStorage.getItem('nx9_quota_resetat') || 0),
    tokens: Number(localStorage.getItem('nx9_quota_tokens') || 0),
    reqs: Number(localStorage.getItem('nx9_quota_reqs') || 0),
    prov: (() => { try { return JSON.parse(localStorage.getItem('nx9_quota_prov') || '{}'); } catch { return {}; } })(),
  };
  function nextReset(cycle, now) {
    const n = now || Date.now();
    if (cycle === 'weekly') {
      const d = new Date(n); d.setHours(24, 0, 0, 0);
      const days = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + days);
      return d.getTime();
    }
    if (cycle === 'monthly') {
      const d = new Date(n); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (cycle === 'custom') {
      let t = quotaState.custom || (n + 30 * DAY);
      while (t <= n) t += 30 * DAY;
      return t;
    }
    const d = new Date(n); d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  function quotaSave() {
    localStorage.setItem('nx9_quota_on', quotaState.on ? '1' : '0');
    localStorage.setItem('nx9_quota_cycle', quotaState.cycle);
    localStorage.setItem('nx9_quota_cap', String(quotaState.cap));
    localStorage.setItem('nx9_quota_reqcap', String(quotaState.reqCap));
    localStorage.setItem('nx9_quota_custom', String(quotaState.custom));
    localStorage.setItem('nx9_quota_resetat', String(quotaState.resetAt));
    localStorage.setItem('nx9_quota_tokens', String(quotaState.tokens));
    localStorage.setItem('nx9_quota_reqs', String(quotaState.reqs));
    localStorage.setItem('nx9_quota_prov', JSON.stringify(quotaState.prov));
  }
  function quotaReset() {
    quotaState.tokens = 0;
    quotaState.reqs = 0;
    quotaState.prov = {};
    quotaState.resetAt = nextReset(quotaState.cycle, Date.now());
    quotaSave();
    renderQuota();
  }
  function quotaPct() {
    const used = Math.max(quotaState.tokens / quotaState.cap, quotaState.reqs / quotaState.reqCap);
    return Math.min(100, Math.round(used * 100));
  }
  function quotaBlocked() {
    return quotaState.tokens >= quotaState.cap || quotaState.reqs >= quotaState.reqCap;
  }
  function quotaCountdown(ts) {
    const ms = Math.max(0, (ts || Date.now()) - Date.now());
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (v) => String(v).padStart(2, '0');
    return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
  }
  const quotaFmt = (n) => (n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n));
  function renderQuota() {
    if (!quotaState.resetAt) quotaState.resetAt = nextReset(quotaState.cycle, Date.now());
    const pct = quotaPct();
    const bar = $('#quotaBar');
    if (bar) {
      bar.style.width = pct + '%';
      bar.classList.toggle('mid', pct >= 70 && pct < 90);
      bar.classList.toggle('low', pct >= 90);
    }
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('#quotaRemain', quotaFmt(Math.max(0, quotaState.cap - quotaState.tokens)));
    set('#quotaCap', quotaFmt(quotaState.cap));
    set('#quotaTokens', quotaFmt(quotaState.tokens));
    set('#quotaReqs', quotaFmt(quotaState.reqs));
    set('#quotaCountdown', quotaCountdown(quotaState.resetAt));
    const sw = $('#quotaSwitch'); if (sw) sw.classList.toggle('on', quotaState.on);
    const cv = $('#quotaCycle'); if (cv) cv.value = quotaState.cycle;
    const ci = $('#quotaCapInput'); if (ci && document.activeElement !== ci) ci.value = quotaState.cap;
    const ri = $('#quotaReqInput'); if (ri && document.activeElement !== ri) ri.value = quotaState.reqCap;
    const cw = $('#quotaCustomWrap'); if (cw) cw.hidden = quotaState.cycle !== 'custom';
    const cd = $('#quotaCustomDate');
    if (cd && quotaState.cycle === 'custom' && quotaState.custom) {
      cd.value = new Date(quotaState.custom - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    const provs = Object.entries(quotaState.prov);
    const box = $('#quotaProviders');
    if (box) box.innerHTML = provs.length
      ? provs.map(([p, v]) => `<span class="qp-chip">${esc(p)} · <b>${quotaFmt(v.tokens)}</b> tok · <b>${v.reqs}</b> req</span>`).join('')
      : '<span class="qp-chip">Belum ada pemakaian — kirim chat dulu</span>';
    const pill = $('#quotaPill');
    if (pill) {
      const cls = pct >= 90 ? 'low' : pct >= 70 ? 'mid' : '';
      pill.className = 'quota-pill' + (cls ? ' ' + cls : '');
      pill.textContent = `📊 ${quotaState.on ? (100 - pct) + '%' : 'off'} · ${quotaCountdown(quotaState.resetAt)}`;
      pill.title = quotaState.on
        ? `Sisa ${quotaFmt(Math.max(0, quotaState.cap - quotaState.tokens))} token · reset ${quotaCountdown(quotaState.resetAt)}`
        : 'Quota tracking nonaktif — aktifkan di ⚙️ Setelan';
    }
  }
  function quotaRecord(provider, tokens) {
    if (!quotaState.on) return;
    quotaState.tokens += tokens || 0;
    quotaState.reqs += 1;
    quotaState.prov[provider] = quotaState.prov[provider] || { tokens: 0, reqs: 0 };
    quotaState.prov[provider].tokens += tokens || 0;
    quotaState.prov[provider].reqs += 1;
    quotaSave();
    renderQuota();
    if (quotaBlocked()) {
      setStatus('⛔ Kuota habis — request berikutnya diblokir sampai reset', false);
      setTimeout(() => setStatus(''), 4200);
    }
  }
  setInterval(() => {
    if (quotaState.resetAt && Date.now() >= quotaState.resetAt) {
      quotaReset();
      setStatus('Kuota diperbarui — siklus baru dimulai ⏳', true);
      setTimeout(() => setStatus(''), 2600);
    } else {
      renderQuota();
    }
  }, 1000);

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
  function addTerminal(cmd, data) {
    const el = document.createElement('div');
    el.className = 'msg bot';
    const parts = [data.stdout || '', data.stderr ? `[stderr]\n${data.stderr}` : '', data.error ? `[error] ${data.error}` : '', (!data.stdout && !data.stderr && data.ok !== false) ? `exit ${data.code}` : ''].filter(Boolean).join('\n\n');
    el.innerHTML = `
      <div class="avatar">⚡</div>
      <div>
        <div class="bubble term"><div class="c">$ ${esc(cmd)}</div>${esc(parts)}${rtkBadge(data.rtk)}</div>
        <div class="meta"><span>${fmtTime()}</span><span>Terminal · exit ${data.code}</span></div>
      </div>`;
    $('#chatList').appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    rtkSave(data.rtk);
  }

  const extractToolCmds = (t) => {
    const out = [];
    const re = /<tool>([\s\S]*?)<\/tool>/g;
    let m;
    while ((m = re.exec(t || ''))) { const c = m[1].trim(); if (c && out.length < 2) out.push(c); }
    return out;
  };
  const stripToolBlocks = (t) => (t || '').replace(/<tool>[\s\S]*?<\/tool>/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  async function execSandbox(cmd) {
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, compress: rtkState.on }),
      });
      const data = await res.json().catch(() => ({}));
      addTerminal(cmd, { ok: data.ok !== false, code: data.code ?? 1, stdout: data.stdout || '', stderr: data.stderr || '', error: data.error || '', rtk: data.rtk });
      return [data.stdout || '', data.stderr ? '\nstderr: ' + data.stderr : '', data.error ? '\n[error] ' + data.error : ''].join('').slice(0, 20000);
    } catch (err) {
      addTerminal(cmd, { ok: false, code: 1, stdout: '', stderr: '', error: err.message || 'gagal' });
      return '\n[error] ' + (err.message || 'gagal');
    }
  }

  async function askAgent(userText, tool) {
    if (!state.apiKey) {
      addMessage('bot', 'Belum ada API key nih. Buka tab ⚙️ Setelan, isi key dari Gemini/Groq/GPT/Claude, lalu simpan. Key kamu hanya tersimpan di browser ini.');
      return;
    }
    if (quotaState.on && quotaBlocked()) {
      addMessage('bot', '⛔ Kuota habis. Reset otomatis dalam ' + quotaCountdown(quotaState.resetAt) + '. Naikkan batas atau reset di ⚙️ Setelan → Quota Tracking.');
      return;
    }
    let msgs = state.messages.slice(-10).concat({ role: 'user', content: userText });
    let finalText = '';
    let round = 0;
    while (round < 3) {
      const typingEl = addTyping();
      let data;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: state.provider,
            apiKey: state.apiKey,
            model: state.model || MODELS[state.provider],
            messages: msgs,
            tool,
            shopeeLogged: state.shopeeLogged,
            round,
          }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      } catch (err) {
        typingEl.remove();
        addMessage('bot', `⚠️ Gagal menghubungi provider: ${err.message}`, `<div class="tool-result error">Cek API key & model di ⚙️ Setelan.</div>`);
        return;
      }
      typingEl.remove();
      state.tokens += (data.usage?.total || data.usage || 0);
      $('#statTokens').textContent = state.tokens.toLocaleString('id-ID');
      quotaRecord(state.provider, data.usage?.total || 0);
      finalText = data.text || '';
      const cmds = extractToolCmds(finalText);
      if (!cmds.length) break;
      addMessage('bot', '🔧 Memakai sandbox otomatis — AI menjalankan perintah lalu melanjutkan…');
      for (const c of cmds) {
        const out = await execSandbox(c);
        msgs.push({ role: 'user', content: `[SANDBOX OUTPUT untuk "$ ${c}"]\n${out}\n[END SANDBOX OUTPUT — jawab berdasarkan hasil nyata ini dalam bahasa Indonesia]` });
      }
      round++;
    }
    const clean = stripToolBlocks(finalText);
    addMessage('bot', clean);
    state.messages.push({ role: 'assistant', content: clean });
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

  $('#rtkSwitch').addEventListener('click', () => {
    rtkState.on = !rtkState.on;
    localStorage.setItem('nx9_rtk_on', rtkState.on ? '1' : '0');
    renderRtk();
    setStatus(rtkState.on ? 'RTK Token Saver aktif ⚡' : 'RTK Token Saver dimatikan', rtkState.on);
    setTimeout(() => setStatus(''), 1800);
  });
  renderRtk();

  /* ---------- Quota Tracking handlers ---------- */
  $('#quotaSwitch').addEventListener('click', () => {
    quotaState.on = !quotaState.on;
    quotaSave();
    renderQuota();
    setStatus(quotaState.on ? 'Quota tracking aktif — sisa kuota dipantau real-time' : 'Quota tracking dimatikan', quotaState.on);
    setTimeout(() => setStatus(''), 2000);
  });
  $('#quotaCycle').addEventListener('change', () => {
    quotaState.cycle = $('#quotaCycle').value;
    quotaState.resetAt = nextReset(quotaState.cycle, Date.now());
    quotaSave();
    renderQuota();
    setStatus('Siklus reset: ' + quotaState.cycle + ' — reset ' + quotaCountdown(quotaState.resetAt), true);
    setTimeout(() => setStatus(''), 2200);
  });
  $('#quotaCustomDate').addEventListener('change', () => {
    const v = $('#quotaCustomDate').value;
    if (!v) return;
    quotaState.custom = new Date(v).getTime();
    quotaState.cycle = 'custom';
    quotaState.resetAt = quotaState.custom;
    $('#quotaCycle').value = 'custom';
    quotaSave();
    renderQuota();
    setStatus('Reset langganan diatur ke tanggal khusus', true);
    setTimeout(() => setStatus(''), 2000);
  });
  $('#quotaCapInput').addEventListener('change', () => {
    quotaState.cap = Math.max(100, Number($('#quotaCapInput').value) || quotaState.cap);
    quotaSave();
    renderQuota();
  });
  $('#quotaReqInput').addEventListener('change', () => {
    quotaState.reqCap = Math.max(1, Number($('#quotaReqInput').value) || quotaState.reqCap);
    quotaSave();
    renderQuota();
  });
  $$('.chip-btn').forEach((b) => b.addEventListener('click', () => {
    haptic();
    quotaState.cap = Number(b.dataset.cap);
    quotaSave();
    renderQuota();
    setStatus('Batas kuota: ' + quotaFmt(quotaState.cap) + ' token per siklus', true);
    setTimeout(() => setStatus(''), 1800);
  }));
  $('#quotaResetNow').addEventListener('click', () => {
    if (!confirm('Reset pemakaian kuota sekarang?')) return;
    haptic();
    quotaReset();
    setStatus('Kuota direset — siklus baru dimulai', true);
    setTimeout(() => setStatus(''), 2000);
  });
  $('#quotaPill').addEventListener('click', () => {
    haptic();
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'settings'));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-settings'));
  });
  if (quotaState.resetAt && quotaState.resetAt <= Date.now()) quotaReset(); else renderQuota();


  $('#statMessages').textContent = '0';
  setInterval(() => {
    $('#statTime').textContent = Math.floor((Date.now() - state.startedAt) / 60000) + 'm';
  }, 15000);
})();
