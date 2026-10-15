// Knowledge base: parsing, serialising and BM25-style search.
// Entries live in plain markdown files so anyone can add to them with a pull request.
//
// Format of an entry:
//   @@@ entry-id
//   title: Human readable title
//   tags: extra search words
//   ---
//   Markdown body (code fences allowed)

export const KB_FILES = ['kb/core.md', 'kb/roblox.md', 'kb/patterns.md', 'kb/community.md'];

const STOP = new Set(
  ('a an the is are was were be been to of in on for and or with how do does did i my me you your it its ' +
    'this that these those can could would should what why when where which who use using used from at as by ' +
    'if so not no but just also into than then there here make makes get gets want need please help roblox luau')
    .split(' ')
);

export function parseKB(text, source = 'kb') {
  const out = [];
  const chunks = text.replace(/\r\n/g, '\n').split(/^@@@[ \t]*/m).slice(1);
  for (const c of chunks) {
    const nl = c.indexOf('\n');
    if (nl < 0) continue;
    const id = c.slice(0, nl).trim();
    const rest = c.slice(nl + 1);
    const m = rest.match(/^---[ \t]*$/m);
    if (!m) continue;
    const head = rest.slice(0, m.index);
    const body = rest.slice(m.index + m[0].length).trim();
    const meta = {};
    for (const line of head.split('\n')) {
      const k = line.match(/^(\w+):\s*(.*)$/);
      if (k) meta[k[1]] = k[2].trim();
    }
    if (id && meta.title && body) out.push({ id, title: meta.title, tags: meta.tags || '', text: body, source });
  }
  return out;
}

export function serializeEntries(entries) {
  return (
    entries
      .map((e) => `@@@ ${e.id}\ntitle: ${e.title.replace(/\n/g, ' ')}\ntags: ${e.tags || ''}\n---\n${e.text}\n`)
      .join('\n') + '\n'
  );
}

export async function loadKB(base = './') {
  const all = [];
  const results = await Promise.allSettled(
    KB_FILES.map(async (f) => {
      const res = await fetch(base + f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(f + ' ' + res.status);
      return parseKB(await res.text(), f);
    })
  );
  for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
  return all;
}

function stem(w) {
  return w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

export function tokenize(s) {
  const out = [];
  for (const raw of s.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase()
      .split(' ');
    for (const w of parts) if (w.length > 1 && !STOP.has(w)) out.push(stem(w));
    const joined = raw.toLowerCase().replace(/_/g, '');
    if (parts.length > 1 && joined.length > 3) out.push(joined);
  }
  return out;
}

export class Index {
  constructor(docs) {
    this.docs = docs;
    this.rows = docs.map((d) => {
      const tf = new Map();
      let len = 0;
      const add = (toks, w) => {
        for (const t of toks) {
          tf.set(t, (tf.get(t) || 0) + w);
          len += w;
        }
      };
      add(tokenize(d.title), 3);
      add(tokenize(d.tags || ''), 2);
      add(tokenize(d.text), 1);
      return { tf, len };
    });
    this.avg = this.rows.reduce((s, r) => s + r.len, 0) / Math.max(1, this.rows.length);
    this.df = new Map();
    for (const r of this.rows) for (const t of r.tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
  }

  search(query, k = 4) {
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    const N = this.rows.length;
    const k1 = 1.4;
    const b = 0.6;
    const out = [];
    this.rows.forEach((row, i) => {
      const bm = (f, df) => {
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        return (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * row.len) / this.avg));
      };
      let score = 0;
      let hit = 0;
      for (const qt of q) {
        let best = 0;
        const exact = row.tf.get(qt);
        if (exact) {
          best = bm(exact, this.df.get(qt));
        } else if (qt.length >= 4) {
          for (const [t, f] of row.tf) {
            if (t.length >= 4 && (t.startsWith(qt) || qt.startsWith(t))) {
              best = Math.max(best, 0.5 * bm(f, this.df.get(t)));
            }
          }
        }
        if (best > 0) {
          score += best;
          hit++;
        }
      }
      if (score > 0) out.push({ doc: this.docs[i], score, ratio: hit / q.length });
    });
    out.sort((a, b2) => b2.score - a.score || b2.ratio - a.ratio);
    return out.slice(0, k);
  }
}
