// Patient identity: established identifiers first (ABHA, programme IDs), then approved
// fuzzy matching across scripts. Matching only ever PROPOSES a link; a human resolves it.

const DEV_CONS = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
  ष: 'sh', स: 's', ह: 'h', ड़: 'r', ढ़: 'rh', क़: 'q', ख़: 'kh', ग़: 'g', ज़: 'z', फ़: 'f',
};
const DEV_VOW = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au' };
const DEV_MATRA = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au' };
const BN_CONS = {
  ক: 'k', খ: 'kh', গ: 'g', ঘ: 'gh', চ: 'ch', ছ: 'chh', জ: 'j', ঝ: 'jh', ট: 't', ঠ: 'th', ড: 'd', ঢ: 'dh',
  ণ: 'n', ত: 't', থ: 'th', দ: 'd', ধ: 'dh', ন: 'n', প: 'p', ফ: 'ph', ব: 'b', ভ: 'bh', ম: 'm', য: 'j',
  র: 'r', ল: 'l', শ: 'sh', ষ: 'sh', স: 's', হ: 'h', ড়: 'r', ঢ়: 'rh', য়: 'y',
};
const BN_VOW = { অ: 'o', আ: 'a', ই: 'i', ঈ: 'i', উ: 'u', ঊ: 'u', এ: 'e', ঐ: 'oi', ও: 'o', ঔ: 'ou' };
const TA_CONS = {
  க: 'k', ங: 'ng', ச: 's', ஞ: 'nj', ட: 't', ண: 'n', த: 'th', ந: 'n', ப: 'p', ம: 'm', ய: 'y', ர: 'r',
  ல: 'l', வ: 'v', ழ: 'zh', ள: 'l', ற: 'r', ன: 'n', ஜ: 'j', ஷ: 'sh', ஸ: 's', ஹ: 'h',
};
const TA_VOW = { அ: 'a', ஆ: 'aa', இ: 'i', ஈ: 'ee', உ: 'u', ஊ: 'oo', எ: 'e', ஏ: 'e', ஐ: 'ai', ஒ: 'o', ஓ: 'o', ஔ: 'au' };
const TA_MATRA = { 'ா': 'aa', 'ி': 'i', 'ீ': 'ee', 'ு': 'u', 'ூ': 'oo', 'ெ': 'e', 'ே': 'e', 'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au' };
const BN_MATRA = { 'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou' };

function translit(str, CONS, VOW, MATRA, inherent, virama) {
  const chars = [...str.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (CONS[c]) {
      out += CONS[c];
      const next = chars[i + 1];
      if (next === virama) i++;
      else if (MATRA[next]) { out += MATRA[next]; i++; }
      else if (next && (CONS[next] || VOW[next])) out += inherent;
      else if (!next || next === ' ') out += ''; // schwa deletion at word end
    } else if (VOW[c]) out += VOW[c];
    else if (MATRA[c]) out += MATRA[c];
    else if (c === 'ं' || c === 'ঁ' || c === 'ং' || c === 'ँ') out += 'n';
    else if (c === 'ः') out += 'h';
    else out += c;
  }
  return out;
}

/** Script-independent phonetic key for a name. प्रिया, Priya, Pria, PRIYAA → "prya"-like key. */
export function nameKey(name) {
  let s = String(name ?? '').trim();
  if (/[ऀ-ॿ]/.test(s)) s = translit(s, DEV_CONS, DEV_VOW, DEV_MATRA, 'a', '्');
  if (/[ঀ-৿]/.test(s)) s = translit(s, BN_CONS, BN_VOW, BN_MATRA, 'o', '্');
  if (/[஀-௿]/.test(s)) {
    // Tamil writes consonant clusters with a vowel (பிரியா = pi-ri-yaa for "Priya"): drop a
    // short epenthetic i/u between an initial consonant and r/l so both spellings meet.
    s = translit(s, TA_CONS, TA_VOW, TA_MATRA, 'a', '்').replace(/^([kgptdbs])[iu](?=[rl])/, '$1');
  }
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[^a-z ]/g, '');
  s = s
    .replace(/ph/g, 'f').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k')
    .replace(/(kh|gh|chh|ch|jh|th|dh|bh|sh)/g, (m) => m[0])
    .replace(/ee|ii|ie|ey/g, 'i').replace(/oo|uu|ou/g, 'u').replace(/aa/g, 'a')
    .replace(/iy(?=a)/g, 'i').replace(/y(?=a\b)/g, '').replace(/h\b/g, '')
    .replace(/([a-z])\1+/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** Jaro-Winkler similarity in [0,1]. */
export function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const md = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - md); j < Math.min(b.length, i + md + 1); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let tr = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) tr++; k++; }
  const j = (m / a.length + m / b.length + (m - tr / 2) / m) / 3;
  let l = 0;
  while (l < 4 && a[l] === b[l]) l++;
  return j + l * 0.1 * (1 - j);
}

/**
 * Compare two patient records. Shared official identifier decides outright;
 * otherwise a weighted score with human-readable reasons.
 */
export function matchPatients(p, q) {
  const ids = (x) => new Map((x.identifiers ?? []).map((i) => [i.system, i.value]));
  const pi = ids(p), qi = ids(q);
  for (const [sys, v] of pi) {
    if (qi.has(sys)) {
      return qi.get(sys) === v
        ? { score: 1, level: 'same_identifier', reasons: [`same ${sys}`] }
        : { score: 0, level: 'different_identifier', reasons: [`different ${sys}`] };
    }
  }
  const reasons = [];
  const ns = jaroWinkler(nameKey(p.name), nameKey(q.name));
  reasons.push(`name similarity ${ns.toFixed(2)} (${nameKey(p.name)} ~ ${nameKey(q.name)})`);
  let score = ns * 0.5;
  // Demographics only corroborate a name match; they never create one (common village names,
  // shared birth years). Full name or given name must be close first.
  const given = (n) => nameKey(n).split(' ')[0] ?? '';
  const gs0 = jaroWinkler(given(p.name), given(q.name));
  if (ns < 0.85 && gs0 < 0.85) {
    reasons.push('names differ: demographics not considered');
    return { score: Math.round(score * 100) / 100, level: 'unlikely', reasons };
  }
  if (p.birthYear && q.birthYear) {
    const d = Math.abs(p.birthYear - q.birthYear);
    score += d === 0 ? 0.2 : d === 1 ? 0.12 : 0;
    reasons.push(d <= 1 ? `birth year within ${d}` : `birth year differs by ${d}`);
  }
  if (p.village && q.village) {
    const vs = jaroWinkler(nameKey(p.village), nameKey(q.village));
    if (vs > 0.9) { score += 0.15; reasons.push('same village'); }
  }
  if (p.guardian && q.guardian) {
    const gs = jaroWinkler(nameKey(p.guardian), nameKey(q.guardian));
    if (gs > 0.88) { score += 0.15; reasons.push('same guardian name'); }
  }
  if (p.phone && q.phone && p.phone.slice(-10) === q.phone.slice(-10)) { score += 0.1; reasons.push('same phone (shared phones are common: weak evidence)'); }
  score = Math.round(Math.min(0.99, score) * 100) / 100;
  const level = score >= 0.8 ? 'likely' : score >= 0.65 ? 'possible' : 'unlikely';
  return { score: Math.round(score * 100) / 100, level, reasons };
}

/** Find candidate duplicates of `patient` among `others` (each {caseId, patient}). */
export function findDuplicates(patient, others) {
  return others
    .map((o) => ({ caseId: o.caseId, patient: o.patient, ...matchPatients(patient, o.patient) }))
    .filter((m) => m.level === 'likely' || m.level === 'possible' || m.level === 'same_identifier')
    .sort((a, b) => b.score - a.score);
}
