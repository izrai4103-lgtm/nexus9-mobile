const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { compress } = require('../lib/rtk');
const WORK = '/tmp/nx9run';
const APT_DIR = '/tmp/nx9apt';
const MAX_OUT = 512 * 1024;
const MAIN_INDEX = 'http://archive.ubuntu.com/ubuntu/dists/noble/main/binary-amd64/Packages.gz';
const ARCHIVE = 'http://archive.ubuntu.com/ubuntu';

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } }

/* ---------- command parsing (shell aman, tanpa metachar) ---------- */
function parseCmd(str) {
  const clean = String(str || '').trim().replace(/[\u0000-\u001f]+/g, ' ');
  if (!clean) return { error: 'Perintah kosong' };
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(clean))) tokens.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  const tool = tokens[0];
  if (!['npm', 'node', 'npx', 'apt', 'apt-get'].includes(tool)) {
    return { error: `Tool "${tool || '?'}" tidak diizinkan. Gunakan npm, node, npx, atau apt.` };
  }
  const args = tokens.slice(1);
  const joined = args.join(' ');
  if (/(^|[\s])(rm|rmdir|mv|cp|chown|chmod|dd|mkfs|shutdown|reboot|halt|poweroff|kill|pkill|skill|sudo|su)([\s]|$)/.test(joined)) {
    return { error: 'Perintah berbahaya diblokir' };
  }
  if (/[|;&<>`$\\]/.test(joined)) {
    return { error: 'Shell metacharacter tidak diizinkan — kirim perintah langsung (array aman)' };
  }
  if (tool === 'npm' && args.some((a) => a === '-g' || a === '--global')) {
    return { error: 'npm install global tidak diizinkan di sandbox' };
  }
  return { tool, args, cwd: WORK };
}

function run(exe, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(exe, args, {
      cwd: opts.cwd || WORK,
      timeout: opts.timeout || 45000,
      maxBuffer: MAX_OUT,
      env: { ...process.env, HOME: '/tmp', npm_config_cache: '/tmp/.npm', npm_config_prefix: '/tmp/npm', ...(opts.env || {}) },
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (typeof err.code === 'number' ? err.code : err.signal || 1) : 0,
        stdout: String(stdout || '').slice(0, 60000),
        stderr: String(stderr || '').slice(0, 20000),
        error: err ? String(err.message || err).slice(0, 600) : '',
      });
    });
  });
}

/* ---------- apt pure-Node (tanpa binary apt, Vercel-compatible) ---------- */
let PACKAGES = null;
let PACKAGES_SOURCE = '';

function parsePackages(gzBuf) {
  const text = zlib.gunzipSync(gzBuf).toString('utf8');
  const map = new Map();
  let cur = null;
  for (const line of text.split('\n')) {
    if (line === '') { cur = null; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1).trim();
    if (k === 'Package') { cur = { pkg: v }; map.set(v, cur); }
    else if (cur) {
      if (k === 'Version') cur.version = v;
      else if (k === 'Filename') cur.filename = v;
      else if (k === 'Size') cur.size = Number(v);
      else if (k === 'Description') cur.description = v.slice(0, 220);
    }
  }
  return map;
}

async function getIndex() {
  if (PACKAGES) return PACKAGES;
  const res = await fetch(MAIN_INDEX, { headers: { 'User-Agent': 'nexus9-executor' } });
  if (!res.ok) throw new Error(`index Packages HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  PACKAGES = parsePackages(buf);
  PACKAGES_SOURCE = `noble/main amd64 (${(buf.length / 1e6).toFixed(1)} MB index)`;
  return PACKAGES;
}

function listArMembers(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 8) !== '!<arch>\n') return [];
  const names = [];
  let off = 8;
  while (off + 60 <= buf.length) {
    const name = buf.toString('latin1', off, off + 16).replace(/\s+$/, '');
    const size = parseInt(buf.toString('latin1', off + 48, off + 58).trim(), 10) || 0;
    names.push(`${name} (${size} B)`);
    off += 60 + size + (size % 2);
  }
  return names;
}

async function runApt(args) {
  const sub = args[0];
  if (!sub) {
    return { ok: false, code: 1, stdout: '', stderr: '', error: 'apt: sub-perintah: update · show <pkg> · search <kata> · download <pkg> · list-deb <pkg>' };
  }
  try {
    if (sub === 'update') {
      await getIndex();
      return { ok: true, code: 0, stdout: `Index ubuntu ${PACKAGES_SOURCE} dimuat (implementasi Node asli, bukan simulasi — daftar paket nyata dari archive.ubuntu.com).`, stderr: '', error: '' };
    }
    if (!['show', 'search', 'download', 'list-deb'].includes(sub)) {
      return { ok: false, code: 1, stdout: '', stderr: '', error: `apt: sub-perintah "${sub}" tidak didukung. Pakai: update · show · search · download · list-deb` };
    }
    const pkg = (args[1] || '').trim();
    if (!pkg) return { ok: false, code: 1, stdout: '', stderr: '', error: 'apt: nama paket kosong' };
    const idx = await getIndex();

    if (sub === 'search') {
      const re = new RegExp(pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const hits = [...idx.keys()].filter((n) => re.test(n)).slice(0, 20);
      if (!hits.length) return { ok: false, code: 1, stdout: '', stderr: '', error: `Tidak ada paket main yang cocok dengan "${pkg}"` };
      return { ok: true, code: 0, stdout: hits.map((n) => `${n} — ${idx.get(n).version}`).join('\n'), stderr: '', error: '' };
    }

    const entry = idx.get(pkg);
    if (!entry) {
      return { ok: false, code: 1, stdout: '', stderr: '', error: `Paket "${pkg}" tidak ada di index (noble/main amd64). Coba "apt search ${pkg}" untuk yang mirip.` };
    }

    if (sub === 'show') {
      return { ok: true, code: 0, stdout: `Paket: ${entry.pkg}\nVersi: ${entry.version}\nUkuran: ${((entry.size || 0) / 1e6).toFixed(1)} MB\nDeskripsi: ${entry.description || '(kosong)'}\nUnduh: apt download ${entry.pkg}`, stderr: '', error: '' };
    }

    if (sub === 'download') {
      const url = `${ARCHIVE}/${entry.filename}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'nexus9-executor' } });
      if (!r.ok) throw new Error(`unduh .deb HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      ensureDir(APT_DIR);
      const file = `${APT_DIR}/${pkg}.deb`;
      fs.writeFileSync(file, buf);
      return { ok: true, code: 0, stdout: `✓ ${path.basename(entry.filename)} (${(buf.length / 1e6).toFixed(1)} MB) diunduh ke sandbox — file .deb nyata dari ${url}\nCek isi: apt list-deb ${pkg}`, stderr: '', error: '' };
    }

    if (sub === 'list-deb') {
      const file = `${APT_DIR}/${pkg}.deb`;
      if (!fs.existsSync(file)) return { ok: false, code: 1, stdout: '', stderr: '', error: `Belum ada ${pkg}.deb. Jalankan "apt download ${pkg}" dulu.` };
      const members = listArMembers(fs.readFileSync(file));
      return { ok: true, code: 0, stdout: `Isi ar ${pkg}.deb:\n${members.join('\n')}`, stderr: '', error: '' };
    }
  } catch (err) {
    return { ok: false, code: 1, stdout: '', stderr: '', error: String(err.message || err).slice(0, 400) };
  }
  return { ok: false, code: 1, stdout: '', stderr: '', error: 'apt: kesalahan tak dikenal' };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'JSON tidak valid' }); }

  ensureDir(WORK);
  const parsed = parseCmd(body.cmd);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    let result;
    if (parsed.tool === 'apt' || parsed.tool === 'apt-get') {
      result = await runApt(parsed.args);
    } else {
      result = await run(parsed.tool, parsed.args, { cwd: parsed.cwd, timeout: 45000 });
    }
    let rtk = null;
    if (body.compress !== false) {
      const cOut = compress(result.stdout || '');
      const cErr = compress(result.stderr || '');
      result.stdout = cOut.text;
      result.stderr = cErr.text;
      const original = cOut.original + cErr.original;
      const compressed = cOut.compressed + cErr.compressed;
      const saved = Math.max(0, original - compressed);
      rtk = {
        original,
        compressed,
        saved,
        savedPct: original ? Math.round((saved / original) * 100) : 0,
        rules: [...new Set([...cOut.rules, ...cErr.rules])],
        skipped: cOut.skipped && cErr.skipped,
      };
    }
    return res.status(200).json({ ok: result.ok, code: result.code, stdout: result.stdout, stderr: result.stderr, error: result.error || (result.ok ? '' : `exit ${result.code}`), rtk });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 400) });
  }
}

module.exports = handler;
