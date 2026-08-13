# NEXUS-9 Mobile 🤖📱

Versi **mobile-only** dari aplikasi AI agent NEXUS-9 (`zarifrouter99.lovable.app`), dibangun ulang sebagai PWA yang bisa di-install di Android/iPhone (web app) dan siap di-bundle jadi APK.

## Fitur
- 🧪 **Sandbox otomatis ala OpenClaw/OpenCode** — AI memakai sandbox server sendirian (npm · node · npx · apt) langsung dari chat lewat blok `<tool>perintah</tool>`; hasil eksekusi **nyata** dikirim balik ke AI, AI menjawab berdasarkan output itu, dan hasilnya tampil sebagai bubble terminal di chat. Tab Sandbox & Origin dihapus dari UI — sandbox khusus dipakai AI, bukan user
- 💬 Chat AI dengan **BYO API key** (Gemini, Groq, GPT, Claude) + system prompt agen otonom (maks 3 ronde tool-loop per pesan)
- 💬 Chat AI dengan **BYO API key** (Gemini, Groq, GPT, Claude) — key hanya tersimpan di `localStorage` browser, tidak pernah ke server kami
- 🌐 Web search real-time (Bing → Mojeek → DuckDuckGo, di-proxy server)
- 🛒 Tool Shopee — login sesi sendiri + live search + link resmi buy-now/add-to-cart/checkout/deeplink app (mirror mekanisme asli)
- 🧩 Tools agent & statistik sesi
- 📲 PWA installable: manifest + service worker (offline shell), splash, safe-area iPhone
- 🎨 UI mobile-first: dark glassmorphism, bottom tab bar, haptik Android, mode terang/gelap

## Struktur
```
nexus9-mobile/
├── index.html          # shell aplikasi (tab: Chat · Agent · Setelan)
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

## Executor Server (npm & apt) — `/api/run`
AI menjalankan perintah nyata lewat chat secara otomatis. Di jawabannya AI menulis blok `<tool>perintah</tool>` (contoh: `<tool>npm install express</tool>`), aplikasi mengeksekusinya via `/api/run`, hasilnya dikirim balik ke AI (ronde berikutnya), dan bubble terminal tampil di chat. Maks 2 perintah per ronde, maks 3 ronde per pesan.

- **npm / node / npx**: dieksekusi aman (`execFile`, tanpa shell) di `/tmp/nx9run` — `npm install express` diuji live: 67 paket dalam 3 detik. `npm install -g` & perintah berbahaya diblokir.
- **apt**: implementasi **pure-Node** (Vercel tidak punya binary `apt-get`). Pakai index `Packages` nyata dari `archive.ubuntu.com` (noble/main amd64):
  - `apt update` — muat index asli
  - `apt show <pkg>` — metadata nyata
  - `apt search <kata>` — cari paket
  - `apt download <pkg>` — unduh `.deb` nyata ke sandbox
  - `apt list-deb <pkg>` — bongkar isi ar archive (.deb)
- Batas serverless: install Sistem penuh (`apt install`) butuh root → tidak bisa di Vercel; file `.deb` tetap bisa diunduh & diperiksa.

## ⚡ RTK Token Saver — kompresi otomatis output
RTK (Runtime Token Saver) mengompres output tool **secara lossless** sebelum dikirim ke model — konteks tetap utuh, token lebih hemat.

- **Cara kerja** (`lib/rtk.js`, otomatis di `/api/run`):
  1. Buang ANSI escape codes
  2. Trim whitespace ujung baris + gabung baris kosong beruntun
  3. Buang baris duplikat (info nol, cukup tampil 1x)
  4. Cap panjang output di 60K char
- **Hemat nyata**: `git diff` 22,7KB → 14,2KB (−38%), `git log` 28KB → 16,7KB (−41%), output log berulang hingga −97%.
- **Di mana**: toggle `RTK` di toolbar Sandbox, dan pengaturan **⚡ RTK Token Saver** di tab Setelan (total token/char dihemat + mode on/off). Output yang terkompresi menampilkan badge `⚡ RTK −X%` di chat.
- **Nonaktifkan per-perintah**: kirim `{"cmd": "...", "compress": false}` ke `/api/run`.

## 📊 Quota Tracking — pantau sisa kuota & reset real-time
Quota Tracking memantau pemakaian AI kamu **secara real-time** (tick tiap detik) dan memblokir otomatis saat kuota habis.

- **Data nyata**: dihitung dari respons provider yang lewat aplikasi ini — request & token per provider (Gemini, Groq, GPT, Claude), tersimpan di `localStorage`.
- **Hitungan mundur reset**: siklus harian (tengah malam), mingguan (Senin 00:00), bulanan (tgl 1), atau **tanggal khusus** untuk penyesuaian masa langganan.
- **Batas ganda**: batas token **dan** batas request per siklus, dengan preset 100K / 500K / 1M / 5M token.
- **Enforcement**: saat batas tercapai, chat AI diblokir dengan pesan + waktu reset tersisa (bisa dimatikan).
- **Di mana**: pill `📊 % · countdown` di layar Chat (klik → buka Setelan), dan kartu **📊 Quota Tracking** di tab Setelan. Reset manual tersedia.
- **Catatan jujur**: ini bukan kuota server/dashboard provider — API key kamu BYO, jadi kuota dihitung dari pemakaian nyata lewat aplikasi ini.
