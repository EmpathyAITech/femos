import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sfloat, float32, parseBloodPressure, parseGlucose, parseTemperature, captureModes } from '../core/devices.js';

const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
// SFLOAT encode helper for building specification-format vectors.
const sf = (mant, exp = 0) => ((exp & 0x0f) << 12) | (mant & 0x0fff);

test('IEEE-11073 SFLOAT decoding incl. negative exponent and special values', () => {
  assert.equal(sfloat(sf(120)), 120);
  assert.equal(sfloat(sf(965, -1)), 96.5);
  assert.equal(sfloat(0x07ff), null); // NaN
  assert.equal(sfloat(0x0800), null); // NRes
  assert.equal(float32((0xff << 24) | 368), 36.8);
});

test('Blood Pressure Measurement: timestamp, pulse, status → three separate values', () => {
  const flags = 0x02 | 0x04 | 0x10; // time, pulse, status; mmHg
  const bytes = [flags, ...le16(sf(118)), ...le16(sf(76)), ...le16(sf(90)), ...le16(2026), 11, 9, 10, 15, 30, ...le16(sf(72)), ...le16(0x0000)];
  const r = parseBloodPressure(bytes);
  assert.deepEqual(r.values.map((v) => [v.code, v.value, v.unit]), [['8480-6', 118, 'mmHg'], ['8462-4', 76, 'mmHg'], ['8867-4', 72, '/min']]);
  assert.equal(r.measuredAt, '2026-11-09T10:15:30');
  assert.equal(r.quality, 'ok');
});

test('Blood Pressure with body movement is marked for repeat, never silently accepted', () => {
  const bytes = [0x10, ...le16(sf(150)), ...le16(sf(95)), ...le16(sf(113)), ...le16(0x0001)];
  const r = parseBloodPressure(bytes);
  assert.equal(r.quality, 'needs_repeat');
  assert.ok(r.problems.includes('body movement during measurement'));
});

test('Glucose Measurement kg/L → mg/dL, and control solution is rejected', () => {
  // 0x02: concentration present, kg/L. 98 mg/dL = 0.00098 kg/L = 98e-5 → SFLOAT mant 98 exp -5
  const base = [0x02, ...le16(7), ...le16(2026), 11, 9, 8, 0, 0];
  const r = parseGlucose([...base, ...le16(sf(98, -5)), 0x11]); // capillary whole blood, finger
  assert.equal(r.values[0].value, 98);
  assert.equal(r.values[0].unit, 'mg/dL');
  assert.equal(r.sampleLocation, 'finger');
  assert.equal(r.quality, 'ok');
  const c = parseGlucose([...base, ...le16(sf(98, -5)), 0x4a]); // control solution
  assert.equal(c.quality, 'reject');
});

test('Glucose mol/L → mmol/L', () => {
  const r = parseGlucose([0x06, ...le16(1), ...le16(2026), 1, 1, 0, 0, 0, ...le16(sf(54, -4)), 0x11]); // 0.0054 mol/L
  assert.equal(r.values[0].value, 5.4);
  assert.equal(r.values[0].unit, 'mmol/L');
});

test('Temperature Measurement', () => {
  const raw = (0xff << 24) | 371;
  const r = parseTemperature([0x00, raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff, (raw >>> 24) & 0xff]);
  assert.equal(r.values[0].value, 37.1);
  assert.equal(r.values[0].unit, 'Cel');
});

test('Kit registry: every device has modes; planned modes are never offered', () => {
  const reg = JSON.parse(readFileSync(new URL('../adapters/registry.json', import.meta.url)));
  for (const d of reg.devices) assert.ok(Object.keys(d.modes).length, d.id);
  const m = captureModes(reg, 'omron-bp-arm');
  assert.ok(m.some((x) => x.mode === 'ble_gatt'));
  assert.ok(!m.some((x) => x.mode === 'camera_ocr'), 'planned modes are hidden');
  assert.equal(reg.devices.filter((d) => Object.values(d.modes).includes('validated')).length, 0, 'nothing is claimed validated yet');
});
