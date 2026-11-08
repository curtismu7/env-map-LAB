// The web tests talk to the REAL server (a child process on loopback), so the UI is checked against the real API, not a copy of it.
import { spawn } from "node:child_process";
import path from "node:path";

export async function startLab({ env = { STANDALONE_ENV: "/nonexistent/settings.env" } } = {}) {
  const child = spawn(process.execPath, [path.resolve(process.cwd(), "src/labProcess.mjs")], { env: { PATH: process.env.PATH, LAB_ENV: JSON.stringify(env) }, stdio: ["ignore", "pipe", "inherit"] });
  let buf = "";
  child.stdout.on("data", (d) => { buf += d; });
  const base = await new Promise((resolve, reject) => {
    const tick = setInterval(() => { const m = /URL (http:\/\/127\.0\.0\.1:\d+)\//.exec(buf); if (m) { clearInterval(tick); resolve(m[1]); } }, 20);
    child.once("exit", (code) => { clearInterval(tick); reject(new Error(`lab process exited early (${code})`)); });
    setTimeout(() => { clearInterval(tick); reject(new Error("lab process did not start")); }, 15000);
  });
  const realFetch = globalThis.fetch;
  // The page calls relative URLs; send them to the lab process and add the same-origin header a browser would.
  globalThis.fetch = (u, o = {}) => realFetch(new URL(String(u), base), { ...o, headers: { origin: base, ...(o.headers || {}) } });
  const attempts = () => new Promise((resolve) => {
    const before = buf.length;
    const tick = setInterval(() => { const m = /ATTEMPTS (\[.*\])/.exec(buf.slice(before)); if (m) { clearInterval(tick); resolve(JSON.parse(m[1])); } }, 20);
    child.kill("SIGUSR2");
  });
  return { base, attempts, close: async () => { globalThis.fetch = realFetch; child.removeAllListeners("exit"); child.kill(); } };
}
