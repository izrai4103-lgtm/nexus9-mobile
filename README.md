# NEXUS-9 Mobile 🤖📱

Versi **mobile-only** dari aplikasi AI agent NEXUS-9 (`zarifrouter99.lovable.app`), dibangun ulang sebagai PWA yang bisa di-install di Android/iPhone (web app) dan siap di-bundle jadi APK.

## Fitur
- 🌐 **Tab Origin** — 100% terhubung ke app asli `zarifrouter99.lovable.app` (iframe fullscreen + tombol back/forward/reload/buka tab baru), semua fitur asli tetap jalan karena app asli itu SPA client-side
- 🧪 **Sandbox lengkap** — editor HTML/CSS/JS live + preview sandboxed (iframe `sandbox` tanpa `allow-same-origin`) + panel Console yang menangkap `console.log/info/warn/error`, auto-run, 4 template (HTML Snack, JS Playground, Todo CRUD, Canvas), kode tersimpan di localStorage
- 💬 Chat AI dengan **BYO API key** (Gemini, Groq, GPT, Claude) — key hanya tersimpan di `localStorage` browser, tidak pernah ke server kami
- 🌐 Web search real-time (Bing → Mojeek → DuckDuckGo, di-proxy server)
- 🛒 Tool Shopee — login sesi sendiri + live search + link resmi buy-now/add-to-cart/checkout/deeplink app (mirror mekanisme asli)
- 🧩 Tools agent & statistik sesi
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

## APK Android (WebView wrapper)
APK sudah jadi: `dist/nexus9-mobile.apk` — WebView fullscreen menunjuk ke `https://nexus9-mobile.vercel.app`, paket `com.nexus9.mobile`, minSdk 24 / targetSdk 34, sudah ditandatangani (v1+v2), ikon app asli.

Build ulang (butuh JDK 17 + Android SDK + qemu-user untuk mesin ARM):
```bash
bash android/build-apk.sh
# hasil: android/build/nexus9-mobile.apk
# keystore & password dev: android/build/nexus9.keystore / nexus9pass
```

Cara lain:
1. **Bubblewrap/TWA**: `bubblewrap init --manifest https://nexus9-mobile.vercel.app/manifest.webmanifest`
2. **PWA Builder** (pwabuilder.com): masukkan URL Vercel → download APK

Semua fungsi app ada di `api/chat.js` (Node 18+, tanpa dependency eksternal).
