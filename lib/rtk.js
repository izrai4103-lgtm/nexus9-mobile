/* RTK Token Saver — kompresi lossless output tool (git diff, git log, dll)
   Menghemat token tanpa menghilangkan konteks:
   1) buang ANSI escape codes
   2) trim whitespace ujung baris + baris kosong beruntun
   3) buang baris duplikat (informasi nol, cukup 1x)
   4) cap panjang output
*/
const DROP_THRESHOLD = 1500; // char — di bawah ini tidak perlu dikompres
const HARD_CAP = 60000;

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); }

function trimLines(s) { return s.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n'); }

function collapseBlanks(s) { return s.replace(/\n{3,}/g, '\n\n'); }

function dedupLines(s) {
  const lines = s.split('\n');
  const seen = new Set();
  const out = [];
  let dropped = 0;
  for (const l of lines) {
    if (!l) { out.push(l); continue; }
    if (seen.has(l)) { dropped++; continue; }
    seen.add(l);
    out.push(l);
  }
  return { text: out.join('\n'), dropped };
}

function compress(text, opts = {}) {
  const orig = String(text || '');
  const threshold = opts.threshold || DROP_THRESHOLD;
  if (orig.length < threshold) {
    return { text: orig, original: orig.length, compressed: orig.length, saved: 0, savedPct: 0, rules: [], skipped: true };
  }
  const rules = [];
  let t = stripAnsi(orig);
  if (t !== orig) rules.push('ansi');
  const t2 = trimLines(t);
  if (t2 !== t) rules.push('trim-ws');
  const t3 = collapseBlanks(t2);
  if (t3 !== t2) rules.push('blank-collapse');
  const { text: t4, dropped } = dedupLines(t3);
  if (dropped > 0) rules.push(`dedup(${dropped})`);
  t = t4;
  if (t.length > HARD_CAP) { t = t.slice(0, HARD_CAP) + '\n…[RTK cap]'; rules.push('cap'); }

  const compressed = t.length;
  const saved = orig.length - compressed;
  const savedPct = orig.length ? Math.round((saved / orig.length) * 100) : 0;
  const rtkNote = saved > 0 ? `\n[RTK] kompresi: ${rules.join(', ') || 'ringan'} — ${(orig.length / 1024).toFixed(1)}KB → ${(compressed / 1024).toFixed(1)}KB (−${savedPct}%)` : '';
  return { text: t + rtkNote, original: orig.length, compressed: compressed + rtkNote.length, saved: saved - 0, savedPct, rules, skipped: false };
}

module.exports = { compress };
