/**
 * Probes connected Supabase PostgREST for project_systems exposure.
 * Reads VITE_SUPABASE_* from .env / .env.local without printing secrets.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

const root = resolve(import.meta.dirname, '..');
loadEnvFile(resolve(root, '.env'));
loadEnvFile(resolve(root, '.env.local'));

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.log('MISSING_ENV: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not found in .env / .env.local');
  process.exit(1);
}

async function probe(label, requestUrl, method = 'GET') {
  const res = await fetch(requestUrl, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=minimal' : undefined,
    },
    body:
      method === 'POST'
        ? JSON.stringify({
            project_id: 1,
            system_name: '__probe_do_not_persist__',
            display_order: 0,
          })
        : undefined,
  });

  const text = await res.text();
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${res.status}`);
  console.log(text.slice(0, 500) || '(empty body)');
}

await probe(
  'GET /rest/v1/project_systems?select=id&limit=1',
  `${url}/rest/v1/project_systems?select=id&limit=1`,
);
await probe(
  'HEAD /rest/v1/project_systems (PostgREST schema exposure)',
  `${url}/rest/v1/project_systems`,
  'HEAD',
);
await probe(
  'POST /rest/v1/project_systems (minimal probe row)',
  `${url}/rest/v1/project_systems`,
  'POST',
);
await probe(
  'GET /rest/v1/projects?select=id&limit=1 (control - known table)',
  `${url}/rest/v1/projects?select=id&limit=1`,
);

for (const col of ['system_category', 'project_system_id']) {
  await probe(
    `GET /rest/v1/devices?select=id,${col}&limit=1 (column probe)`,
    `${url}/rest/v1/devices?select=id,${col}&limit=1`,
  );
}
