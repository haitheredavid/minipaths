# Mini Motorways -- Comprehensive Game Research

> Game by Dinosaur Polo Club (Wellington, New Zealand). Same studio behind Mini Metro.
> Built in Unity. Released 2019 (Apple Arcade), 2021 (Steam), 2022 (Switch).

---

## 1. Core Game Loop

### What Happens Each Tick

Mini Motorways runs a continuous real-time simulation on an accelerated weekly calendar. The game offers speed controls (1x and 2x, with community requests for 4x). The simulation can be paused at any time, allowing players to rearrange roads without time pressure.

Each simulation step processes:

1. **Pin Spawning** -- Destinations (stores/buildings) accumulate "pins" representing trips that need to be made. The rate of pin generation increases over time.
2. **Car Dispatch** -- The system finds the nearest house with an unoccupied car (measured by road tile distance to the destination needing service) and dispatches it. Cars prioritize destinations that have active timers (are in danger of overflowing).
3. **Car Movement** -- Cars travel along their pre-calculated routes. They slow at intersections, queue behind other cars, and obey traffic control infrastructure.
4. **Trip Completion** -- When a car reaches a destination, it picks up a pin. The car then returns home. Each completed round-trip (house -> destination -> house) scores one point.
5. **Timer Evaluation** -- If any destination accumulates too many pins (7 for square buildings, 10 for circular buildings), a countdown timer activates. If any timer fills completely, the game ends.
6. **Weekly Cycle** -- Every in-game Sunday night, the simulation pauses and presents the player with a choice between two upgrade packages.

### Game Over Condition

The game ends when any single destination's countdown timer fills completely. The timer activates when pins exceed the building's threshold. Cars reaching the destination during a timer will slow the timer's progression, and if pins drop back within capacity, the timer depletes on its own and splits back into standard pins.

The game is designed to be unwinnable in the long run. As the developers (Rob and Peter Curry) put it: "every game needs to level with you and tell you it didn't go well enough." Demand will always eventually outpace throughput.

---

## 2. Road Mechanics

### Drawing and Placing Roads

- Players draw roads on a tile-based grid by dragging to create paths.
- Roads snap to tiles and bend at 90-degree or 45-degree angles (diagonal roads are valid and strategically important).
- Roads can be deleted at any time, but a "ghost road" remains until all cars currently using that segment complete their journeys. Resources are only reclaimed after all committed cars finish.
- Each road tile consumes one unit from the player's road budget.

### Driveways

- Houses automatically generate a short "driveway" connecting them to the nearest road. This driveway does NOT count as a road tile and does NOT consume road budget.
- Critically, driveways are NOT treated as intersections. Cars passing a driveway connection experience minimal slowdown compared to a full intersection. This is an important optimization -- placing roads adjacent to houses avoids creating unnecessary intersections.

### Road Budget / Resource System

- Players start with a base allocation of road tiles.
- Every Sunday night (weekly cycle), players receive additional road tiles as part of their chosen upgrade package.
- Base road tile grants vary by city/map: typically 30 or 40 tiles per week.
- Upgrade packages provide additional tiles alongside their special item:
  - **Bridge**: comes with 20 road tiles
  - **Tunnel**: comes with 20 road tiles
  - **Roundabout**: comes with 20 road tiles
  - **Traffic Light**: comes with 20 road tiles
  - **Motorway**: comes with 10 road tiles (the motorway itself uses no road tiles)

### Road Upgrades

**Motorways (Highways)**
- High-speed connections between two points on the grid.
- Unlike regular roads, motorways do NOT bend on the grid -- they arc freely from point A to point B (though endpoints must align to grid tiles).
- Motorways hop over everything (water, roads, buildings) -- they function as elevated highways.
- Cars travel significantly faster on motorways.
- Best used for long-distance connections, not local traffic.
- Come with only 10 extra road tiles (fewest of any upgrade).

**Bridges**
- Allow roads to cross over water.
- Function as standard road segments once placed -- same speed as normal roads.
- Essential on water-heavy maps (e.g., Reykjavik, Hong Kong).

**Tunnels**
- Allow roads to pass through mountains.
- Functionally identical to bridges but for mountain terrain.
- Added in the December 2019 "Mountains and Tunnels" update with the Zurich map.

**Roundabouts**
- A 3x3 circle of one-way road that replaces an intersection.
- Does NOT consume road tiles to build (the roundabout itself is free; you get 20 extra tiles alongside it).
- Requires the 4 tiles surrounding the center to be free of buildings (roads are fine).
- Cars connect to the roundabout from the 4 cardinal squares around the center.
- Significantly improves flow at multi-way intersections compared to uncontrolled crossings.
- Most effective for junctions with 3+ intersecting roads.
- Can become less effective in very high-volume late-game scenarios.

**Traffic Lights**
- Placed on existing intersections.
- Alternate traffic flow by direction, similar to real traffic signals -- one direction flows freely while perpendicular traffic stops.
- Generally considered the weakest upgrade by the community. When traffic is light, intersections flow fine without them; when traffic is heavy, they still cause congestion. Limited cost-effectiveness compared to alternatives.

---

## 3. Traffic / Pathfinding System

### Route Calculation

- When a destination needs service, the game finds the **nearest house with an unoccupied car** based on road tile count (not Euclidean distance).
- The algorithm is suspected to be a simple shortest-path calculation (likely BFS/Dijkstra on the tile grid), not a sophisticated traffic-aware algorithm like A* with congestion weighting.
- **Routes are calculated once at departure and are NOT dynamically updated.** Once a car is moving, it will not adjust its route even if the road network changes. This is a critical design decision that creates delayed cause-and-effect: road changes take time to propagate through the system as existing cars complete their committed journeys.

### Intersection Behavior

- **Cars always slow down at intersections.** This is the primary source of congestion.
- The "crossing penalty" mechanic: for intersections where 4 or more road connections exist, drivers slow down significantly and then accelerate again, wasting approximately twice the normal transit time.
- If an intersection has fewer than 4 connections in the same grid area, cars maintain closer to maximum speed even through sharp angles.
- Cars exiting houses (from driveways) have the **highest priority** -- road cars will slow down to yield to them.

### Congestion and Queuing

- Cars occupy physical space on roads. Road capacity is finite -- a long road holds more cars but also attracts more routes.
- Congestion cascades: when one intersection backs up, it can block upstream traffic, creating chain reactions.
- The fundamental tension: more routes sharing a road means more cars AND more intersections, compounding congestion. This mirrors real urban planning -- it is "a fascinating, complex, unintuitive problem."
- Ghost roads during deletion prevent instant rerouting, creating a delay in network reorganization.

### Traffic Control Effects

- **Roundabouts**: Allow continuous one-way flow, eliminating stop-and-wait behavior at multi-way intersections.
- **Traffic Lights**: Eliminate the intersection speed penalty for the green direction but completely halt the red direction. Net benefit is situational and often marginal.
- **Motorways**: Bypass all ground-level congestion entirely since they are elevated.

---

## 4. Demand System

### Pin Generation

- Destinations generate "pins" over time representing trips that need to be fulfilled.
- Pin spawn rate starts low and increases as weeks progress.
- Eventually, pin generation rate will exceed any possible throughput -- the game is designed to end.

### Destination Spawning

- New destinations spawn throughout the game according to a **per-map schedule** that controls cadence while allowing variability.
- Designers "paint each map with weighted areas" for different types of buildings.
- When the game can no longer place a new destination (map is too full), it instead **increases demand on existing destinations** of that color.
- If a pin cannot be added to a destination because it is already at maximum capacity (timer active), the pin is **redirected to another destination of the same color**. This means a bottleneck on one side of the map can cascade demand to a distant store.

### House Spawning

- Houses spawn semi-randomly but with clustering behavior: the algorithm encourages same-colored houses to appear near each other, forming "neighborhoods."
- If a neighborhood is far from its matching destination, the system may provide additional houses to compensate.
- Houses spawn on any valid land tile not occupied by water, mountains, or existing structures.

### Color Matching

- Houses and destinations are color-coded. Only cars from matching-color houses can service matching-color destinations.
- Colors observed in game: red, blue, green, yellow, purple, and potentially others (at least 5-6 distinct colors per map).
- New colors are introduced progressively as the game advances, adding network complexity.

### Building Types and Capacity

| Building Type | Shape | Pin Threshold (Timer Trigger) | Parking Spaces | Houses Needed |
|---|---|---|---|---|
| Small Destination | Square | 7 pins | ~3 | 1-2 |
| Large Destination | Circle | 10 pins | More (wider lot) | 3-4 |

- Small (square) destinations can **upgrade to large (circle)** destinations as the game progresses -- one of the existing small buildings is randomly promoted.
- Circle destinations have higher capacity but also generate demand at a higher frequency.
- Distance matters: trips exceeding 12-15 road tiles may require additional house connections beyond the baseline.

### Destination Footprint

- Destinations require a 2x3 tile space to spawn. Players can exploit this by placing road fragments in potential spawn zones to block unwanted destinations from appearing in problematic locations. (This is considered an exploit/emergent strategy, not an intended mechanic.)

---

## 5. Scoring

### Point Calculation

- **1 point = 1 completed round trip** (car departs house, reaches destination, picks up pin, returns home).
- Score is the cumulative total of all completed trips during the game session.
- There is no multiplier, bonus, or combo system. Pure throughput measurement.

### What Determines Score

- **Throughput efficiency**: How many cars can complete trips per unit time.
- **Network design**: Shorter routes with fewer intersections = faster trips = more points.
- **Congestion management**: Avoiding bottlenecks keeps cars moving.
- **Demand matching**: Having enough houses connected to each destination color.
- **Longevity**: Surviving longer means more time to accumulate trips. Efficient networks delay the inevitable game-over.

### Achievement Benchmarks

- Community milestone: 2,000+ trips is considered a strong score and is an achievement target.
- Expert players report scores of 3,800+ on favorable maps.
- Scores below 1,000 are considered early-game failures where fundamental network mistakes were made.

---

## 6. Resource Management

### Weekly Upgrade System

- Every Sunday night, the game pauses and offers the player a choice between **two upgrade packages**.
- Each package contains one special item plus a number of bonus road tiles.
- The player MUST choose one of the two packages (cannot skip).
- Available upgrades depend on the map (not all maps offer all upgrade types):

| Upgrade | Bonus Road Tiles | Notes |
|---|---|---|
| Motorway | 10 | Fewest tiles but most powerful mobility tool |
| Bridge | 20 | Required for water crossings |
| Tunnel | 20 | Required for mountain crossings |
| Roundabout | 20 | Free 3x3 intersection improvement |
| Traffic Light | 20 | Weakest upgrade; community consensus is to avoid |

### Strategic Considerations

- **Road tiles are the most consistently valuable resource.** Every upgrade comes with bonus tiles, but motorways provide the fewest.
- **Motorways are the primary reactive problem-solving tool** -- they can instantly connect distant neighborhoods when new destinations spawn far from houses.
- **Bridges and tunnels are map-dependent necessities**, not optional luxuries on maps with significant water/mountains.
- **Roundabouts vs. Traffic Lights**: Roundabouts are almost universally preferred. Traffic lights are widely considered the worst upgrade by the competitive community.

### Modifiers (Custom Game Rules)

The game includes modifiers that alter the resource system:
- **Skyscrapers**: All destinations are circles (higher demand).
- Various other modifiers adjust upgrade availability, spawn patterns, and difficulty parameters.

---

## 7. Map Generation

### Map Structure

- Maps are based on **real-world city topographies** -- simplified representations of actual geographic features.
- Terrain (water, mountains, land boundaries) is **fixed and designed** for each city.
- Building placement during gameplay is **procedurally generated** within designer-painted weighted zones.
- Each map has **multiple camera starting positions**, so replaying the same city feels different each time.
- As of early 2025, there are **23 playable city maps**.

### Terrain Obstacles

- **Water**: Present in nearly all maps except Mexico City. Requires bridges or motorways to cross. Reykjavik has the most water.
- **Mountains**: Introduced with the Zurich map (December 2019). Requires tunnels or motorways to pass through.
- **Map boundaries**: Buildings can only spawn within the city's authentic landmass outline.

### How Cities Play Differently

Each city presents unique challenges based on its geography:

- **Water-heavy maps** (Reykjavik, Hong Kong, Vancouver): Force bridge dependency, create natural traffic segregation but limit connectivity.
- **Mountain maps** (Zurich): Require tunnels, create narrow corridors.
- **Open maps** (Mexico City): More freedom but also more potential for uncontrolled sprawl and intersection proliferation.
- **Island/peninsula maps**: Natural barriers force long routes and strategic bridge placement.
- **Hong Kong**: Unique feature -- boats/ferry terminals on waterways act as floating obstacles.

### Procedural Elements Within Fixed Maps

- The spawning schedule (which colors appear when, which building types) follows a per-map script that controls cadence.
- Exact spawn locations are procedural within weighted zones painted by designers.
- This hybrid approach ensures each playthrough is unique while maintaining designed difficulty curves.

---

## 8. Difficulty Progression

### Escalation Mechanics

Difficulty increases through several compounding mechanisms:

1. **Pin spawn rate acceleration**: The rate at which destinations generate pins increases every week. Eventually throughput cannot keep up.
2. **New color introduction**: Additional destination colors appear as the game progresses, each requiring its own segregated road network.
3. **Building density increase**: More houses and destinations crowd the map, consuming available space and creating intersection conflicts.
4. **Destination upgrades**: Small (square) destinations are promoted to large (circle) destinations, increasing their demand frequency.
5. **Demand redistribution**: When new destinations cannot spawn, existing destinations receive increased demand instead.

### Game Phases

**Early Game (0-1000 trips)**
- Few colors (1-2), low traffic.
- Network design mistakes are forgivable -- roads are quiet.
- Focus: Establish clean, segregated color networks.
- "You can frankly make all of the wrong choices and you'll be fine."

**Mid Game (1000-1500 trips)**
- 3-4 colors active, traffic jams become possible.
- This is where major routing decisions are locked in.
- Focus: Segregation of color networks, minimizing intersections, establishing major arteries.
- "This is where you're setting up the major paths you're going to carry through into late game."

**Late Game (1500+ trips)**
- Map is nearly full, new buildings force awkward connections.
- Rerouting is limited to established roads and pre-blocked areas.
- Demand exceeds capacity; it becomes about managing decline.
- The "calm-to-frantic arc" peaks here.

### Color Introduction Timing

- The exact timing of new color introductions is per-map and follows the designed spawn schedule.
- Generally, a new color appears every few weeks of in-game time.
- Each new color effectively requires an entirely separate road network, dramatically increasing spatial pressure.

---

## 9. Key Design Patterns

### Emergent Complexity from Simple Rules

The game is built from individually trivial components:
- Stores produce pins.
- Houses have cars.
- Cars follow shortest paths on roads.
- Intersections slow cars down.
- Too many pins = game over.

Yet the interactions between these simple rules create genuinely complex, unintuitive optimization problems. As the developers describe: "seemingly-simple systems that are complex in unintuitive ways, so there's a lot of depth waiting to be discovered."

The key emergent properties:
- **Capacity is the real constraint**: Roads have finite car capacity. Longer roads hold more cars but attract more routes. More routes mean more intersections. More intersections mean lower throughput. This is a non-obvious feedback loop.
- **Technical debt**: Early "good enough" solutions (zigzag roads, mixed-color routes) become catastrophic bottlenecks at scale. "Systems break at scale in predictable ways."
- **Cascade failures**: One overloaded destination redirects demand to others, which then overload, creating chain reactions across the network.

### Player Agency vs. Procedural Generation Tension

The developers deliberately constrain player control:
- Players control roads. They do NOT control where buildings spawn, which car goes where, or which route a car takes.
- This creates "predictable chaos" -- players must design resilient systems rather than micromanage individual agents.
- The restricted agency produces the signature emotional arc: calm observation gives way to frantic firefighting as demand outpaces design.

### Wuselfaktor ("Bustle Factor")

A core design pillar borrowed from German game design vocabulary. Wuselfaktor is the joy of watching many small agents bustle through a system. Tana Tanoi (technical designer) calls it "the bread and butter of our style of games." It is implemented through "an increasing number of predictable agents navigating around a network that grows more complex over time."

The satisfaction comes from watching a system you built function smoothly -- and the tension comes from watching it start to fail.

### Constraint Optimization as Core Fantasy

Mini Motorways is fundamentally a constraint optimization puzzle dressed in a city-building aesthetic. Players learn to:
- Plan under uncertainty (you don't know where the next building will spawn).
- Iterate on working systems (rebuilding a road network mid-game is expensive and risky).
- Make trade-offs that compound over time (every road placement is permanent context for future decisions).

### The Unwinnable Design

Every game ends in failure by design. This is intentional -- it shifts the player's goal from "winning" to "lasting longer" and "scoring higher." The inevitability of failure makes each decision feel weighty and creates natural narrative arcs within each session.

### Relatable Simulation

The developers keep the game grounded in real-world expectations. Players bring their own understanding of traffic, roads, and urban planning to the game, which makes the systems intuitive to grasp but reveals surprising depth when those intuitions conflict with optimal play (e.g., more roads can make traffic worse, just like in real life -- an instance of Braess's paradox).

---

## 10. Technical Implementation Notes

- **Engine**: Unity
- **Platforms**: iOS (Apple Arcade), Steam (Windows/Mac/Linux), Nintendo Switch
- **2021 patches** addressed traffic AI behaviors: optimized roundabout flow, improved traffic light timing at high-demand intersections to reduce artificial jams.
- **Simulation is deterministic** within a session but each playthrough generates different building placements.
- **The foundational "toy"** (the satisfying core of watching cars drive around a tile-based road network) took approximately **4 months of focused prototyping** to discover and refine.
- **Original concept** was to merge Freeways (a free-drawing road game) with Mini Metro. Early prototypes heavily borrowed from Freeways before the team realized they were making a fundamentally different game, leading to the tile-based approach.

---

## Sources

- [Game Developer: Mini Motorways and the delicate art of marrying complexity and minimalism](https://www.gamedeveloper.com/audio/-i-mini-motorways-i-and-the-delicate-art-of-marrying-complexity-and-minimalism)
- [Pocket Tactics: GDC 2023 - Creating predictable chaos with Dinosaur Polo Club](https://www.pockettactics.com/dinosaur-polo-club/interview)
- [Thumbsticks: How Mini Motorways built its Wuselfaktor](https://www.thumbsticks.com/hustle-and-bustle-how-mini-motorways-built-its-wuselfaktor/)
- [The Scientific Gamer: Thoughts on Mini Motorways](https://scientificgamer.com/thoughts-mini-motorways/)
- [Medium: Mini Metro and Mini Motorways - The Art of Elegant Constraint Optimization](https://medium.com/gaming-is-good/mini-metro-and-mini-motorways-the-art-of-elegant-constraint-optimization-2571a32fdfe2)
- [Frostilyte: How to Consistently Hit 2000+ Trips](https://frostilyte.ca/2025/04/04/how-to-consistently-hit-2000-or-more-trips-in-mini-motorways/)
- [Steam Guide: How to Win at Mini Motorways (2,000+ achievements)](https://steamcommunity.com/sharedfiles/filedetails/?id=2647966505)
- [Steam Guide: Quick Mini Motorways Strategy Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2553726183)
- [Mini Motorways Wiki (Fandom)](https://mini-motorways.fandom.com/wiki/Mini_Motorways)
- [Mini Motorways Wiki - Maps (Fandom)](https://mini-motorways.fandom.com/wiki/Maps)
- [Mini Motorways Wiki - Upgrades (Fandom)](https://mini-motorways.fandom.com/wiki/Upgrades)
- [Mini Motorways Wiki - Terrain Features (Fandom)](https://mini-motorways.fandom.com/wiki/Terrain_Features)
- [Mini Motorways Miraheze Wiki - Gameplay](https://minimotorways.miraheze.org/wiki/Gameplay)
- [Wikipedia: Mini Motorways](https://en.wikipedia.org/wiki/Mini_Motorways)
- [Game Design Roundtable #291: Tana Tanoi Talks Mini Motorways](https://thegamedesignroundtable.com/episode/291-tana-tanoi-talks-mini-motorways/)
- [GamesHub: The making of Mini Motorways](https://www.gameshub.com/news/features/the-making-of-mini-motorways-and-the-futility-of-urban-development-4748/)
- [TouchArcade: Dinosaur Polo Club Interview with CEO Amie Wolken](https://toucharcade.com/2024/08/20/exclusive-dinosaur-polo-club-interview-ceo-amie-wolken-on-mini-metro-mini-motorways-the-team-free-dlc-working-with-apple-ports-and-more/)
- [KosGames: Mini Motorways Beginners Guide](https://kosgames.com/mini-motorways-beginners-guide-game-mechanics-554/)
- [Steam Guide: Queuing Theory Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2808098164)
- [Anuflora: Mini Motorways Game Analytics](https://www.anuflora.com/game/?p=5535)
