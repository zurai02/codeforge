// LuauForge: a free, Luau-specialised coding assistant that runs entirely in the browser.
//
//  - Docs mode (instant, works everywhere): retrieves from the Luau knowledge base, runs the
//    built-in checker on pasted code, and replays answers you taught it.
//  - AI mode (optional, free): an open-weights coding model running on your GPU via WebGPU,
//    grounded by the same knowledge base and lessons, with an automatic self-check loop.

import { renderMD, esc, extractCode, isLuaLang } from './md.js';
import { lintLuau, formatFindings, looksLikeLuau } from './lint.js';
import { loadKB, Index } from './kb.js';
import * as memory from './memory.js';
import { Brain, MODELS, probeGPU } from './llm.js';

const $ = (s) => document.querySelector(s);

const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable: the app still works for this session */
    }
  },
};

/* ------------------------------------------------------------------ prompts */

const SYSTEM = [
  'You are LuauForge, an expert Roblox and Luau programmer. You only help with Luau, Roblox Studio and the Roblox engine API. If asked about anything else, reply in one sentence that you only do Luau and Roblox, and ask for a Luau question.',
  '',
  'Rules for every answer:',
  '1. Write modern Luau, not Lua 5.1: type annotations (--!strict when useful), continue, string interpolation with backticks, +=, if-expressions, generalized iteration (for k, v in t do).',
  '2. Never use deprecated APIs. Use task.wait/task.spawn/task.delay/task.defer instead of wait/spawn/delay; os.clock() instead of tick(); workspace:Raycast instead of FindPartOnRay; LinearVelocity/AlignPosition instead of BodyVelocity/BodyPosition; Animator:LoadAnimation; :Connect with a capital C; game:GetService("X").',
  '3. Never trust the client. Validate every RemoteEvent/RemoteFunction argument on the server (type, range, cooldown, distance). The first argument of OnServerEvent is always the Player.',
  '4. Wrap DataStore and HTTP calls in pcall with retries. Save on PlayerRemoving and game:BindToClose.',
  '5. Say whether code belongs in a Script, LocalScript or ModuleScript, and where to put it.',
  '6. Disconnect connections and destroy instances you no longer need.',
  '7. Give complete, runnable code in ```lua blocks, then 2 to 5 short lines of explanation. If you are unsure an API exists, say so instead of inventing one.',
  'Reference notes below are accurate. Prefer them over your own memory.',
].join('\n');

const MODE_PROMPTS = {
  ask: '',
  write: 'Mode: write. Output one complete script, and state its container (Script, LocalScript or ModuleScript) and parent.',
  debug: 'Mode: debug. Find the root cause first (nil access, yielding, replication, run order, wrong container). Then give the smallest fix and how to confirm it worked.',
  review: 'Mode: review. List problems by severity: exploits (unvalidated remotes), memory leaks, deprecated APIs, performance, race conditions. Give a concrete fix for each.',
  explain: 'Mode: explain. Explain what the code does in plain language, then the non-obvious parts. Match the depth to the user.',
  convert: 'Mode: convert. Convert legacy Roblox Lua to modern Luau without changing behavior: task library, :Connect, Raycast, typed signatures. List what changed.',
  optimize: 'Mode: optimize. Find the real hot spots (per-frame searches, allocations, polling). Show the faster version and explain the gain. Do not change behavior.',
  types: 'Mode: types. Add --!strict and complete type annotations, export useful types, and fix any resulting type errors.',
};

const MODE_LABELS = {
  ask: 'Ask anything',
  write: 'Write a script',
  debug: 'Debug',
  review: 'Review',
  explain: 'Explain code',
  convert: 'Convert to modern Luau',
  optimize: 'Optimize',
  types: 'Add types',
};

const STARTERS = [
  'How do I save player data safely with DataStores?',
  'Why does wait() show as deprecated?',
  'Make a part that tweens up and down forever',
  'How do I stop exploiters abusing my RemoteEvent?',
];

const NO_MATCH =
  "I don't have a note on that yet. Load the AI model (button at the top) for open-ended questions, or teach me: use **Brain** to save a question and the answer, and I'll use it next time.";

/* ------------------------------------------------------------------ state */

const DEFAULTS = {
  modelKey: 'Qwen2.5-Coder-1.5B-Instruct',
  customId: '',
  customModel: '',
  customLib: '',
  temperature: 0.2,
  maxTokens: 1024,
  selfCheck: true,
  autoLoad: true,
  mode: 'ask',
};

const state = {
  settings: { ...DEFAULTS, ...LS.get('luauforge.settings', {}) },
  messages: LS.get('luauforge.chat', []),
  brain: new Brain(),
  gpu: { ok: false, f16: false, reason: 'Checking your GPU...' },
  kb: [],
  kbIndex: new Index([]),
  memIndex: new Index([]),
  busy: false,
  streaming: false,
  abort: null,
};

const saveSettings = () => LS.set('luauforge.settings', state.settings);
const saveChat = () => LS.set('luauforge.chat', state.messages.slice(-60));
const rebuildMemIndex = () => {
  state.memIndex = new Index(memory.docs());
};

/* ------------------------------------------------------------------ rendering */

const box = $('#messages');
let rafPending = false;

function setStatus(text) {
  $('#status').textContent = text || '';
}

function setPill(text, kind) {
  const pill = $('#pill');
  pill.textContent = text;
  pill.className = 'pill ' + kind;
}

function msgHTML(m, i) {
  if (m.role === 'user') {
    return `<div class="msg user"><div class="role">You</div><div class="body">${renderMD(m.content)}</div></div>`;
  }
  const label = m.via === 'docs' ? 'LuauForge · docs mode' : m.revised ? 'LuauForge · revised after self-check' : 'LuauForge';
  const streamingThis = state.streaming && i === state.messages.length - 1;
  let body = renderMD(m.content || '');
  if (m.superseded) {
    return (
      `<details class="msg draft"><summary>First draft, replaced after the self-check found problems</summary>` +
      `<div class="body">${body}</div></details>`
    );
  }
  let notes = '';
  if (m.notes) notes = `<div class="selfcheck"><strong>Self-check fixed:</strong>${renderMD(m.notes)}</div>`;
  let cut = '';
  if (m.cut && !streamingThis) cut = `<div class="cut">The answer hit the length limit. <button type="button" data-act="continue">Continue</button></div>`;
  let actions = '';
  if (!streamingThis && m.content) {
    actions =
      `<div class="actions">` +
      `<button type="button" data-act="good" title="Save this answer so I reuse it for similar questions">Good answer</button>` +
      `<button type="button" data-act="fix" title="Edit the answer and teach me the correct version">Correct it</button>` +
      `<button type="button" data-act="retry">Retry</button></div>`;
  }
  return (
    `<div class="msg assistant" data-i="${i}"><div class="role">${esc(label)}</div>` +
    notes +
    `<div class="body${streamingThis ? ' cursor' : ''}">${body}</div>${cut}${actions}</div>`
  );
}

function decorate() {
  // Attach checker results under every Luau block of finished assistant messages.
  box.querySelectorAll('.msg.assistant').forEach((el) => {
    el.querySelectorAll('.code[data-lang="lua"]').forEach((blockEl) => {
      if (blockEl.querySelector('.lint')) return;
      const code = blockEl.querySelector('code').textContent;
      if (code.split('\n').length < 2) return;
      const f = lintLuau(code);
      const issues = f.filter((x) => x.sev !== 'info');
      const div = document.createElement('div');
      div.className = 'lint ' + (issues.length ? 'bad' : 'ok');
      if (!f.length) div.textContent = 'Checker: no problems found';
      else {
        div.innerHTML =
          `<strong>Checker: ${issues.length} problem${issues.length === 1 ? '' : 's'}` +
          `${f.length > issues.length ? `, ${f.length - issues.length} tip(s)` : ''}</strong>` +
          renderMD(formatFindings(f));
      }
      blockEl.appendChild(div);
    });
  });
}

function renderAll() {
  if (!state.messages.length) {
    box.innerHTML =
      `<div class="empty"><h1>Luau, all the way down</h1>` +
      `<p>Free. No account, no API key. Ask about Roblox scripting, or paste a script to check it.</p>` +
      `<div class="chips">${STARTERS.map((s) => `<button type="button" data-starter="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    return;
  }
  box.innerHTML = state.messages.map(msgHTML).join('');
  if (!state.streaming) decorate();
}

function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    renderAll();
    if (stick) box.scrollTop = box.scrollHeight;
  });
}

function setBusy(busy) {
  state.busy = busy;
  $('#send').hidden = busy;
  $('#stop').hidden = !busy || !state.abort;
  $('#input').disabled = busy;
  if (!busy) $('#input').focus();
}

/* ------------------------------------------------------------------ prompt building */

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n...(trimmed)' : s);

function buildMessages(question) {
  const mode = MODE_PROMPTS[state.settings.mode] || '';
  const prose = question.replace(/```[\s\S]*?```/g, ' ');
  const refs = state.kbIndex.search(prose || question, 3).filter((h) => h.ratio >= 0.34);
  let refText = '';
  for (const h of refs) {
    const chunk = `### ${h.doc.title}\n${h.doc.text}\n`;
    if (!refText) refText = clip(chunk, 2000);
    else if ((refText + chunk).length <= 2000) refText += chunk;
  }
  const taught = state.memIndex.search(prose || question, 1).filter((h) => h.ratio >= 0.5);
  let system = SYSTEM;
  if (mode) system += '\n\n' + mode;
  if (refText) system += '\n\nReference notes:\n' + refText;
  if (taught.length) {
    system += `\n\nAn answer the user verified for a similar question:\nQ: ${taught[0].doc.title}\nA: ${clip(taught[0].doc.text, 1200)}`;
  }

  const prior = state.messages.filter((m) => !m.superseded && m.content);
  const hist = [];
  let used = 0;
  for (let i = prior.length - 1; i >= 0 && used < 2800; i--) {
    const c = clip(prior[i].content, prior[i].role === 'assistant' ? 1200 : 1500);
    used += c.length;
    hist.unshift({ role: prior[i].role, content: c });
  }
  while (hist.length && hist[0].role !== 'user') hist.shift();
  return [{ role: 'system', content: system }, ...hist, { role: 'user', content: clip(question, 3500) }];
}

/* ------------------------------------------------------------------ docs mode */

function docsAnswer(text) {
  const out = [];
  const fenced = extractCode(text).map((b) => b.code);
  const blocks = fenced.length ? fenced : looksLikeLuau(text) ? [text] : [];
  const ruleKb = new Set();

  if (blocks.length) {
    const findings = blocks.flatMap((c) => lintLuau(c));
    if (findings.length) {
      out.push('### Checker results\n' + formatFindings(findings));
      findings.forEach((f) => f.kb && ruleKb.add(f.kb));
    } else {
      out.push('### Checker results\nNo problems found by the built-in checks. These are heuristic rules, not a full type-check, so still test in Studio.');
    }
  }

  const prose = text.replace(/```[\s\S]*?```/g, ' ').trim();
  const query = prose || '';
  const mem = query ? state.memIndex.search(query, 1).filter((h) => h.ratio >= 0.5) : [];
  if (mem.length) out.push(`### ${mem[0].doc.title}\n_You taught me this answer._\n\n${mem[0].doc.text}`);

  const hits = query ? state.kbIndex.search(query, 3).filter((h) => h.ratio >= 0.34 && h.score >= 1.5) : [];
  const byId = new Map(state.kb.map((e) => [e.id, e]));
  for (const id of ruleKb) {
    const e = byId.get(id);
    if (e && !hits.some((h) => h.doc.id === id)) hits.push({ doc: e });
  }
  hits.slice(0, 3).forEach((h) => out.push(`### ${h.doc.title}\n\n${h.doc.text}`));

  if (!out.length) return NO_MATCH;
  return out.join('\n\n');
}

/* ------------------------------------------------------------------ AI mode */

async function streamInto(reply, messages) {
  state.abort = new AbortController();
  $('#stop').hidden = false;
  state.streaming = true;
  try {
    for await (const d of state.brain.stream(messages, {
      temperature: Number(state.settings.temperature) || 0.2,
      maxTokens: Number(state.settings.maxTokens) || 1024,
      signal: state.abort.signal,
    })) {
      reply.content += d;
      scheduleRender();
    }
    reply.cut = state.brain.lastFinish === 'length';
  } finally {
    state.streaming = false;
    state.abort = null;
  }
}

async function selfCheck(question, reply) {
  if (!state.settings.selfCheck) return;
  const findings = extractCode(reply.content)
    .filter((b) => isLuaLang(b.lang))
    .flatMap((b) => lintLuau(b.code))
    .filter((f) => f.sev !== 'info');
  if (!findings.length) return;

  reply.superseded = true;
  const fix = { role: 'assistant', content: '', via: 'ai', revised: true, notes: formatFindings(findings) };
  state.messages.push(fix);
  scheduleRender();

  const lean = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: clip(question, 1500) },
    { role: 'assistant', content: clip(reply.content, 2500) },
    {
      role: 'user',
      content:
        'An automatic Luau checker found these problems in your code:\n' +
        formatFindings(findings, { plain: true }) +
        '\nRewrite the full corrected code. Do not use deprecated APIs. Keep the explanation to two lines.',
    },
  ];
  await streamInto(fix, lean);
}

async function ask(text, { addUser = true } = {}) {
  setStatus('');
  const useAI = state.brain.ready;
  const messages = useAI ? buildMessages(text) : null;
  if (addUser) state.messages.push({ role: 'user', content: text });
  const reply = { role: 'assistant', content: '', via: useAI ? 'ai' : 'docs' };
  state.messages.push(reply);
  setBusy(true);
  scheduleRender();

  try {
    if (useAI) {
      await streamInto(reply, messages);
      await selfCheck(text, reply);
    } else {
      reply.content = docsAnswer(text);
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') setStatus('Something went wrong: ' + (e.message || e));
    if (!reply.content) {
      const i = state.messages.indexOf(reply);
      if (i >= 0) state.messages.splice(i, 1);
    }
  } finally {
    state.streaming = false;
    setBusy(false);
    saveChat();
    renderAll();
    box.scrollTop = box.scrollHeight;
  }
}

/* ------------------------------------------------------------------ model loading */

async function loadModel() {
  const b = state.brain;
  if (b.loading || b.ready) return;
  if (!state.gpu.ok) {
    setStatus(state.gpu.reason);
    return;
  }
  const s = state.settings;
  $('#progress').hidden = false;
  $('#loadBtn').disabled = true;
  setPill('Loading model... 0%', 'busy');
  try {
    await b.load({
      modelKey: s.modelKey,
      f16: state.gpu.f16,
      custom: s.customId && s.customModel && s.customLib ? { id: s.customId, model: s.customModel, lib: s.customLib } : null,
      onProgress: (p, t) => {
        $('#bar').style.width = Math.round(p * 100) + '%';
        setPill(`Loading model... ${Math.round(p * 100)}%`, 'busy');
        $('#progressText').textContent = t;
      },
    });
    LS.set('luauforge.loadedOnce', true);
    setPill('AI ready: ' + b.label, 'ok');
    $('#loadBtn').textContent = 'AI loaded';
  } catch (e) {
    setPill('Docs mode', 'idle');
    $('#loadBtn').disabled = false;
    setStatus('Could not load the AI model: ' + (e && e.message ? e.message : e) + '\nDocs mode still works.');
  } finally {
    $('#progress').hidden = true;
  }
}

/* ------------------------------------------------------------------ dialogs */

function fillSettings() {
  const s = state.settings;
  const sel = $('#modelKey');
  sel.innerHTML = MODELS.map((m) => `<option value="${m.key}">${esc(m.label)}</option>`).join('');
  sel.value = s.modelKey;
  $('#customId').value = s.customId;
  $('#customModel').value = s.customModel;
  $('#customLib').value = s.customLib;
  $('#temperature').value = s.temperature;
  $('#maxTokens').value = s.maxTokens;
  $('#selfCheck').checked = !!s.selfCheck;
  $('#autoLoad').checked = !!s.autoLoad;
  $('#gpuInfo').textContent = state.gpu.ok
    ? `WebGPU is available${state.gpu.f16 ? ' (fast 16-bit mode)' : ' (compatibility 32-bit mode)'}.`
    : state.gpu.reason;
}

function refreshBrain() {
  const items = memory.list();
  $('#memCount').textContent =
    `${items.length} lesson${items.length === 1 ? '' : 's'} saved in this browser · ${state.kb.length} knowledge entries loaded`;
  $('#memList').innerHTML = items.length
    ? items
        .map(
          (x) =>
            `<li><div><strong>${esc(x.q)}</strong><div class="muted">${esc(x.a.slice(0, 120))}${x.a.length > 120 ? '...' : ''}</div></div>` +
            `<button type="button" data-del="${esc(x.id)}">Delete</button></li>`
        )
        .join('')
    : '<li class="muted">Nothing yet. Use "Good answer" or "Correct it" under a reply, or add a lesson above.</li>';
}

function openBrain(q = '', a = '') {
  $('#teachQ').value = q;
  $('#teachA').value = a;
  refreshBrain();
  const dlg = $('#brainDlg');
  if (!dlg.open) dlg.showModal();
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ wiring */

function precedingQuestion(i) {
  for (let k = i - 1; k >= 0; k--) if (state.messages[k].role === 'user') return state.messages[k].content;
  return '';
}

function wire() {
  const input = $('#input');
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  };

  const modeSel = $('#mode');
  modeSel.innerHTML = Object.entries(MODE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  if (!MODE_LABELS[state.settings.mode]) state.settings.mode = 'ask';
  modeSel.value = state.settings.mode;
  modeSel.addEventListener('change', () => {
    state.settings.mode = modeSel.value;
    saveSettings();
  });

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || state.busy) return;
    input.value = '';
    autosize();
    ask(text);
  });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });

  $('#stop').addEventListener('click', () => state.abort && state.abort.abort());
  $('#newBtn').addEventListener('click', () => {
    if (state.abort) state.abort.abort();
    state.messages = [];
    saveChat();
    renderAll();
    setStatus('');
  });
  $('#loadBtn').addEventListener('click', loadModel);

  box.addEventListener('click', async (e) => {
    const starter = e.target.closest('[data-starter]');
    if (starter) {
      input.value = starter.dataset.starter;
      autosize();
      input.focus();
      return;
    }
    const copy = e.target.closest('button.copy');
    if (copy) {
      const code = copy.closest('.code').querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Select and copy';
      }
      setTimeout(() => (copy.textContent = 'Copy'), 1400);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || state.busy) return;
    const msgEl = btn.closest('.msg.assistant');
    const i = msgEl ? Number(msgEl.dataset.i) : state.messages.length - 1;
    const m = state.messages[i];
    const q = precedingQuestion(i);
    if (btn.dataset.act === 'good' && m && q) {
      memory.add(q, m.content, 'liked');
      rebuildMemIndex();
      btn.textContent = 'Saved';
      btn.disabled = true;
    } else if (btn.dataset.act === 'fix' && m) {
      openBrain(q, m.content);
    } else if (btn.dataset.act === 'retry' && q) {
      // drop everything after the question and ask again
      const qi = state.messages.map((x) => x.role).lastIndexOf('user');
      state.messages.length = qi;
      ask(q);
    } else if (btn.dataset.act === 'continue') {
      ask('Continue exactly where you stopped.');
    }
  });

  /* settings */
  $('#settingsBtn').addEventListener('click', () => {
    fillSettings();
    $('#settingsDlg').showModal();
  });
  $('#cancelSettings').addEventListener('click', () => $('#settingsDlg').close());
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(state.settings, {
      modelKey: $('#modelKey').value,
      customId: $('#customId').value.trim(),
      customModel: $('#customModel').value.trim(),
      customLib: $('#customLib').value.trim(),
      temperature: Math.min(1, Math.max(0, Number($('#temperature').value) || 0.2)),
      maxTokens: Math.min(2048, Math.max(256, Number($('#maxTokens').value) || 1024)),
      selfCheck: $('#selfCheck').checked,
      autoLoad: $('#autoLoad').checked,
    });
    saveSettings();
    $('#settingsDlg').close();
    if (state.brain.ready) setStatus('Model changes apply after you reload the page.');
  });

  /* brain / lessons */
  $('#brainBtn').addEventListener('click', () => openBrain());
  $('#closeBrain').addEventListener('click', () => $('#brainDlg').close());
  $('#teachSave').addEventListener('click', () => {
    if (memory.add($('#teachQ').value, $('#teachA').value, 'taught')) {
      rebuildMemIndex();
      $('#teachQ').value = '';
      $('#teachA').value = '';
      refreshBrain();
    }
  });
  $('#memList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    memory.remove(del.dataset.del);
    rebuildMemIndex();
    refreshBrain();
  });
  $('#exportMem').addEventListener('click', () => download('luauforge-lessons.md', memory.exportText()));
  $('#importMem').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const n = memory.importText(await file.text());
    rebuildMemIndex();
    refreshBrain();
    setStatus(`Imported ${n} lesson${n === 1 ? '' : 's'}.`);
    e.target.value = '';
  });
  $('#clearMem').addEventListener('click', () => {
    if (confirm('Delete every lesson saved in this browser?')) {
      memory.clear();
      rebuildMemIndex();
      refreshBrain();
    }
  });

  /* checker */
  $('#checkBtn').addEventListener('click', () => $('#checkDlg').showModal());
  $('#closeCheck').addEventListener('click', () => $('#checkDlg').close());
  $('#runCheck').addEventListener('click', () => {
    const code = $('#checkCode').value;
    const out = $('#checkOut');
    if (!code.trim()) {
      out.innerHTML = '<p class="muted">Paste a script first.</p>';
      return;
    }
    out.innerHTML = renderMD(formatFindings(lintLuau(code)));
  });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  wire();
  renderAll();
  box.scrollTop = box.scrollHeight;
  rebuildMemIndex();
  setPill('Docs mode', 'idle');

  const [kb, gpu] = await Promise.all([loadKB('./').catch(() => []), probeGPU()]);
  state.kb = kb;
  state.kbIndex = new Index(kb);
  state.gpu = gpu;

  if (!kb.length) {
    setStatus('Could not load the knowledge base. Open the site through a web server (GitHub Pages or `python3 -m http.server`), not from a file.');
  }
  if (!gpu.ok) {
    $('#loadBtn').disabled = true;
    $('#loadBtn').title = gpu.reason;
    setPill('Docs mode (no WebGPU)', 'idle');
  } else if (state.settings.autoLoad && LS.get('luauforge.loadedOnce', false)) {
    loadModel();
  }
}

boot();
