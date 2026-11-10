// FEMOS Kit device adapters. One source-neutral reading shape, many capture modes:
// camera OCR (any display), Bluetooth LE standard health profiles, USB, lab files, manual.
// The Bluetooth SIG health profiles below are public standards; parsers are tested against
// specification-format byte vectors (tests/devices.test.js). A device is only "compatible"
// after it is validated on real units (docs/KIT.md).

export const GATT = {
  bloodPressure: { service: 0x1810, measurement: 0x2a35 },
  glucose: { service: 0x1808, measurement: 0x2a18, racp: 0x2a52 },
  thermometer: { service: 0x1809, measurement: 0x2a1c },
};

/** IEEE-11073 16-bit SFLOAT (4-bit exponent, 12-bit mantissa). Special values → null. */
export function sfloat(raw) {
  const m = raw & 0x0fff;
  if ([0x07ff, 0x0800, 0x07fe, 0x0802, 0x0801].includes(m)) return null; // NaN, NRes, ±INF, reserved
  const mant = m >= 0x0800 ? m - 0x1000 : m;
  let exp = (raw >> 12) & 0x0f;
  if (exp >= 0x08) exp -= 0x10;
  return Number((mant * 10 ** exp).toFixed(Math.max(0, -exp)));
}

/** IEEE-11073 32-bit FLOAT (8-bit exponent, 24-bit mantissa). */
export function float32(raw) {
  const m = raw & 0x00ffffff;
  if ([0x007fffff, 0x00800000, 0x007ffffe, 0x00800002, 0x00800001].includes(m)) return null;
  const mant = m >= 0x00800000 ? m - 0x01000000 : m;
  let exp = (raw >> 24) & 0xff;
  if (exp >= 0x80) exp -= 0x100;
  return Number((mant * 10 ** exp).toFixed(Math.max(0, -exp)));
}

function dateTime(dv, o) {
  const y = dv.getUint16(o, true);
  const d = [dv.getUint8(o + 2), dv.getUint8(o + 3), dv.getUint8(o + 4), dv.getUint8(o + 5), dv.getUint8(o + 6)];
  if (!y || !d[0] || !d[1]) return null;
  return new Date(Date.UTC(y, d[0] - 1, d[1], d[2], d[3], d[4])).toISOString().replace('.000Z', '');
}
const view = (bytes) => (bytes instanceof DataView ? bytes : new DataView(Uint8Array.from(bytes).buffer));

/** Blood Pressure Measurement (0x2A35) → three separate values (+ optional pulse). */
export function parseBloodPressure(bytes) {
  const dv = view(bytes);
  const flags = dv.getUint8(0);
  const unit = flags & 0x01 ? 'kPa' : 'mmHg';
  let o = 1;
  const systolic = sfloat(dv.getUint16(o, true)), diastolic = sfloat(dv.getUint16(o + 2, true)), map = sfloat(dv.getUint16(o + 4, true));
  o += 6;
  let measuredAt = null, pulse = null, userId = null, status = null;
  if (flags & 0x02) { measuredAt = dateTime(dv, o); o += 7; }
  if (flags & 0x04) { pulse = sfloat(dv.getUint16(o, true)); o += 2; }
  if (flags & 0x08) { userId = dv.getUint8(o); o += 1; }
  if (flags & 0x10) {
    const s = dv.getUint16(o, true);
    status = { bodyMovement: !!(s & 0x01), cuffTooLoose: !!(s & 0x02), irregularPulse: !!(s & 0x04), improperPosition: !!(s & 0x20) };
  }
  const problems = [];
  if (systolic == null || diastolic == null) problems.push('missing value');
  if (status?.bodyMovement) problems.push('body movement during measurement');
  if (status?.cuffTooLoose) problems.push('cuff fit');
  if (status?.improperPosition) problems.push('measurement position');
  return {
    kind: 'bp',
    values: [
      { code: '8480-6', name: 'Systolic blood pressure', value: systolic, unit },
      { code: '8462-4', name: 'Diastolic blood pressure', value: diastolic, unit },
      ...(pulse != null ? [{ code: '8867-4', name: 'Heart rate', value: pulse, unit: '/min' }] : []),
    ],
    meanArterial: map,
    measuredAt,
    userId,
    status,
    quality: problems.length ? 'needs_repeat' : 'ok',
    problems,
    method: 'ble_gatt',
  };
}

/** Glucose Measurement (0x2A18). Concentration in kg/L (→ mg/dL) or mol/L (→ mmol/L). */
export function parseGlucose(bytes) {
  const dv = view(bytes);
  const flags = dv.getUint8(0);
  const sequence = dv.getUint16(1, true);
  const measuredAt = dateTime(dv, 3);
  let o = 10;
  if (flags & 0x01) o += 2; // time offset
  let value = null, unit = null, type = null, location = null;
  if (flags & 0x02) {
    const c = sfloat(dv.getUint16(o, true));
    if (flags & 0x04) { value = c == null ? null : Number((c * 1000).toFixed(2)); unit = 'mmol/L'; }
    else { value = c == null ? null : Math.round(c * 100000); unit = 'mg/dL'; }
    const tl = dv.getUint8(o + 2);
    type = ['reserved', 'capillary whole blood', 'capillary plasma', 'venous whole blood', 'venous plasma', 'arterial whole blood', 'arterial plasma', 'undetermined whole blood', 'undetermined plasma', 'interstitial fluid', 'control solution'][tl & 0x0f] ?? 'unknown';
    location = ['reserved', 'finger', 'alternate site', 'earlobe', 'control solution'][(tl >> 4) & 0x0f] ?? 'unknown';
    o += 3;
  }
  const problems = [];
  if (value == null) problems.push('no concentration');
  if (type === 'control solution' || location === 'control solution') problems.push('control solution test, not a patient sample');
  return { kind: 'glucose', values: [{ code: '2339-0', name: 'Glucose [Mass/volume] in Blood', value, unit }], sequence, measuredAt, sampleType: type, sampleLocation: location, quality: problems.length ? 'reject' : 'ok', problems, method: 'ble_gatt' };
}

/** Temperature Measurement (0x2A1C). */
export function parseTemperature(bytes) {
  const dv = view(bytes);
  const flags = dv.getUint8(0);
  const value = float32(dv.getUint32(1, true));
  return { kind: 'temperature', values: [{ code: '8310-5', name: 'Body temperature', value, unit: flags & 0x01 ? '[degF]' : 'Cel' }], measuredAt: flags & 0x02 ? dateTime(dv, 5) : null, quality: value == null ? 'reject' : 'ok', method: 'ble_gatt' };
}

/**
 * Web Bluetooth connector (Chrome on Android/desktop). Subscribes to a standard measurement
 * characteristic and resolves with the first parsed measurement. Pairing, record-access and
 * per-model quirks must be validated on real hardware before any compatibility claim.
 */
export async function readViaWebBluetooth(kind, { timeoutMs = 60000 } = {}) {
  const spec = { bp: [GATT.bloodPressure, parseBloodPressure], glucose: [GATT.glucose, parseGlucose], temperature: [GATT.thermometer, parseTemperature] }[kind];
  if (!spec) throw new Error(`no Bluetooth profile for ${kind}`);
  if (!globalThis.navigator?.bluetooth) throw new Error('Web Bluetooth is not available on this browser/device');
  const [g, parse] = spec;
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [g.service] }] });
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(g.service);
  const ch = await svc.getCharacteristic(g.measurement);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { device.gatt.disconnect(); reject(new Error('no measurement received')); }, timeoutMs);
    ch.addEventListener('characteristicvaluechanged', (e) => {
      clearTimeout(timer);
      const r = parse(e.target.value);
      device.gatt.disconnect();
      resolve({ ...r, device: { name: device.name ?? null, id: device.id } });
    });
    ch.startNotifications().catch(reject);
  });
}

/** Look up how a registry device can be read, best mode first. */
export function captureModes(registry, deviceId) {
  const d = registry.devices.find((x) => x.id === deviceId);
  if (!d) return [];
  const rank = { validated: 0, 'synthetic-tested': 1, implemented: 2, planned: 9, 'manual-only': 5 };
  return Object.entries(d.modes).filter(([, s]) => s !== 'planned').sort((a, b) => rank[a[1]] - rank[b[1]]).map(([mode, status]) => ({ mode, status }));
}
