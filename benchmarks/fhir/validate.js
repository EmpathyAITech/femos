// Validates every FHIR bundle FEMOS produces for the demo cases against the official HL7 FHIR R4
// JSON Schema (benchmarks/fhir/fhir.schema.json, from https://hl7.org/fhir/R4/fhir.schema.json.zip).
// Scope: structure and datatypes. NOT terminology bindings or FHIRPath invariants. Those need the
// HL7 Java validator or a FHIR server's $validate (server/connectors supports that when configured).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import Ajv from 'ajv';
import { reduceAll } from '../../core/workflow.js';
import { toBundle } from '../../core/fhir.js';

const pack = JSON.parse(readFileSync(new URL('../../protocols/anemia-hmb/pack.json', import.meta.url)));
const schema = JSON.parse(readFileSync(new URL('./fhir.schema.json', import.meta.url)));
delete schema.$schema; // draft-06 → ajv draft-07
schema.$id = schema.id; delete schema.id;
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(schema);
const events = JSON.parse(readFileSync(new URL('../../data/demo/events.json', import.meta.url)));
const states = reduceAll(events).filter((s) => s.openedAt);
const out = { generatedAt: new Date().toISOString(), schema: 'HL7 FHIR R4 JSON Schema (fhir.schema.json)', scope: 'structure and datatypes; terminology and invariants not checked', bundles: 0, resources: 0, valid: 0, invalid: 0, byType: {}, errors: [] };
for (const s of states) {
  const b = toBundle(s, pack, { now: '2026-11-09T09:00:00Z' });
  out.bundles++;
  const okB = validate(b);
  if (!okB) out.errors.push({ caseId: s.caseId, where: 'Bundle', errors: validate.errors.slice(0, 3).map((e) => `${e.instancePath} ${e.message}`) });
  for (const e of b.entry) {
    const t = e.resource.resourceType;
    out.resources++;
    out.byType[t] ??= { n: 0, valid: 0 };
    out.byType[t].n++;
    if (validate(e.resource)) { out.valid++; out.byType[t].valid++; } else { out.invalid++; out.errors.push({ caseId: s.caseId, where: t, errors: validate.errors.slice(0, 3).map((x) => `${x.instancePath} ${x.message}`) }); }
  }
}
out.errors = out.errors.slice(0, 20);
mkdirSync(new URL('../../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../results/fhir.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`${out.bundles} bundles · ${out.resources} resources · valid ${out.valid} · invalid ${out.invalid}`);
console.log(Object.entries(out.byType).map(([k, v]) => `${k} ${v.valid}/${v.n}`).join(' · '));
for (const e of out.errors.slice(0, 8)) console.log('ERR', JSON.stringify(e));
process.exitCode = out.invalid ? 1 : 0;
