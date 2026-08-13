# NEXUS-9 Mobile 🤖📱

Versi **mobile-only** dari aplikasi AI agent NEXUS-9 (`zarifrouter99.lovable.app`), dibangun ulang sebagai PWA yang bisa di-install di Android/iPhone (web app) dan siap di-bundle jadi APK.

## Fitur
- 💬 Chat AI dengan **BYO API key** (Gemini, Groq, GPT, Claude) — key hanya tersimpan di `localStorage` browser, tidak pernah ke server kami
- 🌐 Web search real-time (Bing → Mojeek → DuckDuckGo, di-proxy server)
- 🛒 Tool Shopee (status login tersimpan lokal)
- ⌨️ Render blok kode rapi dengan syntax fence
- 🧩 MCP tools & statistik sesi
- 📲 PWA installable: manifest + service worker (offline shell), splash, safe-area iPhone
- 🎨 UI mobile-first: dark glassmorphism, bottom tab bar, haptik Android, mode terang/gelap

## Struktur
```
nexus9-mobile/
├── index.html          # shell aplikasi
├── styles.css          # UI mobile-only
├── app.js              # logika chat, settings, tools, PWA
├── sw.js               # service worker (offline)
├── manifest.webmanifest# PWA manifest + icons
├── api/chat.js         # Vercel serverless: proxy 4 provider + web search
└── icons/              # ikon app (dari favicon asli)
```

## Deploy
```bash
vercel --prod          # Vercel (static + serverless /api/chat)
git push origin main   # GitHub
```

## Jadi APK
PWA ini bisa di-bundle jadi APK Android pakai salah satu cara:
1. **Bubblewrap/TWA** (Google resmi): `npm i -g @bubblewrap/cli && bubblewrap init --manifest https://<vercel-url>/manifest.webmanifest`
2. **PWA Builder** (pwabuilder.com): masukkan URL Vercel → download APK
3. **Android Studio WebView** project wrapper menunjuk ke URL yang sama

Semua fungsi app ada di `api/chat.js` (Node 18+, tanpa dependency eksternal).
