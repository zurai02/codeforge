@@@ datastore-basics
title: DataStore basics: saving and loading player data safely
tags: datastore datastoreservice getasync setasync updateasync save load player data persistence pcall retry bindtoclose playerremoving cache leave
---
```lua
--!strict
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local store = DataStoreService:GetDataStore("PlayerData_v1")
local DEFAULT = { coins = 0, level = 1 }
local cache: { [Player]: { [string]: any } } = {}

local function withRetry(fn: () -> any, tries: number): (boolean, any)
	local ok = false
	local result: any = nil
	for attempt = 1, tries do
		ok, result = pcall(fn)
		if ok then break end
		task.wait(2 ^ attempt)
	end
	return ok, result
end

local function load(player: Player)
	local key = `Player_{player.UserId}`
	local ok, data = withRetry(function()
		return store:GetAsync(key)
	end, 3)
	if not ok then
		player:Kick("Could not load your data. Please rejoin.")   -- never continue with default data, it would overwrite the real save
		return
	end
	cache[player] = data or table.clone(DEFAULT)
end

local function save(player: Player)
	local data = cache[player]
	if not data then return end
	local key = `Player_{player.UserId}`
	local ok, err = withRetry(function()
		return store:UpdateAsync(key, function()
			return data
		end)
	end, 3)
	if not ok then warn("save failed for", player.Name, err) end
end

Players.PlayerAdded:Connect(load)
Players.PlayerRemoving:Connect(function(player)
	save(player)
	cache[player] = nil
end)

game:BindToClose(function()                       -- server shutdown: save everyone before it closes
	local pending = 0
	for _, player in Players:GetPlayers() do
		pending += 1
		task.spawn(function()
			save(player)
			pending -= 1
		end)
	end
	while pending > 0 do task.wait() end
end)
```
Rules: always `pcall`; never overwrite data after a failed load; use `UpdateAsync` for read-modify-write; save on leave, on shutdown and on a timer (every few minutes). Studio needs "Enable Studio Access to API Services" in Game Settings. A value can be at most 4 MB. For production, consider session locking with ProfileStore or ProfileService so two servers cannot write the same player at once.

@@@ anti-exploit-server-validation
title: Anti-exploit: never trust the client, validate remote events on the server
tags: exploit exploiter cheat security validate validation remote cooldown rate limit sanity check server authoritative hack damage teleport nan type check distance backdoor
---
An exploiter can fire any RemoteEvent with any arguments at any speed, so the server must check everything.
```lua
--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local attack = ReplicatedStorage:WaitForChild("Attack") :: RemoteEvent
local lastUse: { [Player]: number } = {}
local COOLDOWN = 0.5
local RANGE = 12

attack.OnServerEvent:Connect(function(player: Player, target: unknown)
	-- 1. type check
	if typeof(target) ~= "Instance" or not target:IsA("Model") then return end
	-- 2. rate limit
	local now = os.clock()
	if now - (lastUse[player] or 0) < COOLDOWN then return end
	lastUse[player] = now
	-- 3. sanity check against server state (position, ownership, alive)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local targetRoot = target:FindFirstChild("HumanoidRootPart")
	if not (root and targetRoot) then return end
	if ((root :: BasePart).Position - (targetRoot :: BasePart).Position).Magnitude > RANGE then return end
	-- 4. the SERVER decides the damage, never the client
	local humanoid = target:FindFirstChildOfClass("Humanoid")
	if humanoid then humanoid:TakeDamage(10) end
end)

Players.PlayerRemoving:Connect(function(player) lastUse[player] = nil end)
```
Checklist:
- Validate argument types with `typeof`, clamp numbers with `math.clamp`, reject NaN (`n ~= n`) and `math.huge`, and limit string lengths.
- Never let the client send damage, prices, currency amounts or "I won" flags. Send intent ("use item 3"), and let the server compute the result.
- Check distance, cooldowns, ownership, alive state and inventory on the server.
- Do not put secrets or trusted logic in `ReplicatedStorage` or any client-visible script.
- Never `require(assetId)` or use `loadstring` on code you did not review. Free models often hide backdoors.
- Keep client checks only for UX. They are not security.

@@@ module-pattern
title: ModuleScript patterns: services and shared utilities
tags: module modulescript require service controller utility shared library return table export cyclic dependency structure architecture
---
A ModuleScript at `ReplicatedStorage/Shared/MathUtil`:
```lua
local MathUtil = {}

function MathUtil.round(n: number, places: number): number
	local m = 10 ^ places
	return math.round(n * m) / m
end

return MathUtil
```
Any other script can then use it:
```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MathUtil = require(ReplicatedStorage.Shared.MathUtil)
print(MathUtil.round(3.14159, 2))   -- 3.14
```
- A module runs once and its returned value is cached, so every `require` gets the same table. That is how you share state.
- Avoid circular requires (A requires B requires A). Move shared pieces to a third module or pass dependencies in `init(deps)`.
- A common layout: `ServerScriptService/Services/*` (one module per feature), a single `Server` Script that requires them and calls `Start()`, and the same for the client in `StarterPlayerScripts`.
- Put types in a shared module with `export type`.

@@@ signal-class
title: A custom Signal (event) class
tags: signal event custom bindable connect fire disconnect observer pubsub publish subscribe once wait
---
```lua
local Signal = {}
Signal.__index = Signal

function Signal.new()
	return setmetatable({ _handlers = {} }, Signal)
end

function Signal:Connect(fn)
	local handler = { fn = fn }
	table.insert(self._handlers, handler)
	return {
		Disconnect = function()
			local i = table.find(self._handlers, handler)
			if i then table.remove(self._handlers, i) end
		end,
	}
end

function Signal:Fire(...)
	for _, h in table.clone(self._handlers) do   -- clone: handlers may disconnect while firing
		task.spawn(h.fn, ...)
	end
end

return Signal
```
Unlike `BindableEvent`, this passes tables by reference (BindableEvents copy tables). Use `BindableEvent` for simple cases, and a Signal module when you need to pass objects or avoid cloning costs.

@@@ janitor-class
title: Janitor / Maid: cleaning up connections and instances in one call
tags: janitor maid trove cleanup connections destroy memory leak disconnect lifecycle dispose
---
```lua
local Janitor = {}
Janitor.__index = Janitor

function Janitor.new()
	return setmetatable({ _tasks = {} }, Janitor)
end

function Janitor:Add(item)
	table.insert(self._tasks, item)
	return item
end

function Janitor:Cleanup()
	for _, item in self._tasks do
		local kind = typeof(item)
		if kind == "RBXScriptConnection" then
			item:Disconnect()
		elseif kind == "Instance" then
			item:Destroy()
		elseif kind == "function" then
			item()
		elseif kind == "thread" then
			task.cancel(item)
		end
	end
	table.clear(self._tasks)
end

return Janitor
```
Use one Janitor per object or per round: `janitor:Add(part.Touched:Connect(...))`, then `janitor:Cleanup()` when it ends.

@@@ cooldown-debounce
title: Cooldowns and debounces
tags: cooldown debounce rate limit spam click tool ability timer lastuse os clock
---
```lua
local COOLDOWN = 2
local lastUsed: { [Player]: number } = {}

local function tryUse(player: Player): boolean
	local now = os.clock()
	if now - (lastUsed[player] or -math.huge) < COOLDOWN then
		return false
	end
	lastUsed[player] = now
	return true
end
```
Timestamps are better than `task.wait` flags because they cannot get stuck if the thread errors. Clear `lastUsed[player]` in `PlayerRemoving`. For a simple boolean debounce, reset it in a `task.delay`, not with a bare `wait`.

@@@ object-pooling
title: Object pooling for projectiles and effects
tags: pool pooling reuse clone projectile bullet effect performance gc recycle spawn many objects
---
```lua
local Pool = {}
Pool.__index = Pool

function Pool.new(template: Instance, size: number)
	local self = setmetatable({ _template = template, _free = {} }, Pool)
	for _ = 1, size do
		table.insert(self._free, template:Clone())
	end
	return self
end

function Pool:Get(): Instance
	return table.remove(self._free) or self._template:Clone()
end

function Pool:Release(obj: Instance)
	obj.Parent = nil
	table.insert(self._free, obj)
end

return Pool
```
Reusing objects avoids the cost of cloning and garbage-collecting hundreds of parts per second. Reset properties (position, velocity, transparency) when you `Get`.

@@@ round-loop
title: A simple round-based game loop
tags: round game loop intermission lobby match state machine timer countdown status winner minigame
---
```lua
--!strict
local Players = game:GetService("Players")

local INTERMISSION = 15
local ROUND_TIME = 120
local MIN_PLAYERS = 2

local state = "Waiting"

local function setState(newState: string)
	state = newState
	workspace:SetAttribute("State", newState)       -- clients read this to update the UI
end

while true do
	if #Players:GetPlayers() < MIN_PLAYERS then
		setState("Waiting")
		task.wait(1)
		continue
	end

	setState("Intermission")
	for t = INTERMISSION, 1, -1 do
		workspace:SetAttribute("Timer", t)
		task.wait(1)
	end

	setState("InRound")
	for t = ROUND_TIME, 1, -1 do
		workspace:SetAttribute("Timer", t)
		-- end early when a win condition is met
		task.wait(1)
	end

	setState("Ending")
	task.wait(5)
end
```
Keep state in one place on the server and broadcast it with attributes or a RemoteEvent. Clean up map objects and per-round connections at the end of each round (see janitor-class).
