// Reset (rule 3): POST /api/reset on the running app, which returns it to its launch mode (Real if configured, else Mock).
// Box positions live in the browser: use "Reset layout" there. Usage: node scripts/reset.mjs   (PORT overrides 7805)
const port = Number(process.env.PORT) || 7805;
const base = `http://127.0.0.1:${port}`;
try {
  const r = await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}', signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`reset failed: HTTP ${r.status}`); process.exit(1); }
  console.log(`reset: back to ${body.source} mode. Box positions: use "Reset layout" in the diagram.`);
} catch (e) {
  console.error(`reset failed: the app is not answering on ${base} (${e.name})`);
  process.exit(1);
}
