const { executeCmd } = require('../lib/exec');
const { compress } = require('../lib/rtk');

const RUN_TOOL = {
  name: 'run_sandbox',
  description: 'Jalankan perintah di sandbox Linux server secara NYATA (npm, node, npx, apt update/show/search/download/list-deb). Gunakan untuk menjalankan kode, instal paket, cek versi, atau cari paket. Kirim cmd tanpa shell metacharacter.',
  parameters: {
    type: 'object',
    properties: { cmd: { type: 'string', description: 'Perintah utuh, contoh: npm install express atau node -e "console.log(1+1)"' } },
    required: ['cmd'],
  },
};
const OPENAI_TOOL = { type: 'function', function: RUN_TOOL };
const GEMINI_TOOL = { functionDeclarations: [{ name: RUN_TOOL.name, description: RUN_TOOL.description, parameters: RUN_TOOL.parameters }] };
const CLAUDE_TOOL = { name: RUN_TOOL.name, description: RUN_TOOL.description, input_schema: RUN_TOOL.parameters };

const PROVIDERS = {
  gemini: {
    endpoint: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    build: (messages, model, system) => ({
      systemInstruction: { parts: [{ text: system }] },
      tools: [GEMINI_TOOL],
      contents: messages.map((m) => (m.parts ? { role: m.role === 'assistant' ? 'model' : 'user', parts: m.parts } : { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
      const text = (data.candidates || []).flatMap((c) => (c.content?.parts || []).filter((p) => p.text).map((p) => p.text || '')).join('\n').trim();
      return { text, usage: data.usageMetadata?.totalTokenCount || 0 };
    },
    calls: (data) => {
      const parts = (data.candidates || [])[0]?.content?.parts || [];
      return parts.filter((p) => p.functionCall).map((p, i) => ({ id: `fc${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
    },
    assistantMsg: (calls) => ({ role: 'assistant', parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) }),
    resultMsgs: (calls, outputs) => [{ role: 'user', parts: calls.map((c, i) => ({ functionResponse: { name: c.name, response: { result: outputs[i] } } })) }],
  },
  groq: {
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    build: (messages, model, system) => ({ model, tools: [OPENAI_TOOL], messages: [{ role: 'system', content: system }].concat(messages) }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Groq error ${res.status}`);
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage?.total_tokens || 0 };
    },
    calls: (data) => (data.choices?.[0]?.message?.tool_calls || []).map((tc) => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* abaikan */ }
      return { id: tc.id || 'tc', name: tc.function.name, args };
    }),
    assistantMsg: (calls) => ({ role: 'assistant', content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }),
    resultMsgs: (calls, outputs) => calls.map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: outputs[i] })),
  },
  openai: {
    endpoint: () => 'https://api.openai.com/v1/chat/completions',
    build: (messages, model, system) => ({ model, tools: [OPENAI_TOOL], messages: [{ role: 'system', content: system }].concat(messages) }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage?.total_tokens || 0 };
    },
    calls: (data) => (data.choices?.[0]?.message?.tool_calls || []).map((tc) => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* abaikan */ }
      return { id: tc.id || 'tc', name: tc.function.name, args };
    }),
    assistantMsg: (calls) => ({ role: 'assistant', content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }),
    resultMsgs: (calls, outputs) => calls.map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: outputs[i] })),
  },
  claude: {
    endpoint: () => 'https://api.anthropic.com/v1/messages',
    build: (messages, model, system) => ({ model, max_tokens: 4096, system, tools: [CLAUDE_TOOL], messages }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Claude error ${res.status}`);
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { text, usage: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) };
    },
    calls: (data) => (data.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id || 'tu', name: b.name, args: b.input || {} })),
    assistantMsg: (calls) => ({ role: 'assistant', content: calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })) }),
    resultMsgs: (calls, outputs) => [{ role: 'user', content: calls.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: outputs[i] })) }],
  },
};

const SYSTEM_PROMPT = `Kamu NEXUS-9, agent AI mobile yang otonom (gaya kerja OpenClaw/OpenCode). Kamu punya akses sandbox Linux NYATA di server — bukan simulasi.

Untuk menjalankan perintah, gunakan function run_sandbox dengan argumen cmd (contoh: npm install express, node -e "console.log(1+1)", npm -v, apt search ffmpeg). Tool tersedia: npm, node, npx, apt (update · show <pkg> · search <kata> · download <pkg> · list-deb <pkg>).
Perintah dieksekusi nyata dan hasilnya dikirim balik kepadamu. Setelah menerima hasil, jawab user BERSANDARKAN OUTPUT NYATA itu - jangan pernah mengarang hasil.
Jika function calling tidak tersedia, tulis persis blok per baris: <tool>perintah</tool> sebagai fallback.
Jangan minta izin untuk menjalankan tool yang aman - langsung jalankan. Gunakan sandbox hampir setiap kali diminta: instal paket, cek versi, jalankan skrip, uji kode, cari paket apt, dll. Jawab dalam bahasa Indonesia.`;

const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function webSearch(query, limit = 5, engines = null) {
  const list = engines || [
    { name: 'bing', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`, re: /<li class="b_algo"[^>]*>[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/g },
    { name: 'mojeek', url: `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`, re: /<a class="ob"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p class="s">([\s\S]*?)<\/p>)?/g },
    { name: 'ddg', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, re: /<div class="result results_links[^"]*result--[^"]*"[^>]*>[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g },
  ];
  let lastErr = null;
  for (const engine of list) {
    try {
      const res = await fetch(engine.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const results = [];
      let m;
      while ((m = engine.re.exec(html)) !== null && results.length < limit) {
        let target = m[1];
        try { const p = new URL(target, 'https://www.bing.com'); target = p.searchParams.get('uddg') || p.searchParams.get('u') || target; } catch { /* keep */ }
        const title = strip(m[2]).replace(/\s+/g, ' ');
        const snippet = strip(m[3]).replace(/\s+/g, ' ');
        if (title) results.push({ engine: engine.name, title, snippet, url: target });
      }
      if (results.length) return results;
      throw new Error('no results');
    } catch (err) { lastErr = err; }
  }
  throw new Error(lastErr ? lastErr.message : 'Web search gagal');
}

function parseShopeeUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('shopee')) return null;
    let shopId = u.searchParams.get('shopId') || u.searchParams.get('shop_id');
    let itemId = u.searchParams.get('itemId') || u.searchParams.get('item_id');
    if (!shopId || !itemId) {
      const m = u.pathname.match(/-i\.(\d+)\.(\d+)/) || u.pathname.match(/\/product\/(\d+)\/(\d+)/);
      if (m && m[1] && m[2]) { shopId = m[1]; itemId = m[2]; }
      else if (m && m[1]) { itemId = m[1]; }
    }
    if (!itemId) return null;
    const qty = 1;
    const product = `https://shopee.co.id/product/${shopId || ''}/${itemId}`;
    return {
      product,
      addToCart: `https://shopee.co.id/cart?shopId=${shopId || ''}&itemId=${itemId}&quantity=${qty}&add=1`,
      buyNow: `https://shopee.co.id/checkout?shopId=${shopId || ''}&itemId=${itemId}&quantity=${qty}&buyNow=1`,
      checkout: `https://shopee.co.id/checkout`,
      deeplink: `shopee://home?url=${encodeURIComponent(product)}`,
    };
  } catch { return null; }
}

async function searchShop(query, limit = 5) {
  try {
    const res = await fetch(`https://shopee.co.id/search?keyword=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const html = await res.text();
      const names = [...html.matchAll(/"name":"([^"]{8,120})"/g)].map((m) => m[1]);
      const prices = [...html.matchAll(/"price":(\d+)/g)].map((m) => m[1]);
      if (names.length > 2) {
        return names.slice(0, limit).map((name, i) => ({
          title: name,
          snippet: prices[i] ? `Rp ${(Number(prices[i]) / 100000).toLocaleString('id-ID')}` : '',
          url: `https://shopee.co.id/search?keyword=${encodeURIComponent(query.split(' ')[0] || query)}`,
        }));
      }
    }
  } catch { /* fallback below */ }
  return webSearch(`${query} site:shopee.co.id`, limit);
}

function buildOrderBlock(productName, url, price, quantity, note) {
  const links = parseShopeeUrl(url);
  if (!links) return null;
  const rows = [`🛒 *Pesanan siap — NEXUS-9 Auto Order*`, `Produk: ${productName || 'produk Shopee'}${price ? ` | Harga: ${price}` : ''}${quantity ? ` | Qty: ${quantity}` : ''}${note ? `\nCatatan: ${note}` : ''}`, ``, `👉 Beli sekarang: ${links.buyNow}`, `➕ Masukkan keranjang: ${links.addToCart}`, `🧾 Checkout: ${links.checkout}`, `📲 Buka di App Shopee: ${links.deeplink}`, ``, `Link resmi Shopee di atas otomatis membuka sesi login Shopee kamu — NEXUS-9 tidak pernah menyimpan kredensial akunmu.`];
  return rows.join('\n');
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'JSON tidak valid' }); }

  const { provider, apiKey, model, messages = [], tool, shopeeLogged, round = 0 } = body;
  if (!apiKey) return res.status(400).json({ error: 'API key kosong' });
  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Provider tidak dikenal: ${provider}` });
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Pesan kosong' });

  let finalMessages = messages;
  const last = messages[messages.length - 1];
  const content = last.content || '';

  /* ---- Shopee: search / order ---- */
  if (round === 0 && (tool === 'shopee' || /shopee/i.test(content))) {
    const urlMatch = content.match(/https?:\/\/[^\s]*shopee[^\s]*|shopee\.co\.id\/[^\s]*/i);
    const wantsOrder = /(order|beli|buy|pesan|checkout|keranjang|add to cart|auto buy|auto order)/i.test(content);
    if (wantsOrder && (urlMatch || content.includes('link'))) {
      if (!shopeeLogged) {
        return res.status(200).json({ text: '🚫 *BLOCKED:* kamu belum login ke akun Shopee. Auto order/auto buy hanya aktif setelah login. Buka tab *Agent* → *Login Shopee (web)* → login di tab baru → tekan *Saya sudah login*.', usage: { total: 0 } });
      }
      const target = urlMatch ? urlMatch[0] : null;
      const qtyMatch = content.match(/qty[:\s]*(\d+)|x(\d+)/i);
      const qty = qtyMatch ? Number(qtyMatch[1] || qtyMatch[2]) : 1;
      const block = buildOrderBlock(null, target || 'https://shopee.co.id/search?keyword=' + encodeURIComponent(content.replace(/.*(order|beli|buy|pesan|checkout|keranjang).*/i, '').trim() || 'produk'), null, qty, null);
      if (block) return res.status(200).json({ text: block, usage: { total: 0 } });
      return res.status(200).json({ text: '⚠️ NEXUS-9 tidak menemukan URL produk Shopee yang valid di pesanmu. Kirim link produknya, contoh: https://shopee.co.id/Produk-i.123456789.9876543210', usage: { total: 0 } });
    }
    if (tool === 'shopee') {
      try {
        const results = await searchShop(content.slice(0, 120));
        if (results.length) {
          const note = '\n\n[Hasil pencarian Shopee (live)]\n' + results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? ` (${r.snippet})` : ''}`).join('\n') + '\n\nRangkum produk terbaik dalam bahasa Indonesia dan sarankan link yang cocok untuk dipesan.';
          const lastMsg = finalMessages[finalMessages.length - 1];
          finalMessages = finalMessages.slice(0, -1).concat({ ...lastMsg, content: lastMsg.content + note });
        }
      } catch { /* lanjut tanpa hasil */ }
    }
  }

  /* ---- Web search ---- */
  if (round === 0 && (tool === 'web' || /cari|search|berita terbaru|info terkini|googling/i.test(content)) && !/shopee/i.test(content)) {
    try {
      const results = await webSearch(content.slice(0, 200));
      if (results.length) {
        const note = '\n\n[Hasil web search]\n' + results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join('\n') + '\n\nGunakan hasil ini untuk menjawab dalam bahasa Indonesia.';
        const lastMsg = finalMessages[finalMessages.length - 1];
        finalMessages = finalMessages.slice(0, -1).concat({ ...lastMsg, content: lastMsg.content + note });
      }
    } catch { /* lanjut */ }
  }

  try {
    const httpHeaders = { 'Content-Type': 'application/json' };
    let endpoint = cfg.endpoint(model, apiKey);
    if (provider === 'gemini') endpoint = cfg.endpoint(model) + `?key=${encodeURIComponent(apiKey)}`;
    else if (provider === 'groq' || provider === 'openai') httpHeaders['Authorization'] = `Bearer ${apiKey}`;
    else if (provider === 'claude') { httpHeaders['x-api-key'] = apiKey; httpHeaders['anthropic-version'] = '2023-06-01'; }

    /* native tool-calling loop (maks 3 ronde, 6 eksekusi) — sandbox dipakai AI otomatis */
    let history = finalMessages;
    const toolsLog = [];
    let totalUsage = 0;
    let text = '';
    for (let r = 0; r < 3; r++) {
      const upstream = await fetch(endpoint, { method: 'POST', headers: httpHeaders, body: JSON.stringify(cfg.build(history, model, SYSTEM_PROMPT)) });
      const data = await upstream.clone().json();
      const { text: t, usage } = await cfg.parse(upstream);
      totalUsage += usage || 0;
      text = t || '';
      const calls = (cfg.calls(data) || []).filter((c) => c.name === 'run_sandbox').slice(0, 2);
      if (!calls.length) break;
      if (toolsLog.length >= 6) break;
      const outputs = [];
      for (const c of calls) {
        const result = await executeCmd(String(c.args.cmd || '').slice(0, 300));
        const cOut = compress(result.stdout || '');
        const cErr = compress(result.stderr || '');
        const original = cOut.original + cErr.original;
        const compressed = cOut.compressed + cErr.compressed;
        const saved = Math.max(0, original - compressed);
        const rtk = { original, compressed, saved, savedPct: original ? Math.round((saved / original) * 100) : 0, rules: [...new Set([...cOut.rules, ...cErr.rules])], skipped: cOut.skipped && cErr.skipped };
        outputs.push([cOut.text, cErr.text ? `stderr:\n${cErr.text}` : '', result.error ? `error: ${result.error}` : ''].filter(Boolean).join('\n').slice(0, 24000));
        toolsLog.push({ cmd: String(c.args.cmd || ''), ok: result.ok, code: result.code, stdout: cOut.text, stderr: cErr.text, error: result.error || '', rtk });
        if (toolsLog.length >= 6) break;
      }
      if (!outputs.length) break;
      history = history.concat(cfg.assistantMsg(calls)).concat(cfg.resultMsgs(calls, outputs));
    }
    return res.status(200).json({ text, usage: { total: totalUsage }, tools: toolsLog });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Gagal menghubungi provider' });
  }
}

module.exports = handler;
