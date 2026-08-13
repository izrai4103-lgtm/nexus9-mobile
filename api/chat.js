const PROVIDERS = {
  gemini: {
    endpoint: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    build: (messages) => ({
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
      const text = (data.candidates || [])
        .flatMap((c) => (c.content?.parts || []).map((p) => p.text || ''))
        .join('\n')
        .trim();
      if (!text) throw new Error('Gemini tidak mengembalikan teks.');
      return { text, usage: data.usageMetadata?.totalTokenCount || 0 };
    },
  },
  groq: {
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    build: (messages, model) => ({
      model,
      messages: messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content })),
    }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Groq error ${res.status}`);
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage?.total_tokens || 0 };
    },
  },
  openai: {
    endpoint: () => 'https://api.openai.com/v1/chat/completions',
    build: (messages, model) => ({
      model,
      messages: messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content })),
    }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage?.total_tokens || 0 };
    },
  },
  claude: {
    endpoint: () => 'https://api.anthropic.com/v1/messages',
    build: (messages, model) => ({
      model,
      max_tokens: 4096,
      messages: messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content })),
    }),
    parse: async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Claude error ${res.status}`);
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (!text) throw new Error('Claude tidak mengembalikan teks.');
      return { text, usage: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) };
    },
  },
};

const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

async function webSearch(query, limit = 5) {
  const engines = [
    {
      name: 'bing',
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      re: /<li class="b_algo"[^>]*>[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/g,
    },
    {
      name: 'mojeek',
      url: `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
      re: /<a class="ob"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p class="s">([\s\S]*?)<\/p>)?/g,
    },
    {
      name: 'ddg',
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      re: /<div class="result results_links[^"]*result--[^"]*"[^>]*>[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g,
    },
  ];
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
  let lastErr = null;
  for (const engine of engines) {
    try {
      const res = await fetch(engine.url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const results = [];
      let m;
      while ((m = engine.re.exec(html)) !== null && results.length < limit) {
        let target = m[1];
        try {
          const parsed = new URL(target, 'https://www.bing.com');
          target = parsed.searchParams.get('uddg') || parsed.searchParams.get('u') || target;
        } catch { /* keep raw */ }
        const title = strip(m[2]).replace(/\s+/g, ' ');
        const snippet = strip(m[3]).replace(/\s+/g, ' ');
        if (title) results.push({ engine: engine.name, title, snippet, url: target });
      }
      if (results.length) return results;
      throw new Error('no results');
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(lastErr ? lastErr.message : 'Web search gagal');
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

  const { provider, apiKey, model, messages = [], tool } = body;
  if (!apiKey) return res.status(400).json({ error: 'API key kosong' });
  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Provider tidak dikenal: ${provider}` });
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Pesan kosong' });

  let finalMessages = messages;
  const lastContent = messages[messages.length - 1].content || '';

  if (tool === 'web' || /cari|search|berita terbaru|info terkini|googling/i.test(lastContent)) {
    try {
      const results = await webSearch(lastContent.slice(0, 200));
      if (results.length) {
        const note = '\n\n[Hasil web search]\n' + results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join('\n');
        const last = finalMessages[finalMessages.length - 1];
        finalMessages = finalMessages.slice(0, -1).concat({
          ...last,
          content: last.content + '\n\nGunakan hasil web search ini untuk menjawab (jawab dalam bahasa Indonesia):' + note,
        });
      }
    } catch { /* search gagal, lanjut tanpa hasil */ }
  }

  try {
    const httpHeaders = { 'Content-Type': 'application/json' };
    let endpoint = cfg.endpoint(model, apiKey);
    if (provider === 'gemini') {
      endpoint = cfg.endpoint(model) + `?key=${encodeURIComponent(apiKey)}`;
    } else if (provider === 'groq' || provider === 'openai') {
      httpHeaders['Authorization'] = `Bearer ${apiKey}`;
    } else if (provider === 'claude') {
      httpHeaders['x-api-key'] = apiKey;
      httpHeaders['anthropic-version'] = '2023-06-01';
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: httpHeaders,
      body: JSON.stringify(cfg.build(finalMessages, model)),
    });

    const { text, usage } = await cfg.parse(upstream);
    return res.status(200).json({ text, usage: { total: usage }, source: 'ai' });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Gagal menghubungi provider' });
  }
}

module.exports = handler;
