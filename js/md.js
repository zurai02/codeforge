// Markdown renderer (escapes everything first) with a small Luau syntax highlighter.

export function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const KW = new Set(
  'and break do else elseif end false for function if in local nil not or repeat return then true until while continue export'.split(' ')
);
const BUILTIN = new Set(
  ('game workspace script task math string table os coroutine buffer bit32 utf8 debug Instance Enum Vector2 Vector3 CFrame Color3 ' +
    'UDim UDim2 TweenInfo Random Ray Region3 BrickColor NumberRange NumberSequence ColorSequence Rect Axes Faces DateTime ' +
    'RaycastParams OverlapParams CatalogSearchParams print warn error assert pcall xpcall pairs ipairs next select tostring tonumber ' +
    'type typeof require setmetatable getmetatable rawget rawset rawequal rawlen unpack self shared plugin').split(' ')
);

const TOKEN =
  /(--\[(=*)\[[\s\S]*?\]\2\]|--[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|\[(=*)\[[\s\S]*?\]\4\])|(0[xX][0-9a-fA-F_]+|\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;

export function highlightLua(code) {
  let out = '';
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(code))) {
    if (m[1] !== undefined) out += '<span class="tk-c">' + esc(m[1]) + '</span>';
    else if (m[3] !== undefined) out += '<span class="tk-s">' + esc(m[3]) + '</span>';
    else if (m[5] !== undefined) out += '<span class="tk-n">' + esc(m[5]) + '</span>';
    else if (m[6] !== undefined) {
      const w = m[6];
      if (KW.has(w)) out += '<span class="tk-k">' + w + '</span>';
      else if (BUILTIN.has(w)) out += '<span class="tk-b">' + w + '</span>';
      else out += w;
    } else out += esc(m[7]);
  }
  return out;
}

function inline(s) {
  return esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,:;!?]|$)/g, '$1<em>$2</em>');
}

function renderText(t) {
  let out = '';
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out += '<p>' + inline(para.join(' ')) + '</p>';
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out += '</' + list + '>';
      list = null;
    }
  };
  for (const raw of t.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara();
      closeList();
      const n = m[1].length + 1;
      out += '<h' + n + '>' + inline(m[2]) + '</h' + n + '>';
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out += '<ul>';
        list = 'ul';
      }
      out += '<li>' + inline(m[1]) + '</li>';
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out += '<ol>';
        list = 'ol';
      }
      out += '<li>' + inline(m[1]) + '</li>';
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out;
}

export const isLuaLang = (lang) => !lang || /^(lua|luau)$/i.test(lang);

export function renderMD(text) {
  return text
    .split('```')
    .map((seg, i) => {
      if (i % 2 === 0) return renderText(seg);
      const nl = seg.indexOf('\n');
      const lang = (nl >= 0 ? seg.slice(0, nl) : seg).trim();
      const code = (nl >= 0 ? seg.slice(nl + 1) : '').replace(/\n$/, '');
      const lua = isLuaLang(lang);
      return (
        `<div class="code" data-lang="${lua ? 'lua' : esc(lang.toLowerCase())}">` +
        `<div class="code-head"><span>${esc(lang || 'luau')}</span><button class="copy" type="button">Copy</button></div>` +
        `<pre><code>${lua ? highlightLua(code) : esc(code)}</code></pre></div>`
      );
    })
    .join('');
}

export function extractCode(md) {
  const out = [];
  const re = /```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) out.push({ lang: m[1], code: m[2] });
  return out;
}
