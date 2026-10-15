// Self-learning memory. The model's weights never change; instead the app keeps lessons
// (question + verified answer) in this browser and retrieves the best match for every new
// question. Lessons can be exported as markdown and contributed to kb/community.md.

import { parseKB, serializeEntries } from './kb.js';

const KEY = 'luauforge.lessons.v1';
const MAX_ITEMS = 300;

let items = load();

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage may be blocked; lessons then last for this session only */
  }
}

export function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const list = () => items.slice();

export function add(q, a, kind = 'taught') {
  q = String(q || '').trim();
  a = String(a || '').trim();
  if (!q || !a) return null;
  const id = 't-' + hash(q.toLowerCase().replace(/\s+/g, ' '));
  const rec = { id, q: q.slice(0, 300), a: a.slice(0, 8000), kind, ts: Date.now() };
  const i = items.findIndex((x) => x.id === id);
  if (i >= 0) items.splice(i, 1);
  items.unshift(rec);
  items = items.slice(0, MAX_ITEMS);
  persist();
  return rec;
}

export function remove(id) {
  items = items.filter((x) => x.id !== id);
  persist();
}

export function clear() {
  items = [];
  persist();
}

export const docs = () => items.map((x) => ({ id: x.id, title: x.q, tags: '', text: x.a }));

export function exportText() {
  return serializeEntries(items.map((x) => ({ id: x.id, title: x.q, tags: x.kind, text: x.a })));
}

export function importText(text) {
  let n = 0;
  for (const e of parseKB(text, 'import')) if (add(e.title, e.text, e.tags || 'taught')) n++;
  return n;
}
