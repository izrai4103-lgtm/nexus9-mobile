const PROVIDERS = {
  gemini: {
    endpoint: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    build: (messages, model, system) => ({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
      const text = (data.candidates || []).flatMap((c) => (c.content?.parts || []).map((p) => p.text || '')).join('\n').trim();
      if (!text) throw new Error('Gemini tidak mengembalikan teks.');
      return { text, usage: data.usageMetadata?.totalTokenCount || 0 };
    },
  },
  groq: {
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    build: (messages, model, system) => ({ model, messages: [{ role: 'system', content: system }].concat(messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content }))) }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Groq error ${res.status}`);
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage?.total_tokens || 0 };
    },
  },
  openai: {
    endpoint: () => 'https://api.openai.com/v1/chat/completions',
    build: (messages, model, system) => ({ model, messages: [{ role: 'system', content: system }].concat(messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content }))) }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage?.total_tokens || 0 };
    },
  },
  claude: {
    endpoint: () => 'https://api.anthropic.com/v1/messages',
    build: (messages, model, system) => ({ model, max_tokens: 4096, messages: [{ role: 'system', content: system }].concat(messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content }))) }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Claude error ${res.status}`);
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (!text) throw new Error('Claude tidak mengembalikan teks.');
      return { text, usage: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) };
    },
  },
};

const SYSTEM_PROMPT = `Kamu NEXUS-9, agent AI mobile yang otonom (gaya kerja OpenClaw/OpenCode). Kamu punya akses sandbox Linux NYATA di server — bukan simulasi.

Untuk menjalankan perintah, tulis persis SATU blok per baris di jawabanmu:
<tool>perintah</tool>
Contoh: <tool>npm install express</tool> - <tool>node -e "console.log(1+1)"</tool> - <tool>npm -v</tool> - <tool>apt search ffmpeg</tool>

Tool tersedia: npm, node, npx, apt (update - show <pkg> - search <kata> - download <pkg> - list-deb <pkg>).
Perintah dieksekusi otomatis dan hasil nyatanya dikirim balik kepadamu. Setelah menerima hasil, jawab user BERSANDARKAN OUTPUT NYATA itu - jangan pernah mengarang hasil.
Jangan minta izin untuk menjalankan tool yang aman - langsung jalankan. Gunakan sandbox hampir setiap kali diminta: instal paket, cek versi, jalankan skrip, uji kode, cari paket apt, dll. Simpan blok <tool> di baris tersendiri (bukan di dalam blok kode markdown). Jawab dalam bahasa Indonesia.`;

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

    const upstream = await fetch(endpoint, { method: 'POST', headers: httpHeaders, body: JSON.stringify(cfg.build(finalMessages, model, SYSTEM_PROMPT)) });
    const { text, usage } = await cfg.parse(upstream);
    return res.status(200).json({ text, usage: { total: usage } });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Gagal menghubungi provider' });
  }
}

module.exports = handler;
