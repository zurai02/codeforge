// A small, fast Luau checker that runs in the browser. It is heuristic (not a type checker):
// it catches deprecated APIs, common Roblox mistakes, and obvious structural problems.

/** Blank out comments (view `noComments`) and comments + string contents (view `noStrings`). */
export function strip(code) {
  const a = code.split('');
  const b = code.split('');
  const n = code.length;
  const blank = (arr, from, to) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === '-' && code[i + 1] === '-') {
      const lb = /^--\[(=*)\[/.exec(code.slice(i, i + 40));
      let end;
      if (lb) {
        const close = ']' + lb[1] + ']';
        const j = code.indexOf(close, i + lb[0].length);
        end = j < 0 ? n : j + close.length;
      } else {
        const j = code.indexOf('\n', i);
        end = j < 0 ? n : j;
      }
      blank(a, i, end);
      blank(b, i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        const d = code[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === c) break;
        if (d === '\n' && c !== '`') break;
        j++;
      }
      blank(b, i + 1, Math.min(j, n));
      i = Math.min(j + 1, n);
      continue;
    }
    if (c === '[') {
      const ls = /^\[(=*)\[/.exec(code.slice(i, i + 40));
      if (ls) {
        const close = ']' + ls[1] + ']';
        const j = code.indexOf(close, i + ls[0].length);
        blank(b, i + ls[0].length, j < 0 ? n : j);
        i = j < 0 ? n : j + close.length;
        continue;
      }
    }
    i++;
  }
  return { noComments: a.join(''), noStrings: b.join('') };
}

const lineOf = (text, idx) => {
  let line = 1;
  for (let k = 0; k < idx; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
};

const SERVICES_LAZY =
  'TweenService|UserInputService|DataStoreService|HttpService|CollectionService|Debris|SoundService|MarketplaceService|TextService|PathfindingService|ContextActionService|RunService|PhysicsService|ContentProvider|TeleportService|MessagingService|BadgeService';
const SERVICES_EAGER =
  'Players|ReplicatedStorage|ServerStorage|ServerScriptService|Lighting|StarterGui|StarterPack|StarterPlayer|Teams|ReplicatedFirst';

// Simple pattern rules. `view` picks which scrubbed copy of the source the regex runs on.
const RULES = [
  {
    id: 'deprecated-wait', sev: 'warn', view: 'noStrings', kb: 'task-library',
    re: /(?<![\w.:])wait\s*\(/g,
    msg: '`wait()` is deprecated and throttled. Use `task.wait()`.',
  },
  {
    id: 'deprecated-spawn', sev: 'warn', view: 'noStrings', kb: 'task-library',
    re: /(?<![\w.:])spawn\s*\(/g,
    msg: '`spawn()` is deprecated and delays the call. Use `task.spawn()` (now) or `task.defer()` (end of frame).',
  },
  {
    id: 'deprecated-delay', sev: 'warn', view: 'noStrings', kb: 'task-library',
    re: /(?<![\w.:])delay\s*\(/g,
    msg: '`delay()` is deprecated. Use `task.delay()`.',
  },
  {
    id: 'deprecated-tick', sev: 'warn', view: 'noStrings', kb: 'deprecated-apis',
    re: /(?<![\w.:])tick\s*\(/g,
    msg: '`tick()` is deprecated. Use `os.clock()` for timing, `os.time()` for Unix time, or `workspace:GetServerTimeNow()` for synced time.',
  },
  {
    id: 'lowercase-connect', sev: 'warn', view: 'noStrings', kb: 'deprecated-apis',
    re: /:\s*(connect|disconnect)\s*\(/g,
    msg: 'Lowercase `:connect()` / `:disconnect()` are deprecated. Use `:Connect()` / `:Disconnect()`.',
  },
  {
    id: 'game-workspace', sev: 'info', view: 'noStrings', kb: 'services-getservice',
    re: /\bgame\.Workspace\b/g,
    msg: 'Use the `workspace` global instead of `game.Workspace`.',
  },
  {
    id: 'game-service-lazy', sev: 'warn', view: 'noStrings', kb: 'services-getservice',
    re: new RegExp(`\\bgame\\.(${SERVICES_LAZY})\\b`, 'g'),
    msg: 'Use `game:GetService("...")`. Indexing `game.X` can error if the service has not been created yet.',
  },
  {
    id: 'game-service', sev: 'info', view: 'noStrings', kb: 'services-getservice',
    re: new RegExp(`\\bgame\\.(${SERVICES_EAGER})\\b`, 'g'),
    msg: 'Prefer `game:GetService("...")` (it also survives renamed services).',
  },
  {
    id: 'find-part-on-ray', sev: 'warn', view: 'noStrings', kb: 'raycasting',
    re: /:\s*FindPartOnRay\w*\s*\(/g,
    msg: '`FindPartOnRay*` is deprecated. Use `workspace:Raycast(origin, direction, raycastParams)`.',
  },
  {
    id: 'instance-new-parent', sev: 'warn', view: 'noComments', kb: 'performance-tips',
    re: /Instance\.new\(\s*(["'])[^"']*\1\s*,/g,
    msg: 'Do not pass the parent as the 2nd argument of `Instance.new`. Set every property first and `.Parent` last.',
  },
  {
    id: 'deprecated-bodymover', sev: 'warn', view: 'noComments', kb: 'physics-constraints',
    re: /Instance\.new\(\s*["'](BodyVelocity|BodyPosition|BodyGyro|BodyForce|BodyThrust|BodyAngularVelocity)["']/g,
    msg: 'Body movers are deprecated. Use `LinearVelocity`, `AlignPosition`, `AlignOrientation`, `VectorForce`, `Torque` or `AngularVelocity` with an `Attachment`.',
  },
  {
    id: 'raycast-filter-old', sev: 'warn', view: 'noStrings', kb: 'raycasting',
    re: /Enum\.RaycastFilterType\.(Blacklist|Whitelist)/g,
    msg: '`Blacklist`/`Whitelist` are deprecated. Use `Enum.RaycastFilterType.Exclude` / `Include`.',
  },
  {
    id: 'humanoid-loadanimation', sev: 'warn', view: 'noStrings', kb: 'animation',
    re: /[Hh]umanoid\s*:\s*LoadAnimation\s*\(/g,
    msg: '`Humanoid:LoadAnimation` is deprecated. Load animations on the `Animator` inside the Humanoid.',
  },
  {
    id: 'set-primary-part-cframe', sev: 'info', view: 'noStrings', kb: 'cframe-vector-math',
    re: /:\s*SetPrimaryPartCFrame\s*\(/g,
    msg: '`SetPrimaryPartCFrame` is deprecated. Use `model:PivotTo(cframe)`.',
  },
  {
    id: 'physics-collision-old', sev: 'warn', view: 'noStrings', kb: 'collision-groups',
    re: /:\s*(SetPartCollisionGroup|GetCollisionGroupName|CreateCollisionGroup)\s*\(/g,
    msg: 'The old collision group calls are deprecated. Use `PhysicsService:RegisterCollisionGroup` and set `BasePart.CollisionGroup`.',
  },
  {
    id: 'loadstring', sev: 'warn', view: 'noStrings', kb: 'anti-exploit-server-validation',
    re: /(?<![\w.:])loadstring\s*\(/g,
    msg: '`loadstring` is disabled by default and is a security risk. Avoid running dynamic code.',
  },
  {
    id: 'require-asset-id', sev: 'warn', view: 'noStrings', kb: 'anti-exploit-server-validation',
    re: /(?<![\w.:])require\s*\(\s*\d{5,}\s*\)/g,
    msg: '`require(<assetId>)` runs code you did not review. This is a common backdoor vector. Vendor the module into your place instead.',
  },
  {
    id: 'getfenv', sev: 'warn', view: 'noStrings', kb: 'deprecated-apis',
    re: /(?<![\w.:])(getfenv|setfenv)\s*\(/g,
    msg: '`getfenv`/`setfenv` are deprecated and disable VM optimizations. Pass values explicitly or use a ModuleScript.',
  },
  {
    id: 'global-unpack', sev: 'info', view: 'noStrings', kb: 'deprecated-apis',
    re: /(?<![\w.:])unpack\s*\(/g,
    msg: 'Use `table.unpack` instead of the global `unpack`.',
  },
  {
    id: 'table-getn', sev: 'info', view: 'noStrings', kb: 'deprecated-apis',
    re: /\btable\.(getn|foreach|foreachi)\s*\(/g,
    msg: '`table.getn/foreach/foreachi` are deprecated. Use `#t` and a generic `for` loop.',
  },
  {
    id: 'remote-fire-client-bad', sev: 'info', view: 'noStrings', kb: 'remote-functions',
    re: /:\s*InvokeClient\s*\(/g,
    msg: '`RemoteFunction:InvokeClient` can hang forever or error if the client misbehaves. Prefer `RemoteEvent` for server-to-client calls.',
  },
];

function checkBrackets(text, out) {
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') stack.push([ch, i]);
    else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (!top || top[0] !== pairs[ch]) {
        out.push({
          line: lineOf(text, i), sev: 'error', id: 'brackets', kb: null,
          msg: `Unmatched \`${ch}\`.`,
        });
        return;
      }
    }
  }
  if (stack.length) {
    const [ch, i] = stack[stack.length - 1];
    out.push({ line: lineOf(text, i), sev: 'error', id: 'brackets', kb: null, msg: `\`${ch}\` is never closed.` });
  }
}

function checkInfiniteLoops(text, out) {
  const start = /\bwhile\s+true\s+do\b/g;
  let m;
  while ((m = start.exec(text))) {
    let depth = 1;
    const tok = /\b(function|do|then|repeat|elseif|end|until)\b/g;
    tok.lastIndex = start.lastIndex;
    let t;
    let endIdx = text.length;
    while ((t = tok.exec(text))) {
      const w = t[1];
      if (w === 'function' || w === 'do' || w === 'then' || w === 'repeat') depth++;
      else depth--;
      if (depth === 0) {
        endIdx = t.index;
        break;
      }
    }
    const body = text.slice(start.lastIndex, endIdx);
    const yields = /\b(wait|Wait|WaitForChild|Heartbeat|RenderStepped|Stepped|PreRender|PreSimulation|PostSimulation|yield)\b/.test(body);
    const exits = /\b(break|return)\b/.test(body);
    if (!yields && !exits) {
      out.push({
        line: lineOf(text, m.index), sev: 'error', id: 'no-yield-loop', kb: 'task-library',
        msg: '`while true do` has no yield (`task.wait()`) and no exit. It will freeze the script until Roblox times it out.',
      });
    }
  }
}

function checkDataStoreCalls(text, out) {
  const re = /:\s*(GetAsync|SetAsync|UpdateAsync|IncrementAsync|RemoveAsync|GetSortedAsync|RequestAsync|PostAsync)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const windowText = text.slice(Math.max(0, m.index - 350), m.index);
    // Accept pcall/xpcall directly, or a retry/safe-call helper wrapping the call.
    if (!/\b(x?pcall|\w*[Rr]etry\w*|\w*[Ss]afe\w*)\s*\(/.test(windowText)) {
      out.push({
        line: lineOf(text, m.index), sev: 'warn', id: 'unprotected-async', kb: 'datastore-basics',
        msg: `\`${m[1]}\` can fail (throttling, outages, HTTP errors). Wrap it in \`pcall\` and retry.`,
      });
    }
  }
}

function checkServerEvents(text, out) {
  const re = /OnServerEvent\s*:\s*Connect\s*\(\s*function\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const first = m[1].split(',')[0].split(':')[0].trim();
    if (!first || !/(player|plr|client|user|sender|caller|^p$|^ply$|^plyr$)/i.test(first)) {
      out.push({
        line: lineOf(text, m.index), sev: 'warn', id: 'server-event-args', kb: 'remote-events',
        msg: `The first parameter of \`OnServerEvent\` is always the Player who fired it (yours is \`${first || '(none)'}\`). Client arguments come after it.`,
      });
    }
  }
}

function checkStrict(code, out) {
  const lines = code.split('\n').length;
  if (lines >= 15 && !/^\s*--!(strict|nonstrict|nocheck)/m.test(code)) {
    out.push({
      line: 1, sev: 'info', id: 'no-strict', kb: 'strict-mode',
      msg: 'Add `--!strict` at the top to get full type checking.',
    });
  }
}

export function lintLuau(code) {
  const { noComments, noStrings } = strip(code);
  const views = { noComments, noStrings };
  const out = [];
  for (const r of RULES) {
    const text = views[r.view];
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) {
      out.push({ line: lineOf(text, m.index), sev: r.sev, id: r.id, kb: r.kb, msg: r.msg });
      if (m[0].length === 0) r.re.lastIndex++;
    }
  }
  checkBrackets(noStrings, out);
  checkInfiniteLoops(noStrings, out);
  checkDataStoreCalls(noStrings, out);
  checkServerEvents(noStrings, out);
  checkStrict(code, out);
  const order = { error: 0, warn: 1, info: 2 };
  out.sort((x, y) => order[x.sev] - order[y.sev] || x.line - y.line);
  return out;
}

export function formatFindings(findings, { plain = false } = {}) {
  if (!findings.length) return 'No problems found.';
  return findings
    .map((f) => {
      const tag = f.sev === 'error' ? 'ERROR' : f.sev === 'warn' ? 'WARN' : 'tip';
      return plain ? `- line ${f.line} [${tag}]: ${f.msg}` : `- **${tag}** line ${f.line}: ${f.msg}`;
    })
    .join('\n');
}

export function looksLikeLuau(text) {
  const hits = (text.match(/\b(local|function|end|then|game|workspace|script|task|Instance|Vector3|CFrame)\b/g) || []).length;
  if (hits >= 3 && /\b(end|local)\b/.test(text)) return true;
  // Short snippets: a block closer, a block opener and code punctuation, which plain prose rarely has.
  return /\bend\b/.test(text) && /\b(local|function|then|do)\b/.test(text) && /[=()]/.test(text);
}
