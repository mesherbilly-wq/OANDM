import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function load() {
  try {
    return await import('../src/lib/cctvNcp104Completion.ts');
  } catch {
    return require('../src/lib/cctvNcp104Completion.ts');
  }
}

const { CCTV_NCP104_SCHEMA, CCTV_NCP104_SOURCE_TRACE } = await import('../src/lib/cctvNcp104Completion.ts');
const { emptyAnswers, validateAnswers, isFieldVisible, asRecord } = await import('../src/lib/completionFormEngine.ts');

assert.equal(CCTV_NCP104_SCHEMA.sections.length >= 12, true, 'expected the source sections');
assert.equal(CCTV_NCP104_SOURCE_TRACE.length >= 16, true, 'source trace is incomplete');
assert.match(CCTV_NCP104_SCHEMA.statusNotice, /not an official NSI certificate/i);

const camera = CCTV_NCP104_SCHEMA.sections.find(section => section.id === 'cameras').groups[0];
const ip = camera.fields.find(field => field.id === 'ip_address');
assert.equal(isFieldVisible(ip, { camera_technology: 'HD IP' }, {}), true);
assert.equal(isFieldVisible(ip, { camera_technology: 'ANALOGUE' }, {}), false);

const answers = emptyAnswers(CCTV_NCP104_SCHEMA);
const issues = validateAnswers(CCTV_NCP104_SCHEMA, answers, [], 'engineer');
assert.equal(issues.some(issue => issue.path.includes('job.job_number')), true);
assert.equal(asRecord(answers.job).engineer === '', true);

const sensitive = CCTV_NCP104_SCHEMA.sections.flatMap(section => [
  ...(section.fields ?? []),
  ...(section.groups ?? []).flatMap(group => group.fields),
]).filter(field => field.sensitive);
assert.equal(sensitive.some(field => /password/i.test(field.label)), true);

console.log(`ok ${CCTV_NCP104_SCHEMA.sections.length} sections, ${CCTV_NCP104_SOURCE_TRACE.length} source rows, ${issues.length} empty-form issues`);
