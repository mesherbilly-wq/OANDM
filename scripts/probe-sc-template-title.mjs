/**
 * Probes SC template structure + recent audit header items for title debugging.
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
  console.log('MISSING_ENV');
  process.exit(1);
}

async function invoke(action, extra = {}) {
  const res = await fetch(`${url}/functions/v1/safetyculture-proxy`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

const { data: defs } = await invoke('list_templates');
const templates = defs.templates ?? [];
console.log(`Templates: ${templates.length}`);
for (const t of templates.slice(0, 8)) {
  console.log(`- ${t.name} (${t.template_id ?? t.id})`);
}

const templateId = process.argv[2] ?? templates[0]?.template_id ?? templates[0]?.id;
if (!templateId) {
  console.log('No template id');
  process.exit(1);
}

console.log(`\nProbing template: ${templateId}`);

const def = await invoke('get_template_definition', { template_id: templateId });
console.log('\nget_template_definition status:', def.status);
const items = def.data?.items ?? [];
console.log('items:', items.length);
for (const item of items.slice(0, 20)) {
  console.log(`  ${item.item_id} | ${item.type} | ${item.label}`);
}
const titleLike = items.filter(i => /audit|title|project|job|client|site/i.test(i.label ?? ''));
console.log('\nTitle-related template items:');
for (const item of titleLike) {
  console.log(`  ${item.item_id} | ${item.type} | ${item.label}`);
}

const diag = await invoke('diagnose_template', { template_id: templateId });
console.log('\ndiagnose_template results:');
for (const r of diag.data?.results ?? []) {
  console.log(`  ${r.ok ? 'OK' : 'FAIL'} ${r.label} items=${r.item_count}`);
}
