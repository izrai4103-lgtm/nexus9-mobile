/* /api/run — terminal sandbox (npm/node/npx/apt) via executor bersama lib/exec + RTK compression. */
const { executeCmd } = require('../lib/exec');
const { compress } = require('../lib/rtk');

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'JSON tidak valid' }); }

  try {
    const result = await executeCmd(body.cmd);
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
