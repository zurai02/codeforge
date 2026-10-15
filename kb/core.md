@@@ luau-overview
title: What Luau is and how it differs from Lua 5.1
tags: luau lua language basics differences goto integer
---
Luau is Roblox's language, derived from Lua 5.1, with gradual typing, a faster VM and a sandbox.
- Arrays and strings are 1-indexed. Inequality is `~=`, concatenation is `..`, and `nil` and `false` are the only falsy values.
- All numbers are 64-bit floats. `//` is floor division and `%` is modulo.
- Luau adds `continue`, compound assignment (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `^=`, `..=`), string interpolation with backticks, if-expressions, type annotations and generalized iteration.
- There is no `goto`, and no `load` or `dofile`. `loadstring` exists in Roblox but is disabled by default.
- Method calls use `:` and pass `self`; `.` does not. Mixing them up is a very common bug.

@@@ new-syntax
title: Modern Luau syntax: continue, interpolation, if-expressions, compound operators
tags: continue string interpolation backtick if expression compound assignment generalized iteration floor division
---
```lua
local name = "Ada"
local score = 10
print(`{name} scored {score * 2} points`)        -- string interpolation

local label = if score > 5 then "high" else "low"  -- if-expression (no `end`)

score += 5                                         -- compound assignment
score //= 2                                        -- floor division

for index, value in { "a", "b", "c" } do           -- generalized iteration, no pairs()/ipairs()
	if value == "b" then
		continue                                   -- skip to next iteration
	end
	print(index, value)
end
```
Iterating a dictionary also works with `for key, value in dict do`. The order of dictionary keys is not guaranteed.

@@@ type-annotations
title: Type annotations, optionals, unions and function types
tags: type annotation optional union intersection function type alias export strict
---
```lua
--!strict
local count: number = 0
local name: string? = nil                     -- optional: string or nil
local id: string | number = 5                 -- union

type Point = { x: number, y: number }         -- record
type Names = { string }                       -- array of strings
type Scores = { [string]: number }            -- dictionary
type Callback = (number, string?) -> boolean  -- function type
type Direction = "Up" | "Down"                -- singleton (literal) union

export type Item = { id: number, name: string } -- visible to code that requires this module

local function distance(a: Point, b: Point): number
	return math.sqrt((a.x - b.x) ^ 2 + (a.y - b.y) ^ 2)
end

local function sum(...: number): number        -- variadic
	local total = 0
	for _, n in { ... } do total += n end
	return total
end
```
Use `typeof(x)` in a type position to reuse the type of a value. Use `x :: T` to cast when you know more than the checker.

@@@ strict-mode
title: --!strict, --!nonstrict and --!nocheck
tags: strict nonstrict nocheck type checking script analysis directive
---
Put one of these on the first line of a script:
- `--!strict` turns on full type checking. Use it for new code.
- `--!nonstrict` is the default. Unannotated variables are `any`.
- `--!nocheck` turns the type checker off for that script.

Strict mode catches typos in property names, nil access, wrong argument types and missing returns before the game runs. Annotate function parameters and return types; locals are usually inferred.

@@@ generics-and-typeof
title: Generic functions and types
tags: generic generics type parameter T typeof cast map filter
---
```lua
--!strict
local function map<T, U>(list: { T }, fn: (T) -> U): { U }
	local out: { U } = {}
	for i, v in list do
		out[i] = fn(v)
	end
	return out
end

local lengths = map({ "a", "bb", "ccc" }, function(s: string): number
	return #s
end)

type Pair<A, B> = { first: A, second: B }
local p: Pair<string, number> = { first = "hp", second = 100 }

local function identity<T>(x: T): T
	return x
end
```

@@@ type-refinement
title: Type refinement and narrowing (nil checks, type(), typeof, assert)
tags: refinement narrowing nil check type typeof assert unknown any optional
---
The checker narrows types after tests:
```lua
--!strict
local function describe(value: string | number | nil): string
	if value == nil then
		return "nothing"
	end
	if type(value) == "string" then
		return value:upper()          -- value is a string here
	end
	return tostring(value + 1)        -- value is a number here
end

local function firstChild(parent: Instance): Instance
	local child = parent:FindFirstChildWhichIsA("BasePart")
	assert(child, "no BasePart found")   -- narrows `Instance?` to `Instance`
	return child
end
```
`type()` returns Lua type names ("string", "number", "table"...). `typeof()` also knows Roblox types ("Instance", "Vector3", "CFrame", "RBXScriptConnection"). Use `unknown` for values you have not validated yet, for example remote event arguments.

@@@ tables-library
title: The table library: create, find, clone, freeze, sort, move
tags: table create find clone freeze sort insert remove concat unpack move clear array dictionary length
---
```lua
local t = table.create(100, 0)             -- 100 zeros, preallocated
table.insert(t, 5)                         -- append
table.insert(t, 1, 99)                     -- insert at position 1
table.remove(t, 1)                         -- remove position 1 (shifts the rest)
print(table.find({ "a", "b" }, "b"))       -- 2 (nil if absent)
local copy = table.clone(t)                -- shallow copy
table.freeze(copy)                         -- read-only; writing now errors
table.clear(t)                             -- empty it, keep the allocation
table.sort(list, function(a, b) return a.score > b.score end)
print(table.concat({ "a", "b", "c" }, ", "))
print(table.unpack({ 1, 2, 3 }))
```
Pitfalls:
- `#t` is only reliable for arrays without holes. For dictionaries it is 0, so count with a loop.
- Removing items while iterating forward skips elements. Iterate backwards or build a new table.
- `table.freeze` is shallow; nested tables stay mutable.

@@@ string-library
title: Strings: format, split, find, match, gsub and patterns
tags: string format split find match gsub gmatch pattern sub upper lower rep trim utf8
---
```lua
local s = "Hello, World"
print(s:sub(1, 5))                       -- "Hello"
print(s:upper(), s:lower(), #s)
print(s:find("World", 1, true))          -- 8 12 (plain find, no pattern)
print(string.format("%s has %d HP (%.1f%%)", "Bob", 80, 80.0))
for _, part in string.split("a,b,c", ",") do print(part) end
local key, value = ("speed=16"):match("^(%w+)=(%d+)$")
local trimmed = ("  hi  "):gsub("^%s+", ""):gsub("%s+$", "")
for word in s:gmatch("%a+") do print(word) end
```
Lua patterns are not regex. Special characters are escaped with `%`, not `\`, and there is no alternation (`|`). `gsub` returns two values (the string and the count), so wrap it in parentheses if you only want the string. `#s` counts bytes; use `utf8.len(s)` for characters.

@@@ metatables-oop
title: Classes with metatables (OOP) in Luau
tags: oop class metatable __index setmetatable constructor method self object new
---
```lua
--!strict
local Account = {}
Account.__index = Account

export type Account = typeof(setmetatable({} :: { balance: number }, Account))

function Account.new(balance: number): Account
	return setmetatable({ balance = balance }, Account)
end

function Account.deposit(self: Account, amount: number)
	self.balance += amount
end

function Account.getBalance(self: Account): number
	return self.balance
end

return Account
```
Use it from another script with `local acc = Account.new(100); acc:deposit(50)`. Call methods with `:` so `self` is passed.
Other metamethods: `__tostring`, `__eq`, `__lt`, `__le`, `__add`, `__sub`, `__mul`, `__div`, `__unm`, `__len`, `__call`, `__concat`, `__newindex`, `__mode`.

@@@ inheritance-oop
title: Inheritance with metatables
tags: inheritance subclass extend super base class oop override
---
```lua
local Animal = {}
Animal.__index = Animal

function Animal.new(name)
	local self = setmetatable({}, Animal)
	self.Name = name
	return self
end

function Animal:Speak()
	print(self.Name .. " makes a sound")
end

local Dog = setmetatable({}, { __index = Animal })   -- Dog falls back to Animal
Dog.__index = Dog

function Dog.new(name)
	local self = Animal.new(name)                    -- run the parent constructor
	return setmetatable(self, Dog)                   -- then switch to the Dog metatable
end

function Dog:Speak()                                  -- override
	print(self.Name .. " barks")
end

Dog.new("Rex"):Speak()   -- Rex barks
```
Prefer composition (a table holding other objects) over deep inheritance chains; it is easier to type-check.

@@@ closures-varargs
title: Closures, varargs and select
tags: closure upvalue vararg varargs select pack unpack function return multiple values
---
```lua
local function counter()
	local n = 0
	return function()
		n += 1                      -- n is an upvalue captured by the closure
		return n
	end
end
local c = counter(); print(c(), c())   -- 1 2

local function log(...)
	local count = select("#", ...)       -- number of args, including nils
	local first = ...
	local all = table.pack(...)          -- { n = count, ... }
	print(count, first, all.n)
end

local a, b = (function() return 1, 2, 3 end)()   -- extra values are dropped
```
Wrap a call in parentheses to keep only its first return value. Use `select("#", ...)` rather than `#{...}` when nils may appear.

@@@ error-handling
title: Error handling: pcall, xpcall, error and assert
tags: pcall xpcall error assert traceback try catch retry exception
---
```lua
local ok, result = pcall(function()
	return riskyCall()
end)
if not ok then
	warn("failed:", result)           -- result is the error message
end

local ok2, trace = xpcall(riskyCall, debug.traceback)   -- keeps the stack trace on failure

error("something broke")              -- raise an error (string)
error({ code = 404 })                 -- error values can be tables
error("bad argument", 2)              -- level 2 blames the caller
assert(typeof(x) == "number", "x must be a number")
```
Retry helper for flaky calls (DataStore, HTTP):
```lua
local function retry(fn: () -> any, attempts: number): (boolean, any)
	local ok = false
	local result: any = nil
	for i = 1, attempts do
		ok, result = pcall(fn)
		if ok then break end
		task.wait(2 ^ i)              -- 2s, 4s, 8s ...
	end
	return ok, result
end
```
`pcall` can yield (for example around `task.wait` or `WaitForChild`). An error inside a thread started with `task.spawn` prints a traceback but does not propagate to the code that spawned it.

@@@ coroutines
title: Coroutines versus the task library
tags: coroutine wrap create resume yield status thread task spawn
---
Prefer the `task` library in Roblox. Raw coroutines are still useful for generators:
```lua
local gen = coroutine.wrap(function()
	for i = 1, 3 do
		coroutine.yield(i)
	end
end)
print(gen(), gen(), gen())   -- 1 2 3
```
- `coroutine.create(fn)` plus `coroutine.resume(co, ...)` runs it manually and returns `true, ...` or `false, err`.
- `coroutine.status(co)` is "suspended", "running", "normal" or "dead". Resuming a dead coroutine returns an error ("cannot resume dead coroutine").
- A coroutine that yields on a Roblox yielding call (`task.wait`, `WaitForChild`) is resumed by the scheduler, so do not `resume` it yourself.
- `task.spawn(co)` accepts a coroutine as well as a function. `task.cancel(thread)` stops one.

@@@ math-random
title: Math and random numbers
tags: math clamp lerp round floor ceil random Random seed noise sign abs huge pi sqrt rad deg
---
```lua
print(math.clamp(15, 0, 10))           -- 10
print(math.lerp(0, 100, 0.25))         -- 25
print(math.round(2.5), math.floor(2.9), math.ceil(2.1), math.sign(-3))
print(math.rad(180), math.deg(math.pi))
print(math.huge, -math.huge)

local rng = Random.new(os.time())      -- seedable generator object
print(rng:NextInteger(1, 6))           -- 1..6 inclusive
print(rng:NextNumber())                -- 0..1
print(rng:NextUnitVector())            -- random direction

print(math.random(1, 10))              -- global generator, fine for casual use
print(math.noise(x * 0.1, y * 0.1))    -- Perlin noise in roughly -1..1
```
Check for NaN with `x ~= x`. Dividing by zero gives `inf` or `nan`, not an error.

@@@ buffer-library
title: The buffer library for compact binary data
tags: buffer binary bytes pack serialize network performance create write read
---
```lua
local b = buffer.create(8)               -- 8 zeroed bytes
buffer.writeu32(b, 0, 12345)             -- unsigned 32-bit at byte offset 0
buffer.writef32(b, 4, 1.5)               -- 32-bit float at offset 4
print(buffer.readu32(b, 0), buffer.readf32(b, 4))
local s = buffer.tostring(b)             -- raw bytes as a string
local b2 = buffer.fromstring(s)
print(buffer.len(b2))
```
Use buffers for compact network messages and large numeric arrays. They are far smaller and faster than tables of numbers. Offsets are in bytes and start at 0, unlike tables.

@@@ native-codegen
title: Native code generation (--!native and @native)
tags: native codegen performance optimize fast numeric loop attribute
---
Luau can compile hot functions to machine code. Add `--!native` as the first line to compile the whole script, or put the `@native` attribute on one function:
```lua
@native
local function dot(ax: number, ay: number, bx: number, by: number): number
	return ax * bx + ay * by
end
```
It helps number-crunching loops (math, vectors, buffers). It does little for code dominated by Roblox API calls. Annotate types so the compiler can specialise, and measure before and after with `os.clock()`.

@@@ performance-tips
title: Performance tips for Luau and Roblox scripts
tags: performance optimize lag fps slow profile microprofiler cache loop instance new parent getchildren
---
- Set `.Parent` last when creating instances. Do not use `Instance.new("Part", parent)`, which parents before properties are set and replicates each change.
- Cache references (`local part = workspace.Part`) instead of calling `FindFirstChild` or `GetService` every frame.
- Avoid `GetChildren()`, `GetDescendants()` and string building inside per-frame loops.
- Build strings with `table.concat` rather than `s ..= x` in big loops.
- Use `table.create(n)` and `table.clear(t)` to avoid reallocations.
- Prefer events (`Changed`, `Touched`, `ChildAdded`, attribute signals) to polling every frame.
- Use `workspace:GetPartBoundsInBox`, `GetPartBoundsInRadius` and `OverlapParams` for area queries instead of looping over every part.
- Profile with `debug.profilebegin("label")` and `debug.profileend()`, then read the MicroProfiler (Ctrl+F6).
- For heavy math, use `@native`, and for CPU-bound work on many objects consider Parallel Luau (Actors and `task.desynchronize()`).

@@@ memory-leaks
title: Memory leaks: disconnecting events, cleaning tables, weak tables
tags: memory leak disconnect connection destroy cleanup weak table mode janitor maid
---
Common causes and fixes:
- Connections to long-lived objects keep their callbacks (and everything those capture) alive. Store the connection and call `:Disconnect()` when finished.
- Calling `:Destroy()` on an Instance disconnects its own events and removes it from the tree. References you keep in tables still hold the object, so set them to `nil` or remove them.
- Per-player tables must be cleared in `Players.PlayerRemoving`.
- Use a weak table when a cache should not keep objects alive:
```lua
local cache = setmetatable({}, { __mode = "k" })   -- weak keys: entries vanish when the key is collected
```
- Tag cleanup in one place with a Janitor or Maid object (see the janitor-class note).
- Use `Instance.Destroying` or `AncestryChanged` to run cleanup when an object goes away.

@@@ deprecated-apis
title: Deprecated Roblox APIs and their modern replacements
tags: deprecated replacement wait spawn delay tick connect unpack getfenv bodyvelocity raycast loadanimation modern update
---
Do not write the old calls in new code. Replacements:
- `wait(n)` becomes `task.wait(n)`
- `spawn(fn)` becomes `task.spawn(fn)` or `task.defer(fn)`
- `delay(t, fn)` becomes `task.delay(t, fn)`
- `tick()` becomes `os.clock()` (timing), `os.time()` (Unix seconds) or `workspace:GetServerTimeNow()`
- `event:connect(fn)` becomes `event:Connect(fn)`
- `workspace:FindPartOnRay(...)` becomes `workspace:Raycast(origin, direction, params)`
- `Enum.RaycastFilterType.Blacklist/Whitelist` becomes `Exclude/Include`
- `BodyVelocity`, `BodyPosition`, `BodyGyro`, `BodyForce` become `LinearVelocity`, `AlignPosition`, `AlignOrientation`, `VectorForce`
- `Humanoid:LoadAnimation` becomes `Animator:LoadAnimation`
- `model:SetPrimaryPartCFrame(cf)` becomes `model:PivotTo(cf)`
- `PhysicsService:SetPartCollisionGroup` becomes `part.CollisionGroup = "Name"`
- `unpack` becomes `table.unpack`; `table.getn(t)` becomes `#t`
- `game.Workspace` becomes `workspace`; `game.Players` becomes `game:GetService("Players")`
- `getfenv`/`setfenv` have no direct replacement; pass values explicitly

@@@ common-errors
title: Common Roblox script errors and what they mean
tags: error nil index attempt infinite yield not valid member compare arithmetic call dead coroutine timeout stack trace output
---
- **attempt to index nil with 'X'**: the variable on the left is nil. Check spelling, use `WaitForChild` for things that load later, and guard with `if obj then`.
- **'X' is not a valid member of 'Y'**: the child or property does not exist (wrong name, not replicated yet, or removed). Use `FindFirstChild` or `WaitForChild("X", 5)`.
- **Infinite yield possible on 'Y:WaitForChild("X")'**: the child never appeared. Wrong name, wrong parent, created only on the server or client, or not streamed in.
- **attempt to call a nil value**: calling something that does not exist, a typo in a method name, or `.` versus `:` confusion.
- **attempt to perform arithmetic (add) on nil and number** or **attempt to compare nil with number**: a variable you expected to hold a number is nil. Print it just before the failing line.
- **Script timeout: exhausted allowed execution time**: a loop with no yield. Add `task.wait()`.
- **cannot resume dead coroutine**: resuming a coroutine that already finished.
- **ServerScriptService.X:12: ...**: the number after the colon is the line. Read the traceback from the top, and click the line in the Output window.
- **HTTP 403 / 429**: forbidden or rate-limited. **DataStore request was added to queue**: you are hitting the request budget.

@@@ tooling
title: Luau tooling: Rojo, Wally, StyLua, Selene, luau-lsp, Lune, Jest
tags: tooling rojo wally stylua selene luau-lsp lune jest testez aftman rokit vscode git external editor package formatter linter
---
- **Rojo** syncs a folder of `.luau` files into Roblox Studio, so you can use Git and VS Code.
- **Wally** is the package manager (`wally.toml`). **Rokit** or **Aftman** install and pin these tools per project.
- **StyLua** formats code. **Selene** lints it.
- **luau-lsp** is the language server for VS Code and other editors: autocomplete and type checking with Roblox types.
- **luau-analyze** (from the Luau project) is the command-line type checker.
- **Lune** runs standalone Luau scripts outside Roblox, which is handy for build scripts and tests.
- **Jest Lua** (successor to TestEZ) runs unit tests in a Roblox place or in Lune.
- **Open Cloud** is Roblox's HTTP API for DataStores, publishing and more from outside the game.
