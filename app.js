/* CodeForge - a coding-only AI chat that runs entirely in the browser.
   It talks directly to the provider you configure; there is no server. */

const $ = (sel) => document.querySelector(sel);

/* ---------- storage ---------- */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage can be unavailable (private mode); the app still works */
    }
  },
};

const DEFAULTS = {
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-sonnet-5-5',
  baseUrl: 'https://api.openai.com/v1',
  maxTokens: 8192,
  mode: 'general',
};

let settings = { ...DEFAULTS, ...store.get('cf.settings', {}) };
let messages = store.get('cf.messages', []);
let controller = null;

/* ---------- the "coding only" brain ---------- */
const SYSTEM = [
  'You are CodeForge, an expert software engineer. You help with programming and software engineering only: writing, debugging, reviewing, refactoring, testing, explaining and designing code, plus tooling, build systems, databases, APIs, DevOps, algorithms and software architecture.',
  '',
  'Scope rule: if a request is not about programming or software engineering, answer in one short sentence that you only handle coding questions and invite a coding question instead. Do not answer the off-topic request.',
  '',
  'How you work:',
  '- Lead with the answer or the code, then explain briefly. No filler or flattery.',
  '- Give complete, runnable code with imports, in fenced blocks tagged with the language. Never use placeholders like "your code here" for parts you can write.',
  '- State assumptions (language version, framework, OS) in a line when they matter. Ask a question only if you are truly blocked, and ask for exactly what is missing.',
  '- Debugging: find the root cause before suggesting a fix. Say which line or construct fails and why, then give the smallest fix and how to verify it.',
  '- Prefer simple, readable solutions that follow the idioms of the language. Mention edge cases, complexity and failure modes that actually matter.',
  '- When you are not sure of an API, version or behavior, say so instead of guessing, and say how to check.',
  '- Security: help with defensive work, secure coding and authorized testing. Do not write malware, exploits for systems the user does not own, or credential-stealing tools.',
].join('\n');

const MODES = {
  general: { label: 'General coding', prompt: '' },
  write: {
    label: 'Write code',
    prompt: 'Mode: write. Produce a complete, runnable implementation with a short usage example. Put assumptions in one or two lines before the code.',
  },
  debug: {
    label: 'Debug',
    prompt: 'Mode: debug. Identify the root cause first. If the error text, language version or a minimal repro is missing and needed, ask for exactly that. Otherwise give the cause, the minimal fix and a way to confirm it worked.',
  },
  review: {
    label: 'Code review',
    prompt: 'Mode: review. Review the code like a senior engineer. List problems ordered by severity (bugs, security, correctness, performance, maintainability), each with the location and a concrete fix. Skip style nitpicks unless they hurt readability. End with the single most valuable change.',
  },
  refactor: {
    label: 'Refactor',
    prompt: 'Mode: refactor. Preserve behavior exactly. Show the refactored code, then list what changed and why in a few bullets. Flag any place where behavior could differ.',
  },
  explain: {
    label: 'Explain code',
    prompt: 'Mode: explain. Explain what the code does in plain language, then walk through the non-obvious parts. Match the depth to what the user seems to know.',
  },
  tests: {
    label: 'Write tests',
    prompt: 'Mode: tests. Write tests with the framework already in use, or the standard one for the language. Cover the normal path, edge cases and failure cases. Name tests by behavior.',
  },
};

const STARTERS = [
  'Write a debounce function in TypeScript with cancel support',
  'Why does my async forEach finish before the awaits do?',
  'Explain Big-O of this nested loop and speed it up',
  'Write pytest tests for a function that parses ISO dates',
];

/* ---------- tiny markdown renderer (escapes everything first) ---------- */
function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
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

function renderMD(text) {
  // Odd-numbered segments are inside ``` fences. An unfinished fence while
  // streaming simply becomes an open code block, which is what we want.
  return text
    .split('```')
    .map((seg, i) => {
      if (i % 2 === 0) return renderText(seg);
      const nl = seg.indexOf('\n');
      const lang = nl >= 0 ? seg.slice(0, nl).trim() : seg.trim();
      const code = nl >= 0 ? seg.slice(nl + 1) : '';
      return (
        '<div class="code"><div class="code-head"><span>' +
        esc(lang || 'code') +
        '</span><button class="copy" type="button">Copy</button></div>' +
        '<pre><code>' +
        esc(code.replace(/\n$/, '')) +
        '</code></pre></div>'
      );
    })
    .join('');
}

/* ---------- UI ---------- */
const box = $('#messages');

function persist() {
  store.set('cf.messages', messages);
}

function setStatus(text) {
  $('#status').textContent = text || '';
}

function setBusy(busy) {
  $('#send').hidden = busy;
  $('#stop').hidden = !busy;
  $('#input').disabled = busy;
  if (!busy) $('#input').focus();
}

function nearBottom() {
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}

function bubble(m, streaming) {
  const el = document.createElement('div');
  el.className = 'msg ' + m.role;
  el.innerHTML =
    '<div class="role">' + (m.role === 'user' ? 'You' : 'CodeForge') + '</div>' +
    '<div class="body' + (streaming ? ' cursor' : '') + '">' + renderMD(m.content) + '</div>';
  return el;
}

function renderAll() {
  box.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<h1>What are we building?</h1><div>Code only. Pick a mode above, then ask.</div><div class="chips"></div>';
    const chips = empty.querySelector('.chips');
    STARTERS.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.addEventListener('click', () => {
        $('#input').value = s;
        autosize();
        $('#input').focus();
      });
      chips.appendChild(b);
    });
    box.appendChild(empty);
    return;
  }
  messages.forEach((m) => box.appendChild(bubble(m, false)));
  box.scrollTop = box.scrollHeight;
}

function updateLast(streaming) {
  const last = box.lastElementChild;
  if (!last) return;
  const stick = nearBottom();
  const body = last.querySelector('.body');
  body.innerHTML = renderMD(messages[messages.length - 1].content);
  body.classList.toggle('cursor', !!streaming);
  if (stick) box.scrollTop = box.scrollHeight;
}

function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 200) + 'px';
}

/* ---------- networking ---------- */
async function streamChat(history, onDelta, signal) {
  const system = [SYSTEM, MODES[settings.mode] ? MODES[settings.mode].prompt : ''].filter(Boolean).join('\n\n');
  const isAnthropic = settings.provider === 'anthropic';
  let res;

  if (isAnthropic) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: Number(settings.maxTokens) || 8192,
        system,
        messages: history,
        stream: true,
      }),
    });
  } else {
    const base = settings.baseUrl.replace(/\/+$/, '');
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + settings.apiKey,
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: Number(settings.maxTokens) || 8192,
        messages: [{ role: 'system', content: system }, ...history],
        stream: true,
      }),
    });
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Request failed (HTTP ' + res.status + '): ' + detail.slice(0, 400));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;

      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }

      if (evt.type === 'error') {
        throw new Error((evt.error && evt.error.message) || 'The stream returned an error.');
      }

      let text = '';
      if (isAnthropic) {
        if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
          text = evt.delta.text;
        }
      } else if (evt.choices && evt.choices[0] && evt.choices[0].delta) {
        text = evt.choices[0].delta.content || '';
      }
      if (text) onDelta(text);
    }
  }
}

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || controller) return;

  if (!settings.apiKey) {
    setStatus('Add your API key in Settings first.');
    openSettings();
    return;
  }

  setStatus('');
  const history = [...messages, { role: 'user', content: text }];
  messages.push({ role: 'user', content: text }, { role: 'assistant', content: '' });
  input.value = '';
  autosize();
  renderAll();
  updateLast(true);
  setBusy(true);

  const reply = messages[messages.length - 1];
  controller = new AbortController();

  try {
    await streamChat(
      history,
      (delta) => {
        reply.content += delta;
        updateLast(true);
      },
      controller.signal
    );
  } catch (err) {
    if (err.name !== 'AbortError') {
      setStatus(err.message || 'Something went wrong.');
    }
    if (!reply.content) {
      // Nothing came back: undo this turn and put the text back for another try.
      messages.pop();
      messages.pop();
      input.value = text;
      autosize();
    }
  } finally {
    controller = null;
    setBusy(false);
    persist();
    renderAll();
  }
}

/* ---------- settings dialog ---------- */
const dlg = $('#settings');

function syncBaseUrlRow() {
  $('#baseUrlRow').style.display = $('#provider').value === 'openai' ? '' : 'none';
}

function openSettings() {
  $('#provider').value = settings.provider;
  $('#apiKey').value = settings.apiKey;
  $('#model').value = settings.model;
  $('#baseUrl').value = settings.baseUrl;
  $('#maxTokens').value = settings.maxTokens;
  syncBaseUrlRow();
  if (!dlg.open) dlg.showModal();
}

$('#provider').addEventListener('change', () => {
  syncBaseUrlRow();
  // Offer a sensible default model when switching provider, unless the user typed their own.
  const m = $('#model');
  if ($('#provider').value === 'openai' && m.value.startsWith('claude')) m.value = 'gpt-4.1';
  if ($('#provider').value === 'anthropic' && !m.value.startsWith('claude')) m.value = DEFAULTS.model;
});

$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  settings = {
    ...settings,
    provider: $('#provider').value,
    apiKey: $('#apiKey').value.trim(),
    model: $('#model').value.trim() || DEFAULTS.model,
    baseUrl: $('#baseUrl').value.trim() || DEFAULTS.baseUrl,
    maxTokens: Number($('#maxTokens').value) || DEFAULTS.maxTokens,
  };
  store.set('cf.settings', settings);
  setStatus('');
  dlg.close();
});

$('#cancelSettings').addEventListener('click', () => dlg.close());
$('#settingsBtn').addEventListener('click', openSettings);

/* ---------- wiring ---------- */
const modeSel = $('#mode');
Object.entries(MODES).forEach(([key, m]) => {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = m.label;
  modeSel.appendChild(o);
});
if (!MODES[settings.mode]) settings.mode = 'general';
modeSel.value = settings.mode;
modeSel.addEventListener('change', () => {
  settings.mode = modeSel.value;
  store.set('cf.settings', settings);
});

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});

$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});

$('#stop').addEventListener('click', () => {
  if (controller) controller.abort();
});

$('#new').addEventListener('click', () => {
  if (controller) controller.abort();
  messages = [];
  persist();
  setStatus('');
  renderAll();
  $('#input').focus();
});

box.addEventListener('click', async (e) => {
  const btn = e.target.closest('button.copy');
  if (!btn) return;
  const code = btn.closest('.code').querySelector('code').textContent;
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => (btn.textContent = 'Copy'), 1400);
});

renderAll();
if (!settings.apiKey) setStatus('');
