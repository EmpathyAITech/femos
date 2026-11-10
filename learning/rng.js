// Small deterministic PRNG utilities (mulberry32). No dependencies, so a given seed always
// produces the same synthetic data on every machine and Node version.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrap a uniform generator with the helpers the generators need. */
export function makeRng(seed) {
  const u = mulberry32(seed);
  let spare = null;
  const r = {
    u,
    /** uniform float in [a, b) */
    range: (a, b) => a + (b - a) * u(),
    /** integer in [a, b] inclusive */
    int: (a, b) => a + Math.floor(u() * (b - a + 1)),
    bool: (p) => u() < p,
    pick: (arr) => arr[Math.floor(u() * arr.length)],
    /** weighted pick from [[value, weight], ...] */
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = u() * total;
      for (const [v, w] of pairs) if ((x -= w) < 0) return v;
      return pairs.at(-1)[0];
    },
    /** standard normal (Box–Muller, cached spare) */
    normal: (mean = 0, sd = 1) => {
      if (spare != null) {
        const s = spare;
        spare = null;
        return mean + sd * s;
      }
      let x, y, q;
      do {
        x = u() * 2 - 1;
        y = u() * 2 - 1;
        q = x * x + y * y;
      } while (q >= 1 || q === 0);
      const f = Math.sqrt((-2 * Math.log(q)) / q);
      spare = y * f;
      return mean + sd * x * f;
    },
    shuffle: (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(u() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** k distinct items */
    sample: (arr, k) => r.shuffle(arr).slice(0, k),
    hex: (n) => Array.from({ length: n }, () => Math.floor(u() * 16).toString(16)).join(''),
  };
  return r;
}

export function parseSeed(argv, fallback = 42) {
  const i = argv.indexOf('--seed');
  if (i >= 0 && argv[i + 1] != null) return Number(argv[i + 1]);
  const kv = argv.find((a) => a.startsWith('--seed='));
  return kv ? Number(kv.split('=')[1]) : fallback;
}
