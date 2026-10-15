@@@ task-library
title: The task library: task.wait, task.spawn, task.defer, task.delay, task.cancel
tags: task wait spawn defer delay cancel yield thread schedule sleep pause timer deprecated freeze infinite loop
---
Use `task.*` instead of the deprecated `wait`, `spawn` and `delay`.
```lua
local elapsed = task.wait(1)               -- yields about 1 second, returns the real time waited
task.wait()                                -- yields one frame

task.spawn(function() print("runs now") end)   -- starts immediately in a new thread
task.defer(function() print("later") end)      -- runs at the end of the current resumption cycle
local handle = task.delay(2, function() print("after 2s") end)
task.cancel(handle)                            -- stop a delayed or spawned thread

while true do
	-- do work
	task.wait(0.5)                         -- always yield inside an endless loop
end
```
A loop without a yield freezes the script and ends with "Script timeout". `while task.wait(1) do ... end` is a common compact form. Extra arguments to `task.spawn(fn, ...)` and `task.delay(t, fn, ...)` are passed to the function.

@@@ script-types-and-locations
title: Script, LocalScript and ModuleScript: where code runs and where to put it
tags: script localscript modulescript server client location serverscriptservice replicatedstorage starterplayerscripts startergui runcontext require
---
- **Script** runs on the server. Put it in `ServerScriptService` (or `Workspace`). Server code and secrets stay here.
- **LocalScript** runs on one player's client. It only runs inside the player's `PlayerGui`, `Backpack`, character, `PlayerScripts` or `ReplicatedFirst`. Put client code in `StarterPlayer > StarterPlayerScripts`, `StarterGui` or `StarterCharacterScripts`.
- A **Script** with `RunContext = Client` runs on the client from places like `ReplicatedStorage`.
- **ModuleScript** runs only when `require`d, returns exactly one value, and runs once per side (the server and each client have their own copy).
- `ServerStorage` and `ServerScriptService` are never sent to clients. Everything in `ReplicatedStorage`, `StarterGui`, `Workspace` and so on can be read by an exploiter, so never store secrets or trusted logic there.
- Shared modules go in `ReplicatedStorage`; server-only modules in `ServerScriptService` or `ServerStorage`.

@@@ services-getservice
title: Getting services with game:GetService
tags: getservice service game workspace players replicatedstorage runservice tweenservice
---
```lua
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
```
Declare them as locals at the top of the script. `game:GetService` creates the service if needed, while `game.TweenService` can error with "not a valid member of DataModel". `workspace` is a global, so use it directly instead of `game.Workspace`.

@@@ players-characters
title: Players, PlayerAdded, CharacterAdded and handling players already in the game
tags: players playeradded playerremoving characteradded character humanoid respawn localplayer getplayerfromcharacter join leave spawn
---
```lua
local Players = game:GetService("Players")

local function onPlayerAdded(player: Player)
	local function onCharacterAdded(character: Model)
		local humanoid = character:WaitForChild("Humanoid") :: Humanoid
		humanoid.Died:Connect(function()
			print(player.Name .. " died")
		end)
	end

	if player.Character then
		task.spawn(onCharacterAdded, player.Character)   -- character may already exist
	end
	player.CharacterAdded:Connect(onCharacterAdded)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do               -- players who joined before this script ran
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	-- save data and clear per-player tables here
end)
```
- `Players.LocalPlayer` exists only in LocalScripts.
- `Players:GetPlayerFromCharacter(model)` converts a character to a Player (nil for NPCs).
- Characters are rebuilt on every respawn, so reconnect events in `CharacterAdded`.

@@@ remote-events
title: RemoteEvents: client to server and server to client
tags: remoteevent remote fireserver fireclient fireallclients onserverevent onclientevent replicate network communicate arguments table
---
```lua
-- Create a RemoteEvent named "Attack" in ReplicatedStorage.

-- LocalScript (client -> server)
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local attack = ReplicatedStorage:WaitForChild("Attack") :: RemoteEvent
attack:FireServer(targetModel)

-- Script (server)
attack.OnServerEvent:Connect(function(player: Player, target: unknown)
	-- the FIRST argument is always the Player who fired it; client args follow
end)

-- server -> one client / all clients
attack:FireClient(somePlayer, "hello")
attack:FireAllClients("hello")

-- client receives
attack.OnClientEvent:Connect(function(message)
	print(message)
end)
```
What can be sent: numbers, strings, booleans, Roblox types, Instances that exist for the receiver, and tables of those. What does not survive: functions, metatables, tables with mixed or non-string keys, and Instances the client cannot see (they arrive as nil). Always validate every argument on the server (see anti-exploit-server-validation).

@@@ remote-functions
title: RemoteFunctions: request and response
tags: remotefunction invokeserver invokeclient onserverinvoke return value callback yield request response
---
```lua
-- Script (server): only ONE callback can be assigned
getCoins.OnServerInvoke = function(player: Player)
	return coinsByPlayer[player] or 0
end

-- LocalScript: yields until the server returns
local coins = getCoins:InvokeServer()
```
Avoid `InvokeClient`: if the client errors, leaves or never returns, the server thread hangs forever. Use a `RemoteEvent` pair for server-to-client requests. A client-to-server `InvokeServer` is fine if the server handler validates its inputs and cannot yield indefinitely.

@@@ runservice-loops
title: RunService: Heartbeat, Stepped, RenderStepped and per-frame loops
tags: runservice heartbeat stepped renderstepped prerender presimulation postsimulation bindtorenderstep deltatime frame loop update every frame isserver isclient isstudio
---
```lua
local RunService = game:GetService("RunService")

local connection = RunService.Heartbeat:Connect(function(deltaTime: number)
	part.CFrame *= CFrame.Angles(0, math.rad(90) * deltaTime, 0)   -- frame-rate independent
end)
-- connection:Disconnect() when done
```
- `Heartbeat` fires every frame after physics, on server and client. Use it for most logic.
- `Stepped` (`PreSimulation`) fires before physics.
- `RenderStepped` (now also `PreRender`) fires before each frame is drawn and exists only on the client. Use it for cameras and visuals, and keep the work small.
- `RunService:BindToRenderStep(name, priority, fn)` runs a function at a chosen priority. Cameras use `Enum.RenderPriority.Camera.Value + 1`. Remove it with `UnbindFromRenderStep(name)`.
- Always multiply movement by `deltaTime`, or it will run faster on high-FPS machines.
- `RunService:IsServer()`, `IsClient()` and `IsStudio()` tell you where the code runs.

@@@ user-input
title: User input: UserInputService and ContextActionService
tags: userinputservice contextactionservice input key keyboard mouse touch gamepad inputbegan inputended keycode gameprocessed bindaction mobile button click
---
```lua
local UserInputService = game:GetService("UserInputService")

UserInputService.InputBegan:Connect(function(input: InputObject, gameProcessed: boolean)
	if gameProcessed then return end               -- ignore typing in chat or clicks on UI
	if input.KeyCode == Enum.KeyCode.E then
		print("E pressed")
	elseif input.UserInputType == Enum.UserInputType.MouseButton1 then
		print("click")
	end
end)

print(UserInputService:IsKeyDown(Enum.KeyCode.LeftShift))
```
`ContextActionService` gives you rebindable actions and an optional on-screen touch button:
```lua
local ContextActionService = game:GetService("ContextActionService")

ContextActionService:BindAction("Sprint", function(actionName, state, input)
	if state == Enum.UserInputState.Begin then
		print("start sprint")
	end
	return Enum.ContextActionResult.Sink           -- Pass lets other handlers see it too
end, true, Enum.KeyCode.LeftShift)                 -- `true` creates a mobile button
```
Input only exists on the client, so these belong in a LocalScript. Tell the server with a RemoteEvent and validate there.

@@@ raycasting
title: Raycasting with workspace:Raycast and RaycastParams
tags: raycast ray raycastparams filter exclude include hit result instance position normal line of sight detect shoot gun direction findpartonray
---
```lua
local params = RaycastParams.new()
params.FilterType = Enum.RaycastFilterType.Exclude
params.FilterDescendantsInstances = { character }      -- ignore the shooter
params.IgnoreWater = true

local origin = head.Position
local direction = (target - origin).Unit * 100          -- direction AND length, in studs

local result = workspace:Raycast(origin, direction, params)
if result then
	print(result.Instance, result.Position, result.Normal, result.Material, result.Distance)
else
	print("nothing hit")
end
```
- The second argument is a displacement vector, not a unit direction. A unit vector only travels 1 stud.
- `Raycast` returns nil when nothing is hit, so always check the result.
- Use `Enum.RaycastFilterType.Include` to hit only the listed instances. `Blacklist` and `Whitelist` are deprecated.
- Set `params.CollisionGroup` and `RespectCanCollide` to control what counts as solid.
- For thick shapes use `workspace:Blockcast` or `Spherecast`.

@@@ tweenservice
title: TweenService: animate properties smoothly
tags: tween tweenservice tweeninfo easing animate smooth move fade transparency position size color completed play
---
```lua
local TweenService = game:GetService("TweenService")

local info = TweenInfo.new(
	1,                           -- time in seconds
	Enum.EasingStyle.Quad,
	Enum.EasingDirection.Out,
	0,                           -- repeat count (-1 = forever)
	false,                       -- reverses
	0                            -- delay
)

local tween = TweenService:Create(part, info, {
	Position = Vector3.new(0, 10, 0),
	Transparency = 0.5,
})
tween:Play()
tween.Completed:Wait()           -- yields until done
```
`tween:Cancel()` stops it, `tween:Pause()` pauses it. Tween on the client for UI and visuals (smoother), and on the server only when the result must replicate to everyone. You cannot tween properties that are not numbers, colors, vectors, CFrames or UDims (booleans and strings cannot be tweened).

@@@ collectionservice-tags
title: CollectionService tags: apply behavior to many instances
tags: collectionservice tag tagged addtag hastag getinstanceaddedsignal getinstanceremovedsignal many parts doors behavior component
---
Tag objects in Studio (Tag Editor) or in code, then run one script for every tagged object:
```lua
local CollectionService = game:GetService("CollectionService")

local function setup(instance: Instance)
	print("door ready:", instance:GetFullName())
end
local function cleanup(instance: Instance)
	print("door removed")
end

for _, instance in CollectionService:GetTagged("Door") do
	task.spawn(setup, instance)                               -- ones that already exist
end
CollectionService:GetInstanceAddedSignal("Door"):Connect(setup)       -- ones added later
CollectionService:GetInstanceRemovedSignal("Door"):Connect(cleanup)

part:AddTag("Door")              -- Instance methods: AddTag, HasTag, RemoveTag, GetTags
```
This replaces copy-pasting the same script into hundreds of parts.

@@@ attributes
title: Attributes: custom properties on instances
tags: attribute setattribute getattribute getattributechangedsignal custom property data configuration value
---
```lua
part:SetAttribute("Health", 100)
print(part:GetAttribute("Health"))                   -- 100 (nil if not set)
part:GetAttributeChangedSignal("Health"):Connect(function()
	print("health is now", part:GetAttribute("Health"))
end)
```
Supported types: string, boolean, number, UDim, UDim2, BrickColor, Color3, Vector2, Vector3, CFrame, NumberSequence, ColorSequence, NumberRange, Rect and Font. Attributes set on the server replicate to clients, so they are good for read-only state such as a player's role or a door's state. They are not secure storage, and clients can change attributes they own locally without the server seeing it.

@@@ cframe-vector-math
title: CFrame and Vector3 math: position, rotation, lookAt, PivotTo
tags: cframe vector3 angles lookat pivotto lerp magnitude unit dot cross rotate position direction distance toobjectspace inverse orientation
---
```lua
local a = Vector3.new(0, 0, 0)
local b = Vector3.new(10, 0, 0)
print((b - a).Magnitude)                 -- distance
print((b - a).Unit)                      -- direction of length 1
print(a:Lerp(b, 0.5), a:Dot(b), a:Cross(b))
print(Vector3.zero, Vector3.one, Vector3.yAxis)

local cf = CFrame.new(0, 5, 0)
cf *= CFrame.Angles(0, math.rad(90), 0)  -- rotate 90 degrees (angles are radians)
cf *= CFrame.new(0, 0, -5)               -- move 5 studs forward in the part's own space
part.CFrame = CFrame.lookAt(part.Position, target.Position)   -- face a target
model:PivotTo(CFrame.new(0, 10, 0))      -- move any Model or part (replaces SetPrimaryPartCFrame)
local halfway = cf:Lerp(otherCf, 0.5)
local local_ = cf:ToObjectSpace(otherCf) -- otherCf relative to cf
```
CFrame multiplication is not commutative: `cf * offset` applies the offset in cf's own space, while `offset * cf` does not. Do not multiply a CFrame by a Vector3 on the left. Use `cf * Vector3.new(...)` (point to world) or `cf:PointToWorldSpace(v)`.

@@@ humanoid
title: Humanoid: health, walk speed, jumping, damage and death
tags: humanoid health walkspeed jumppower jumpheight takedamage died maxhealth state changestate sit move moveto forcefield kill
---
```lua
local humanoid = character:WaitForChild("Humanoid") :: Humanoid
humanoid.WalkSpeed = 24
humanoid.JumpHeight = 7.2           -- or JumpPower when UseJumpPower is true
humanoid.MaxHealth = 150
humanoid.Health = humanoid.MaxHealth
humanoid:TakeDamage(10)             -- respects ForceField; setting Health directly does not
humanoid.Health = 0                 -- kills the character
humanoid.Died:Connect(function() end)
humanoid.HealthChanged:Connect(function(health) end)
humanoid:MoveTo(Vector3.new(0, 0, 50))
humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
```
Whether `JumpPower` or `JumpHeight` applies depends on `Humanoid.UseJumpPower` (set by `StarterPlayer.CharacterUseJumpPower`). Change WalkSpeed on the server for anything that matters; the client owns its character's physics, so client-side speed changes are not authoritative.

@@@ animation
title: Playing animations with Animator
tags: animation animator loadanimation animationtrack play stop priority looped marker speed rbxassetid humanoid
---
```lua
local humanoid = character:WaitForChild("Humanoid") :: Humanoid
local animator = humanoid:WaitForChild("Animator") :: Animator

local animation = Instance.new("Animation")
animation.AnimationId = "rbxassetid://123456789"        -- replace with your asset id

local track = animator:LoadAnimation(animation)
track.Priority = Enum.AnimationPriority.Action
track.Looped = false
track:Play()
track:AdjustSpeed(1.5)
track.Stopped:Wait()
track:GetMarkerReachedSignal("Hit"):Connect(function() print("hit frame") end)
```
- Use `Animator:LoadAnimation`. `Humanoid:LoadAnimation` is deprecated.
- Load and play player animations from a LocalScript so they are smooth. They replicate to everyone.
- The animation asset must be owned by whoever owns the experience (the user or the group), or it will not play.
- Load each animation once and reuse the track instead of loading it on every use.

@@@ pathfinding
title: PathfindingService: making NPCs walk around obstacles
tags: pathfinding pathfindingservice path computeasync waypoints npc ai moveto navigation obstacle jump agent
---
```lua
local PathfindingService = game:GetService("PathfindingService")

local function walkTo(humanoid: Humanoid, root: BasePart, goal: Vector3): boolean
	local path = PathfindingService:CreatePath({
		AgentRadius = 2,
		AgentHeight = 5,
		AgentCanJump = true,
	})
	local ok = pcall(function()
		path:ComputeAsync(root.Position, goal)
	end)
	if not ok or path.Status ~= Enum.PathStatus.Success then
		return false
	end
	for _, waypoint in path:GetWaypoints() do
		if waypoint.Action == Enum.PathWaypointAction.Jump then
			humanoid.Jump = true
		end
		humanoid:MoveTo(waypoint.Position)
		if not humanoid.MoveToFinished:Wait() then   -- false means it timed out (about 8 seconds)
			return false
		end
	end
	return true
end
```
Recompute the path when the goal moves or when `path.Blocked` fires. For many NPCs, throttle computations. Set `part.PathfindingModifier` or `CanCollide`/`CanQuery` to shape what is walkable.

@@@ physics-constraints
title: Physics movers: LinearVelocity, AlignPosition, VectorForce and network ownership
tags: physics bodyvelocity bodyposition bodygyro linearvelocity alignposition alignorientation vectorforce attachment constraint network ownership setnetworkowner velocity force move
---
Body movers are deprecated. Use constraints with an `Attachment`:
```lua
local attachment = Instance.new("Attachment")
attachment.Parent = part

local lv = Instance.new("LinearVelocity")
lv.Attachment0 = attachment
lv.MaxForce = math.huge
lv.VectorVelocity = Vector3.new(0, 0, -20)
lv.Parent = part
```
- `AlignPosition` moves a part to a point, `AlignOrientation` rotates it, `VectorForce` applies a force and `Torque` applies a twist.
- Unanchored parts are simulated by a nearby player (network ownership). On the server, `part:SetNetworkOwner(nil)` keeps a part under server control. This prevents exploiters moving it, at the cost of latency for the player. Anchored parts cannot have an owner.
- Set CFrame or Position on anchored parts only. Setting them each frame on unanchored parts fights the physics engine.

@@@ collision-groups
title: Collision groups (players not colliding, custom layers)
tags: collision group collisiongroup physicsservice registercollisiongroup collidable noclip players pass through
---
```lua
local PhysicsService = game:GetService("PhysicsService")

PhysicsService:RegisterCollisionGroup("Players")
PhysicsService:CollisionGroupSetCollidable("Players", "Players", false)   -- players pass through each other

local function apply(character: Model)
	for _, part in character:GetDescendants() do
		if part:IsA("BasePart") then
			part.CollisionGroup = "Players"
		end
	end
end
```
Register the group once on the server. Set `part.CollisionGroup` (a string) on each part. `SetPartCollisionGroup` is the old, deprecated way. Parts added later (accessories, tools) need the group too. Listen to `character.DescendantAdded`.

@@@ ui-layout
title: UI layout: UDim2, scale vs offset, layout objects and responsive design
tags: ui gui screengui frame textlabel textbutton udim2 scale offset anchorpoint uilistlayout uigridlayout uipadding uicorner aspectratio responsive mobile resetonspawn layout
---
```lua
local frame = Instance.new("Frame")
frame.AnchorPoint = Vector2.new(0.5, 0.5)
frame.Position = UDim2.fromScale(0.5, 0.5)       -- centre of the parent
frame.Size = UDim2.fromScale(0.3, 0.2)           -- 30% x 20% of the parent
frame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 8)
corner.Parent = frame

local list = Instance.new("UIListLayout")
list.Padding = UDim.new(0, 6)
list.SortOrder = Enum.SortOrder.LayoutOrder
list.Parent = frame

frame.Parent = playerGui:WaitForChild("MainGui")
```
- `UDim2.new(scaleX, offsetX, scaleY, offsetY)`. Scale is a fraction of the parent, offset is pixels.
- Use scale plus `UIAspectRatioConstraint`, `UISizeConstraint` and `UITextSizeConstraint` so UI works on phones and large monitors.
- Layout objects: `UIListLayout`, `UIGridLayout`, `UIPadding`, `UIScale`. `AutomaticSize` lets frames grow to fit contents.
- A `ScreenGui` is cloned into `PlayerGui` on every respawn unless `ResetOnSpawn = false`. Set it to false to keep UI state across deaths.
- UI scripts belong in LocalScripts. The server cannot see another player's PlayerGui contents.

@@@ proximity-prompt-and-touched
title: ProximityPrompt and the Touched event (with debounce)
tags: proximityprompt triggered touched debounce hit part touch interact press e door pickup collect
---
```lua
-- ProximityPrompt (preferred for interaction): works on keyboard, gamepad and touch
prompt.ActionText = "Open"
prompt.HoldDuration = 0.5
prompt.MaxActivationDistance = 8
prompt.Triggered:Connect(function(player: Player)
	print(player.Name .. " used the prompt")
end)

-- Touched fires many times per second, so debounce it
local touching: { [Player]: boolean } = {}
part.Touched:Connect(function(hit: BasePart)
	local player = Players:GetPlayerFromCharacter(hit.Parent)
	if not player or touching[player] then return end
	touching[player] = true
	-- do the effect once
	task.delay(1, function() touching[player] = nil end)
end)
```
`Touched` only fires for parts that are moving or have `CanTouch` enabled, and it can fire for any body part. For reliable zones use `workspace:GetPartBoundsInBox` with `OverlapParams` on a timer, or a zone module.

@@@ sound
title: Playing sounds
tags: sound soundservice playlocalsound audio music play stop volume looped preload contentprovider
---
```lua
local SoundService = game:GetService("SoundService")
local ContentProvider = game:GetService("ContentProvider")

local sound = Instance.new("Sound")
sound.SoundId = "rbxassetid://123456789"
sound.Volume = 0.5
sound.Looped = false
sound.Parent = workspace            -- or a part, for positional audio

ContentProvider:PreloadAsync({ sound })   -- optional: avoid a delay on first play
sound:Play()
sound.Ended:Wait()
sound:Destroy()

SoundService:PlayLocalSound(sound)  -- client only: plays for that player, not positional
```
Sounds inside a Part are 3D (they get quieter with distance). Sounds in `SoundService` or parented to `workspace` directly play non-positionally. Play UI sounds on the client.

@@@ camera
title: Camera control and custom cameras
tags: camera currentcamera scriptable cameratype cframe fieldofview lookat cutscene follow bindtorenderstep first person
---
```lua
local RunService = game:GetService("RunService")
local camera = workspace.CurrentCamera

camera.CameraType = Enum.CameraType.Scriptable
RunService:BindToRenderStep("CutsceneCam", Enum.RenderPriority.Camera.Value + 1, function(dt)
	camera.CFrame = CFrame.lookAt(Vector3.new(0, 20, 30), target.Position)
end)

-- Restore the default camera
RunService:UnbindFromRenderStep("CutsceneCam")
camera.CameraType = Enum.CameraType.Custom
camera.CameraSubject = humanoid

camera.FieldOfView = 90
```
Camera code is client-only (LocalScript). Tween `camera.CFrame` with TweenService for smooth cutscenes.

@@@ streaming-enabled
title: StreamingEnabled: why parts are missing on the client
tags: streaming streamingenabled streamed missing nil client replication persistent model streaming mode waitforchild infinite yield
---
With `Workspace.StreamingEnabled` on, the client only receives parts near the player. The server always sees everything.
- On the client, never assume a part exists. Use `WaitForChild` with a timeout, `FindFirstChild`, or `model.PrimaryPart` checks.
- Set a model's `ModelStreamingMode` to `Persistent` if it must always exist on clients (important gameplay objects).
- `Instance.StreamingEnabled` changes mean "infinite yield" warnings for far away objects. Wait on events like `ChildAdded` or `CollectionService` instance-added signals instead of failing.
- Raycasts and region queries on the client only see streamed-in parts. Do authoritative checks on the server.

@@@ text-filtering
title: Filtering user text (required by Roblox rules)
tags: text filter filtering textservice filterstringasync chat moderation user generated name label pet sign message compliance
---
Any text a player types and that other players can see must be filtered on the server.
```lua
local TextService = game:GetService("TextService")

local function filterFor(text: string, from: Player, to: Player): string
	local ok, result = pcall(function()
		local filtered = TextService:FilterStringAsync(text, from.UserId)
		return filtered:GetChatForUserAsync(to.UserId)
	end)
	return if ok then result else ""      -- show nothing when filtering fails
end
```
Use `GetNonChatStringForBroadcastAsync()` for text shown to everyone (signs, pet names). Never display unfiltered text, and never filter on the client only.

@@@ marketplace-processreceipt
title: Developer products: MarketplaceService.ProcessReceipt
tags: marketplace marketplaceservice processreceipt developer product purchase robux receipt gamepass promptproductpurchase usergamepass
---
```lua
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

MarketplaceService.ProcessReceipt = function(receiptInfo)
	local player = Players:GetPlayerByUserId(receiptInfo.PlayerId)
	if not player then
		return Enum.ProductPurchaseDecision.NotProcessedYet     -- Roblox will retry later
	end
	-- 1. skip if receiptInfo.PurchaseId was already granted (store processed ids in your DataStore)
	-- 2. grant the item and save it
	return Enum.ProductPurchaseDecision.PurchaseGranted        -- only after the grant is safely saved
end
```
Assign `ProcessReceipt` exactly once, on the server. Return `NotProcessedYet` on any failure so the purchase is retried. For gamepasses use `MarketplaceService:UserOwnsGamePassAsync(userId, passId)` inside a `pcall`, and `PromptGamePassPurchase` on the client.

@@@ http-service
title: HttpService: JSON and web requests
tags: httpservice http json jsonencode jsondecode requestasync web request api webhook generateguid fetch get post
---
```lua
local HttpService = game:GetService("HttpService")

local json = HttpService:JSONEncode({ name = "Ada", score = 10 })
local data = HttpService:JSONDecode(json)

local ok, response = pcall(function()
	return HttpService:RequestAsync({
		Url = "https://example.com/api",
		Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body = json,
	})
end)
if ok and response.Success then
	print(response.StatusCode, response.Body)
end

print(HttpService:GenerateGUID(false))    -- unique id string without braces
```
Enable it first: Game Settings, Security, Allow HTTP Requests. It is server-only, cannot call `roblox.com` endpoints, and is rate limited (about 500 requests per minute). Always wrap calls in `pcall`. Never put API keys in client-visible places.

@@@ debris-and-cleanup
title: Destroying instances and Debris
tags: destroy debris additem cleanup remove parent nil temporary projectile effect lifetime
---
```lua
local Debris = game:GetService("Debris")
Debris:AddItem(part, 5)               -- destroy after 5 seconds

task.delay(5, function()              -- equivalent, and cancellable
	if part then part:Destroy() end
end)

part:Destroy()                        -- removes it, disconnects its events, locks its Parent
```
Use `:Destroy()`, not `.Parent = nil`, so the object and its connections can be collected. A destroyed instance cannot be reparented. Check `part.Parent` before using something that may have been destroyed during a yield.

@@@ leaderstats
title: Leaderstats (the leaderboard)
tags: leaderstats leaderboard intvalue folder coins score points stat player list
---
```lua
local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"           -- the exact lowercase name Roblox looks for

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats

	leaderstats.Parent = player                -- parent last so the UI sees the finished folder
end)
```
Change values on the server only (`player.leaderstats.Coins.Value += 10`), since client changes do not replicate. `IntValue`, `NumberValue` and `StringValue` appear on the leaderboard. Load the starting numbers from your DataStore (see datastore-basics).
