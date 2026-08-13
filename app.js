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
  const isRunCmd = (t) => /^(run\s+)?(npm|node|npx|apt|apt-get)\b/.test(t.trim());

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

  async function runCmd(cmd) {
    const typingEl = addTyping();
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: cmd.replace(/^run\s+/i, ''), compress: rtkState.on }),
      });
      const data = await res.json().catch(() => ({}));
      typingEl.remove();
      addTerminal(cmd, { ok: data.ok !== false, code: data.code ?? 1, stdout: data.stdout || '', stderr: data.stderr || '', error: data.error || '', rtk: data.rtk });
    } catch (err) {
      typingEl.remove();
      addTerminal(cmd, { ok: false, code: 1, stdout: '', stderr: '', error: err.message || 'gagal' });
    }
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
    if (isRunCmd(text)) { runCmd(text); return; }
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

  /* ---------- Sandbox ---------- */
  const SB_STORE = { html: 'nx9_sb_html', css: 'nx9_sb_css', js: 'nx9_sb_js' };
  const TEMPLATES = {
    html: {
      html: `<div class="card">\n  <h1>Halo Sandbox 👋</h1>\n  <p id="msg">Klik tombol di bawah</p>\n  <button id="btn">Klik aku</button>\n</div>`,
      css: `.card { max-width:260px; margin:24px auto; padding:20px; border-radius:14px; background:linear-gradient(135deg,#7c6cff,#fc6050); color:#fff; font-family:sans-serif; box-shadow:0 10px 30px rgba(0,0,0,.35); }\nbutton { margin-top:10px; padding:10px 18px; border:0; border-radius:10px; font-weight:600; cursor:pointer; }`,
      js: `const btn = document.getElementById('btn');\nbtn.addEventListener('click', () => {\n  document.getElementById('msg').textContent = 'Berhasil diklik ✨';\n  console.log('Klik terdeteksi di sandbox');\n  console.info('Info: kamu bisa eksplorasi DOM bebas');\n});`,
    },
    js: {
      html: `<pre id="out">menghitung…</pre>`,
      css: `pre { background:#0b0b16; color:#3ddc97; padding:16px; border-radius:12px; font:12px monospace; white-space:pre-wrap; }`,
      js: `function fib(n) { return n < 2 ? n : fib(n-1) + fib(n-2); }\nconst seq = Array.from({length:12}, (_,i)=>fib(i));\nconsole.log('Fibonacci:', seq.join(', '));\nconsole.table && console.table(seq);\ndocument.getElementById('out').textContent = 'Fibonacci: ' + seq.join(' → ');\n// error test: buka Console di panel bawah`,
    },
    todo: {
      html: `<div id="app"></div>`,
      css: `body { font-family:sans-serif; background:#f3f1ff; }\n.todo { max-width:280px; margin:30px auto; background:#fff; border-radius:14px; padding:16px; box-shadow:0 8px 24px rgba(0,0,0,.12); }\n.todo input { width:100%; padding:9px; border:1px solid #ddd; border-radius:8px; margin-bottom:8px; }\n.todo button { padding:7px 12px; border:0; border-radius:8px; background:#7c6cff; color:#fff; }\n.todo li { padding:5px 0; }`,
      js: `const app = document.getElementById('app');\napp.innerHTML = '<div class=\"todo\"><h2>Todo Sandbox ✓</h2><input id=\"in\" placeholder=\"tugas baru…\"><button id=\"add\">Tambah</button><ul id=\"list\"></ul></div>';\nconst inp = document.getElementById('in');\nconst add = document.getElementById('add');\nconst list = document.getElementById('list');\nfunction addTodo(){ const v = inp.value.trim(); if(!v) return; const li = document.createElement('li'); li.textContent = v; list.appendChild(li); inp.value=''; console.log('Todo ditambahkan:', v); }\nadd.onclick = addTodo;\ninp.onkeydown = (e)=>{ if(e.key==='Enter') addTodo(); };`,
    },
    canvas: {
      html: `<canvas id="c"></canvas>`,
      css: `body { margin:0; background:#0b0b16; }\ncanvas { display:block; width:100vw; height:100vh; }`,
      js: `const c = document.getElementById('c');\nc.width = innerWidth; c.height = innerHeight;\nconst ctx = c.getContext('2d');\nlet t = 0;\nfunction draw(){ ctx.clearRect(0,0,c.width,c.height);\n  for(let i=0;i<40;i++){ const x = c.width/2 + Math.cos(t + i*0.4)*i*8; const y = c.height/2 + Math.sin(t*1.3 + i*0.7)*i*8; ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fillStyle = 'hsl('+((t*40 + i*9)%360)+',80%,60%)'; ctx.fill(); }\n  t += 0.01; requestAnimationFrame(draw); }\ndraw();\nconsole.log('Canvas animasi berjalan ✨');`,
    },
  };
  const sb = { html: $('#sbHtml'), css: $('#sbCss'), js: $('#sbJs') };
  const consoleEl = $('#sbConsole');
  const frame = $('#sbFrame');

  function sbLog(type, text) {
    const div = document.createElement('div');
    div.className = 'line ' + type;
    div.textContent = text;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
  function sbClear() { consoleEl.innerHTML = '<div class="line empty">// console — keluaran kode kamu di sini</div>'; }
  function sbLoad(code, isTemplate) {
    sb.html.value = code.html; sb.css.value = code.css; sb.js.value = code.js;
    if (isTemplate) { Object.values(SB_STORE).forEach((k) => localStorage.removeItem(k)); }
    sbClear(); sbRun();
  }
  function sbRun() {
    Object.entries({ html: sb.html.value, css: sb.css.value, js: sb.js.value }).forEach(([k, v]) => localStorage.setItem(SB_STORE[k], v));
    const doc = `<!DOCTYPE html><html><head><style>${sb.css.value}</style></head><body>${sb.html.value}<script>(function(){const send=(m,a)=>{try{parent.postMessage({source:'nx9sb',type:m,args:a.map(x=>{try{return typeof x==='object'?(x===null?'null':JSON.stringify(x)):String(x)}catch(e){return '[unserializable]'}}),count:a.length},'*')}catch(e){}};['log','info','warn','error','debug'].forEach(m=>{const o=console[m];console[m]=function(){send(m,[...arguments]);o.apply(console,arguments)}});window.onerror=(msg,src,line,col)=>{try{send('error',[String(msg)+' @'+line+':'+col])}catch(e){}};})();<\/script><script>${sb.js.value}<\/script></body></html>`;
    frame.srcdoc = doc;
  }
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.source !== 'nx9sb') return;
    const { type, args, count } = e.data;
    const text = args.join(' ') + (count > args.length ? ' …' : '');
    sbLog(type === 'warn' ? 'warn' : type === 'error' || type === 'debug' ? 'error' : type, text);
  });
  $('#sbTemplate').addEventListener('change', () => sbLoad(TEMPLATES[$('#sbTemplate').value], true));
  $('#sbRun').addEventListener('click', () => { haptic(); sbClear(); sbRun(); });
  $('#sbAuto').addEventListener('change', () => {
    if ($('#sbAuto').checked) { sb.html.oninput = debounceRun; sb.css.oninput = debounceRun; sb.js.oninput = debounceRun; sbRun(); }
    else { sb.html.oninput = null; sb.css.oninput = null; sb.js.oninput = null; }
  });
  let debounceRun = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { sbClear(); sbRun(); }, 600); }; })();
  sb.html.oninput = debounceRun; sb.css.oninput = debounceRun; sb.js.oninput = debounceRun;
  $$('.sb-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      haptic();
      $$('.sb-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.sb-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
    });
  });
  (() => {
    const stored = Object.values(SB_STORE).some((k) => localStorage.getItem(k));
    if (stored) sbLoad({ html: localStorage.getItem(SB_STORE.html) || '', css: localStorage.getItem(SB_STORE.css) || '', js: localStorage.getItem(SB_STORE.js) || '' }, false);
    else sbLoad(TEMPLATES.html, true);
  })();

  /* ---------- Terminal npm/apt (Sandbox) ---------- */
  async function runTerm() {
    const cmd = $('#termLine').value.trim();
    if (!cmd) return;
    haptic();
    sbLog('cmd', '$ ' + cmd);
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, compress: $('#rtkToggle').checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.stdout) sbLog('log', data.stdout);
      if (data.stderr) sbLog('warn', data.stderr);
      if (data.error) sbLog('error', data.error);
      else if (!data.stdout && !data.stderr) sbLog('info', 'exit ' + (data.code ?? 0));
      if (data.rtk) {
        if (data.rtk.savedPct > 0) sbLog('info', `⚡ RTK: −${data.rtk.savedPct}% token · ${data.rtk.original} → ${data.rtk.compressed} char`);
        rtkSave(data.rtk);
      }
    } catch (err) {
      sbLog('error', 'Gagal terhubung ke executor: ' + err.message);
    }
  }
  $('#termRun').addEventListener('click', runTerm);
  $('#termLine').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runTerm(); } });

  $('#rtkSwitch').addEventListener('click', () => {
    rtkState.on = !rtkState.on;
    localStorage.setItem('nx9_rtk_on', rtkState.on ? '1' : '0');
    renderRtk();
    setStatus(rtkState.on ? 'RTK Token Saver aktif ⚡' : 'RTK Token Saver dimatikan', rtkState.on);
    setTimeout(() => setStatus(''), 1800);
  });
  renderRtk();

  /* ---------- Origin (100% terhubung ke zarifrouter99.lovable.app) ---------- */
  const oframe = $('#originFrame');
  $('#btnOriginBack').addEventListener('click', () => { try { oframe.contentWindow.history.back(); } catch {} });
  $('#btnOriginFwd').addEventListener('click', () => { try { oframe.contentWindow.history.forward(); } catch {} });
  $('#btnOriginReload').addEventListener('click', () => { haptic(); oframe.src = oframe.src; });

  $('#statMessages').textContent = '0';
  setInterval(() => {
    $('#statTime').textContent = Math.floor((Date.now() - state.startedAt) / 60000) + 'm';
  }, 15000);
})();
