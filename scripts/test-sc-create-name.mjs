/**
 * Test SC inspection naming via proxy create_inspection.
 * Usage: node scripts/test-sc-create-name.mjs [template_id]
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
if (!url || !key) process.exit(1);

const templateId = process.argv[2];
const testName = process.argv[3] ?? 'Genetec Upgrade - CCTV Handover Certificate';
const AUDIT_TITLE = 'f3245d40-ea77-11e1-aff1-0800200c9a66';

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
  return { status: res.status, data: await res.json() };
}

let tid = templateId;
if (!tid) {
  const defs = await fetch(`${url}/rest/v1/handover_document_definitions?select=sc_template_id,title&sc_template_id=not.is.null&limit=5`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).then(r => r.json());
  tid = defs?.[0]?.sc_template_id;
  console.log('Using handover template from DB:', defs?.[0]?.title, tid);
}
if (!tid) {
  console.log('No template id');
  process.exit(1);
}

const create = await invoke('create_inspection', {
  template_id: tid,
  name: testName,
  audit_title_item_id: AUDIT_TITLE,
  items: [{
    item_id: AUDIT_TITLE,
    item_type: 'TEXT',
    text_item: { value: testName },
  }],
});

console.log('\ncreate_inspection:', create.status);
console.log(JSON.stringify(create.data, null, 2));

const inspectionId = create.data?.inspection_id;
if (!inspectionId) process.exit(1);

const auditId = inspectionId.startsWith('insp_') ? `audit_${inspectionId.slice(5)}` : inspectionId;
const details = await invoke('get_inspection', { inspection_id: inspectionId });
console.log('\nget_inspection:', details.status, JSON.stringify(details.data, null, 2));
