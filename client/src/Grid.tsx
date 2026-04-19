import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const GRID_SIZE = 20;
const CELL_SIZE = 1;
const HALF = (GRID_SIZE * CELL_SIZE) / 2;

// --- Interfaces ---

export type OwnerId = 0 | 1;
export const PLAYER: OwnerId = 0;
export const BOT: OwnerId = 1;

interface Path {
  id: string;
  points: [number, number][];
  color: string;
  ownerId: OwnerId;
}

interface SpawnPoint {
  id: string;
  position: [number, number];
  color: string;
  ownerId: OwnerId;
  spawnTimer: number;     // seconds until next agent spawn
  spawnInterval: number;  // seconds between spawns
}

interface DestinationPoint {
  id: string;
  position: [number, number];
  color: string;
  ownerId: OwnerId;       // matched-owner pair for Phase A
  demand: number;         // accumulated pins
  maxDemand: number;      // game over threshold
  demandTimer: number;    // seconds until next demand pin
  demandInterval: number; // seconds between demand increases
}

interface Agent {
  id: string;
  pathId: string;
  progress: number;   // 0 → path.length-1, fractional
  speed: number;      // cells per second
  forward: boolean;   // travel direction along path
  color: string;
  ownerId: OwnerId;
  spawnId: string;    // which spawn point created this agent
  destId: string;     // target destination
  returning: boolean; // heading back to spawn after delivery
}

export interface DualScore {
  player: number;
  bot: number;
}

export interface TokenState {
  claim: number;
  seize: number;
}

export interface DualTokens {
  player: TokenState;
  bot: TokenState;
}

export type ClickMode = "build" | "claim" | "seize" | "treaty";

export type TreatyResult = "accepted" | "rejected" | null;

export interface PerSideStats {
  claimsUsed: number;
  seizesUsed: number;
  treatiesAccepted: number;
  treatiesProposed: number;
  treatiesRejected: number;
  pathsBuilt: number;
}

export interface DualStats {
  player: PerSideStats;
  bot: PerSideStats;
}

const EMPTY_STATS: PerSideStats = {
  claimsUsed: 0,
  seizesUsed: 0,
  treatiesAccepted: 0,
  treatiesProposed: 0,
  treatiesRejected: 0,
  pathsBuilt: 0,
};

const INITIAL_TOKENS: DualTokens = {
  player: { claim: 2, seize: 2 },
  bot: { claim: 2, seize: 2 },
};

const OBJECT_SCALE = 1.2;
const PLAYER_COLORS = ["#8b7bff", "#4db5ff"]; // indigo, blue
const BOT_COLORS = ["#2ee0b0", "#ff8a6b"];    // green, orange
const COLORS_BY_OWNER: Record<OwnerId, string[]> = {
  [PLAYER]: PLAYER_COLORS,
  [BOT]: BOT_COLORS,
};
const ROAD_EDGE_BY_OWNER: Record<OwnerId, string> = {
  [PLAYER]: "#5b6fff", // indigo edge for player roads
  [BOT]: "#2ea876",    // green edge for bot roads
};
const PATH_COLOR = "#4a5260";
const PATH_EDGE_COLOR = "#6d7684";
const PATH_CENTER_COLOR = "#d8c26a";
const GROUND_COLOR = "#17222e";
const GRID_LINE_COLOR = "#334659";
const AGENT_SPEED = 2.5;
const INITIAL_SPAWN_INTERVAL = 4;  // seconds between agent spawns
const INITIAL_DEMAND_INTERVAL = 6; // seconds between demand pin increases
const NEW_PAIR_INTERVAL = 30;      // seconds between new spawn/dest pair appearing

// --- Utilities ---

function snapToGrid(x: number, z: number): [number, number] {
  return [
    Math.floor((x + HALF) / CELL_SIZE) * CELL_SIZE - HALF + CELL_SIZE / 2,
    Math.floor((z + HALF) / CELL_SIZE) * CELL_SIZE - HALF + CELL_SIZE / 2,
  ];
}

type TileOwners = Map<string, Set<OwnerId>>;

function buildTileOwners(
  paths: Path[],
  seized?: Map<string, OwnerId>,
  treatied?: Set<string>,
): TileOwners {
  const m: TileOwners = new Map();
  for (const path of paths) {
    for (const p of path.points) {
      const k = posKey(p);
      let s = m.get(k);
      if (!s) { s = new Set<OwnerId>(); m.set(k, s); }
      s.add(path.ownerId);
    }
  }
  if (seized) {
    for (const [k, owner] of seized) {
      let s = m.get(k);
      if (!s) { s = new Set<OwnerId>(); m.set(k, s); }
      s.add(owner);
    }
  }
  if (treatied) {
    for (const k of treatied) {
      let s = m.get(k);
      if (!s) { s = new Set<OwnerId>(); m.set(k, s); }
      s.add(PLAYER);
      s.add(BOT);
    }
  }
  return m;
}

/**
 * A* with owner-aware costs.
 * - hardBlockers: tiles never traversable except start/end (spawn/dest centers).
 * - tileOwners: which owner(s) already have road on each tile.
 *   - tile already owned by `ownerId` → forbidden (no overlap of own road) except start/end.
 *   - tile owned only by opponents → traversable with `crossPenalty` added.
 *   - empty tile → free.
 */
function findPath(
  start: [number, number],
  end: [number, number],
  hardBlockers: Set<string>,
  tileOwners: TileOwners,
  ownerId: OwnerId,
  crossPenalty: number,
): [number, number][] | null {
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const startKey = key(start);
  const endKey = key(end);
  const dirs: [number, number][] = [
    [CELL_SIZE, 0],
    [-CELL_SIZE, 0],
    [0, CELL_SIZE],
    [0, -CELL_SIZE],
  ];

  const open: { pos: [number, number]; g: number; f: number }[] = [
    { pos: start, g: 0, f: heuristic(start, end) },
  ];
  const cameFrom = new Map<string, [number, number]>();
  const gScore = new Map<string, number>();
  gScore.set(startKey, 0);

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    const ck = key(current.pos);

    if (Math.abs(current.pos[0] - end[0]) < 0.01 && Math.abs(current.pos[1] - end[1]) < 0.01) {
      const path: [number, number][] = [current.pos];
      let k = ck;
      while (cameFrom.has(k)) {
        const p = cameFrom.get(k)!;
        path.unshift(p);
        k = key(p);
      }
      return path;
    }

    for (const [dx, dz] of dirs) {
      const next: [number, number] = [
        Math.round((current.pos[0] + dx) * 100) / 100,
        Math.round((current.pos[1] + dz) * 100) / 100,
      ];
      const nk = key(next);

      if (
        next[0] < -HALF + CELL_SIZE / 2 ||
        next[0] > HALF - CELL_SIZE / 2 ||
        next[1] < -HALF + CELL_SIZE / 2 ||
        next[1] > HALF - CELL_SIZE / 2
      ) continue;

      const isEndpoint = nk === startKey || nk === endKey;

      if (hardBlockers.has(nk) && !isEndpoint) continue;

      const owners = tileOwners.get(nk);
      if (owners && owners.has(ownerId) && !isEndpoint) continue;

      let edgeCost = CELL_SIZE;
      if (owners && owners.size > 0 && !owners.has(ownerId) && !isEndpoint) {
        edgeCost += crossPenalty;
      }

      const tentG = current.g + edgeCost;
      if (tentG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, current.pos);
        gScore.set(nk, tentG);
        open.push({ pos: next, g: tentG, f: tentG + heuristic(next, end) });
      }
    }
  }

  return null;
}

function heuristic(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function posKey(p: [number, number]): string {
  return `${p[0]},${p[1]}`;
}

function posEqual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
}

/** Pick a random unoccupied grid cell */
function randomGridPos(usedPositions: Set<string>): [number, number] {
  let pos: [number, number];
  let attempts = 0;
  do {
    const gx = Math.floor(Math.random() * GRID_SIZE);
    const gz = Math.floor(Math.random() * GRID_SIZE);
    pos = [gx * CELL_SIZE - HALF + CELL_SIZE / 2, gz * CELL_SIZE - HALF + CELL_SIZE / 2];
    attempts++;
  } while (usedPositions.has(posKey(pos)) && attempts < 200);
  usedPositions.add(posKey(pos));
  return pos;
}

/** Generate a single spawn/dest pair for an owner, avoiding used positions */
function generatePair(
  ownerId: OwnerId,
  colorIdx: number,
  used: Set<string>,
): { spawn: SpawnPoint; destination: DestinationPoint } {
  const colors = COLORS_BY_OWNER[ownerId];
  const color = colors[colorIdx % colors.length];

  let spawnPos: [number, number];
  let destPos: [number, number];
  let tries = 0;

  do {
    spawnPos = randomGridPos(used);
    used.delete(posKey(spawnPos));
    destPos = randomGridPos(used);
    used.delete(posKey(destPos));
    tries++;
  } while (heuristic(spawnPos, destPos) < 6 && tries < 50);

  used.add(posKey(spawnPos));
  used.add(posKey(destPos));

  return {
    spawn: {
      id: crypto.randomUUID(),
      position: spawnPos,
      color,
      ownerId,
      spawnTimer: INITIAL_SPAWN_INTERVAL,
      spawnInterval: INITIAL_SPAWN_INTERVAL,
    },
    destination: {
      id: crypto.randomUUID(),
      position: destPos,
      color,
      ownerId,
      demand: 1,
      maxDemand: 7,
      demandTimer: INITIAL_DEMAND_INTERVAL,
      demandInterval: INITIAL_DEMAND_INTERVAL,
    },
  };
}

/** Generate initial pairs for both owners */
function generateInitialPairs(perOwner: number): { spawns: SpawnPoint[]; destinations: DestinationPoint[] } {
  const used = new Set<string>();
  const spawns: SpawnPoint[] = [];
  const destinations: DestinationPoint[] = [];

  for (const owner of [PLAYER, BOT] as OwnerId[]) {
    for (let i = 0; i < perOwner; i++) {
      const { spawn, destination } = generatePair(owner, i, used);
      spawns.push(spawn);
      destinations.push(destination);
    }
  }

  return { spawns, destinations };
}

// --- Intro Animation Helpers ---

/** Ease-out back (overshoot bounce) */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Ease-out cubic */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

type IntroPhase = "grid" | "spawners" | "destinations" | "done";

const INTRO_GRID_DURATION = 0.8;       // seconds for grid to fully draw
const INTRO_SPAWN_DURATION = 0.4;      // seconds per spawner pop
const INTRO_SPAWN_STAGGER = 0.12;      // stagger between spawners
const INTRO_DEST_DURATION = 0.4;       // seconds per destination pop
const INTRO_DEST_STAGGER = 0.12;       // stagger between destinations

// --- Rendering Components ---

function GridLines({ progress = 1 }: { progress?: number }) {
  const geoRef = useRef<THREE.BufferGeometry>(null);

  // All line segment data — pairs sorted by distance from center
  const { allPoints, lineCount } = useMemo(() => {
    const lines: { dist: number; pts: THREE.Vector3[] }[] = [];
    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i * CELL_SIZE - HALF;
      const dist = Math.abs(pos - 0); // distance from center
      // vertical line
      lines.push({
        dist,
        pts: [new THREE.Vector3(pos, 0.01, -HALF), new THREE.Vector3(pos, 0.01, HALF)],
      });
      // horizontal line
      lines.push({
        dist,
        pts: [new THREE.Vector3(-HALF, 0.01, pos), new THREE.Vector3(HALF, 0.01, pos)],
      });
    }
    // Sort by distance from center so inner lines draw first
    lines.sort((a, b) => a.dist - b.dist);
    const allPts = lines.flatMap((l) => l.pts);
    return { allPoints: allPts, lineCount: lines.length };
  }, []);

  // Update draw range based on progress
  useEffect(() => {
    if (!geoRef.current) return;
    const visibleLines = Math.floor(easeOutCubic(Math.min(progress, 1)) * lineCount);
    geoRef.current.setDrawRange(0, visibleLines * 2); // 2 vertices per line segment
  }, [progress, lineCount]);

  return (
    <lineSegments>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(allPoints.flatMap((p) => [p.x, p.y, p.z])), 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial color={GRID_LINE_COLOR} />
    </lineSegments>
  );
}

function buildPathGeometry(path: [number, number][], yHeight: number, widthScale = 0.5): THREE.BufferGeometry {
  const width = CELL_SIZE * widthScale;
  const geo = new THREE.BufferGeometry();
  const vertices: number[] = [];

  for (let i = 0; i < path.length; i++) {
    const [x, z] = path[i];
    const hw = width / 2;
    vertices.push(
      x - hw, yHeight, z - hw,
      x + hw, yHeight, z - hw,
      x + hw, yHeight, z + hw,
      x - hw, yHeight, z - hw,
      x + hw, yHeight, z + hw,
      x - hw, yHeight, z + hw,
    );

    if (i < path.length - 1) {
      const [nx, nz] = path[i + 1];
      const dx = nx - x;
      if (Math.abs(dx) > 0.01) {
        const minX = Math.min(x, nx);
        const maxX = Math.max(x, nx);
        vertices.push(
          minX - hw, yHeight, z - hw,
          maxX + hw, yHeight, z - hw,
          maxX + hw, yHeight, z + hw,
          minX - hw, yHeight, z - hw,
          maxX + hw, yHeight, z + hw,
          minX - hw, yHeight, z + hw,
        );
      } else {
        const minZ = Math.min(z, nz);
        const maxZ = Math.max(z, nz);
        vertices.push(
          x - hw, yHeight, minZ - hw,
          x + hw, yHeight, minZ - hw,
          x + hw, yHeight, maxZ + hw,
          x - hw, yHeight, minZ - hw,
          x + hw, yHeight, maxZ + hw,
          x - hw, yHeight, maxZ + hw,
        );
      }
    }
  }

  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
  return geo;
}

function PathLine({ path, color, opacity = 1, edgeColor }: { path: [number, number][]; color: string; opacity?: number; edgeColor?: string }) {
  const edgeGeometry = useMemo(() => buildPathGeometry(path, 0.045, 0.62 * OBJECT_SCALE), [path]);
  const coreGeometry = useMemo(() => buildPathGeometry(path, 0.06, 0.48 * OBJECT_SCALE), [path]);
  const centerGeometry = useMemo(() => buildPathGeometry(path, 0.066, 0.04 * OBJECT_SCALE), [path]);
  const transparent = opacity < 1;

  return (
    <group>
      <mesh geometry={edgeGeometry}>
        <meshBasicMaterial
          color={edgeColor ?? PATH_EDGE_COLOR}
          side={THREE.DoubleSide}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>
      <mesh geometry={coreGeometry}>
        <meshBasicMaterial
          color={color}
          side={THREE.DoubleSide}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>
      {opacity >= 1 && (
        <mesh geometry={centerGeometry}>
          <meshBasicMaterial color={PATH_CENTER_COLOR} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function Marker({ position, color }: { position: [number, number]; color: string }) {
  return (
    <group position={[position[0], 0, position[1]]} scale={[OBJECT_SCALE, OBJECT_SCALE, OBJECT_SCALE]}>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.26, 0.28, 0.06, 24]} />
        <meshStandardMaterial color="#0f1923" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.18, 0.2, 0.18, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.25}
          roughness={0.55}
        />
      </mesh>
    </group>
  );
}

/** Spawn point — small house shape (box with pointed roof) */
function SpawnPointMesh({ point, scale = 1 }: { point: SpawnPoint; scale?: number }) {
  const s = scale * OBJECT_SCALE;
  return (
    <group position={[point.position[0], 0, point.position[1]]} scale={[s, s, s]}>
      {/* Base pad */}
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.82, 0.06, 0.82]} />
        <meshStandardMaterial color="#0d1720" roughness={0.9} />
      </mesh>
      {/* House body */}
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[0.62, 0.36, 0.62]} />
        <meshStandardMaterial
          color={point.color}
          emissive={point.color}
          emissiveIntensity={0.18}
          roughness={0.5}
        />
      </mesh>
      {/* Roof */}
      <mesh position={[0, 0.55, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.5, 0.34, 4]} />
        <meshStandardMaterial
          color={point.color}
          emissive={point.color}
          emissiveIntensity={0.35}
          roughness={0.45}
        />
      </mesh>
    </group>
  );
}

/** Destination point — taller building with demand pips */
function DestinationPointMesh({ point, scale = 1 }: { point: DestinationPoint; scale?: number }) {
  // Demand pips: larger spheres arranged in a centered grid floating above building
  const pips: JSX.Element[] = [];
  const MAX_PER_ROW = 4;
  const SPACING = 0.22;
  const PIP_RADIUS = 0.12;
  const BASE_Y = 1.05;
  const critical = point.demand >= point.maxDemand - 1;
  for (let i = 0; i < point.demand; i++) {
    const row = Math.floor(i / MAX_PER_ROW);
    const col = i % MAX_PER_ROW;
    const inRow = Math.min(point.demand - row * MAX_PER_ROW, MAX_PER_ROW);
    const x = (col - (inRow - 1) / 2) * SPACING;
    const y = BASE_Y + row * SPACING;
    pips.push(
      <mesh key={i} position={[x, y, 0]}>
        <sphereGeometry args={[PIP_RADIUS, 16, 16]} />
        <meshStandardMaterial
          color={critical ? "#ff2222" : "#ffffff"}
          emissive={critical ? "#ff2222" : "#ffffff"}
          emissiveIntensity={critical ? 0.6 : 0.2}
          toneMapped={false}
        />
      </mesh>
    );
  }

  const s = scale * OBJECT_SCALE;
  return (
    <group position={[point.position[0], 0, point.position[1]]} scale={[s, s, s]}>
      {/* Base pad */}
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.88, 0.06, 0.88]} />
        <meshStandardMaterial color="#0d1720" roughness={0.9} />
      </mesh>
      {/* Building body */}
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[0.72, 0.74, 0.72]} />
        <meshStandardMaterial
          color={point.color}
          emissive={point.color}
          emissiveIntensity={0.18}
          roughness={0.5}
        />
      </mesh>
      {/* Roof cap accent */}
      <mesh position={[0, 0.81, 0]}>
        <boxGeometry args={[0.78, 0.06, 0.78]} />
        <meshStandardMaterial
          color={point.color}
          emissive={point.color}
          emissiveIntensity={0.5}
          roughness={0.4}
          toneMapped={false}
        />
      </mesh>
      {/* Demand pips (centered above) */}
      {pips}
    </group>
  );
}

/** Agent mesh — small colored car box, offset to right lane of travel */
const LANE_OFFSET = 0.13 * OBJECT_SCALE;

function AgentMesh({
  agent,
  path,
  tileOwners,
  treatiedTiles,
  speedMult,
  treatyMult,
}: {
  agent: Agent;
  path: [number, number][];
  tileOwners: TileOwners;
  treatiedTiles: Set<string>;
  speedMult: number;
  treatyMult: number;
}) {
  const meshRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!meshRef.current || path.length < 2) return;

    const idxNow = Math.max(0, Math.min(Math.floor(agent.progress), path.length - 1));
    const tileKey = posKey(path[idxNow]);
    const owners = tileOwners.get(tileKey);
    let stepMult = 1;
    if (treatiedTiles.has(tileKey)) {
      stepMult = treatyMult; // both sides get bonus on treatied tiles
    } else if (owners && owners.size > 0 && !owners.has(agent.ownerId)) {
      stepMult = speedMult;  // crossing pure opponent tile
    }

    const step = agent.speed * stepMult * delta;
    if (agent.forward) {
      agent.progress += step;
      if (agent.progress >= path.length - 1) {
        agent.progress = path.length - 1;
        agent.forward = false;
      }
    } else {
      agent.progress -= step;
      if (agent.progress <= 0) {
        agent.progress = 0;
        agent.forward = true;
      }
    }

    const idx = Math.floor(agent.progress);
    const frac = agent.progress - idx;
    const curr = path[Math.min(idx, path.length - 1)];
    const next = path[Math.min(idx + 1, path.length - 1)];

    const x = curr[0] + (next[0] - curr[0]) * frac;
    const z = curr[1] + (next[1] - curr[1]) * frac;

    // Travel direction — flip when moving backward along the path
    const travelSign = agent.forward ? 1 : -1;
    const dirX = (next[0] - curr[0]) * travelSign;
    const dirZ = (next[1] - curr[1]) * travelSign;
    const len = Math.hypot(dirX, dirZ);

    if (len > 0.01) {
      const ndx = dirX / len;
      const ndz = dirZ / len;
      // Right-hand lane: rotate travel dir -90° around Y → (ndz, -ndx)
      const offsetX = ndz * LANE_OFFSET;
      const offsetZ = -ndx * LANE_OFFSET;
      meshRef.current.position.set(x + offsetX, 0.25, z + offsetZ);
      meshRef.current.rotation.y = Math.atan2(ndx, ndz);
    } else {
      meshRef.current.position.set(x, 0.25, z);
    }
  });

  const startPos = path[0];
  return (
    <group ref={meshRef} position={[startPos[0], 0.25, startPos[1]]} scale={[OBJECT_SCALE, OBJECT_SCALE, OBJECT_SCALE]}>
      {/* Car body */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.2, 0.2, 0.42]} />
        <meshStandardMaterial
          color={agent.color}
          emissive={agent.color}
          emissiveIntensity={0.28}
          roughness={0.4}
        />
      </mesh>
      {/* Cabin / windshield accent */}
      <mesh position={[0, 0.13, -0.02]}>
        <boxGeometry args={[0.16, 0.06, 0.22]} />
        <meshStandardMaterial color="#0f1923" roughness={0.3} />
      </mesh>
    </group>
  );
}

function SeizedMarker({ position, color }: { position: [number, number]; color: string }) {
  return (
    <group position={[position[0], 0.07, position[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
        <ringGeometry args={[0.18, 0.32, 4]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.85} toneMapped={false} />
      </mesh>
    </group>
  );
}

function TreatyMarker({ position }: { position: [number, number] }) {
  // Two interlocked half-rings — player color + bot color
  return (
    <group position={[position[0], 0.075, position[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.32, 24, 1, 0, Math.PI]} />
        <meshBasicMaterial color={ROAD_EDGE_BY_OWNER[PLAYER]} side={THREE.DoubleSide} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI]}>
        <ringGeometry args={[0.22, 0.32, 24, 1, 0, Math.PI]} />
        <meshBasicMaterial color={ROAD_EDGE_BY_OWNER[BOT]} side={THREE.DoubleSide} transparent opacity={0.9} toneMapped={false} />
      </mesh>
    </group>
  );
}

function HoverCell({ position, blocked = false, tint }: { position: [number, number] | null; blocked?: boolean; tint?: string }) {
  if (!position) return null;
  const color = tint ?? (blocked ? "#ff5566" : "#5eb2ff");
  return (
    <mesh position={[position[0], 0.02, position[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CELL_SIZE * 0.9, CELL_SIZE * 0.9]} />
      <meshBasicMaterial color={color} transparent opacity={blocked ? 0.55 : 0.4} side={THREE.DoubleSide} />
    </mesh>
  );
}

// --- Find which spawn/dest a path endpoint touches ---

function findPointAtPos<T extends { position: [number, number] }>(
  points: T[],
  pos: [number, number]
): T | undefined {
  return points.find((p) => posEqual(p.position, pos));
}

/** Find a path that connects a spawn to a matching destination (same owner + color) */
function findConnectingPath(
  spawn: SpawnPoint,
  destinations: DestinationPoint[],
  paths: Path[]
): { path: Path; dest: DestinationPoint; spawnAtStart: boolean } | null {
  const matchingDests = destinations.filter(
    (d) => d.color === spawn.color && d.ownerId === spawn.ownerId,
  );
  const ownerPaths = paths.filter((p) => p.ownerId === spawn.ownerId);

  for (const path of ownerPaths) {
    const start = path.points[0];
    const end = path.points[path.points.length - 1];

    for (const dest of matchingDests) {
      if (posEqual(start, spawn.position) && posEqual(end, dest.position)) {
        return { path, dest, spawnAtStart: true };
      }
      if (posEqual(end, spawn.position) && posEqual(start, dest.position)) {
        return { path, dest, spawnAtStart: false };
      }
    }
  }

  return null;
}

// --- Bot AI ---

/**
 * Greedy: for each unconnected bot spawn, A* to closest matching dest.
 * Returns new paths to append. Mutates a local occupied set across iterations
 * so multiple new bot paths in the same tick don't collide.
 */
function botGreedyConnect(
  spawns: SpawnPoint[],
  dests: DestinationPoint[],
  paths: Path[],
  pointPositions: Set<string>,
  crossPenalty: number,
): Path[] {
  const newPaths: Path[] = [];
  let tileOwners = buildTileOwners(paths);

  for (const spawn of spawns) {
    if (spawn.ownerId !== BOT) continue;

    const conn = findConnectingPath(spawn, dests, [...paths, ...newPaths]);
    if (conn) continue;

    const matchingDests = dests
      .filter((d) => d.color === spawn.color && d.ownerId === BOT)
      .sort((a, b) => heuristic(spawn.position, a.position) - heuristic(spawn.position, b.position));

    for (const dest of matchingDests) {
      const path = findPath(spawn.position, dest.position, pointPositions, tileOwners, BOT, crossPenalty);
      if (!path) continue;

      const newPath: Path = {
        id: crypto.randomUUID(),
        points: path,
        color: PATH_COLOR,
        ownerId: BOT,
      };
      newPaths.push(newPath);
      tileOwners = buildTileOwners([...paths, ...newPaths]);
      break;
    }
  }

  return newPaths;
}

/**
 * Bot heuristic for token use. Fires at most one action per tick.
 * Claim: pick a player spawn near a player dest of high demand.
 * Seize: pick a player road tile that lies on bot's likely future path
 *        (closest player tile to any bot spawn-dest line).
 */
function botUseTokens(args: {
  tokens: DualTokens;
  spawnPoints: SpawnPoint[];
  destPoints: DestinationPoint[];
  paths: Path[];
  seizedTiles: Map<string, OwnerId>;
  onClaim: (spawnId: string) => void;
  onSeize: (tileKey: string) => void;
}) {
  const { tokens, spawnPoints, destPoints, paths, seizedTiles, onClaim, onSeize } = args;

  // CLAIM heuristic — fire when player has >=3 spawns and bot has claim tokens
  const playerSpawns = spawnPoints.filter((s) => s.ownerId === PLAYER);
  if (tokens.bot.claim > 0 && playerSpawns.length >= 3) {
    // Target the player spawn whose matching dest has highest demand
    let target: SpawnPoint | null = null;
    let bestDemand = -1;
    for (const sp of playerSpawns) {
      const dest = destPoints.find((d) => d.color === sp.color && d.ownerId === PLAYER);
      if (!dest) continue;
      if (dest.demand > bestDemand) {
        bestDemand = dest.demand;
        target = sp;
      }
    }
    if (target && bestDemand >= 2) {
      onClaim(target.id);
      return;
    }
  }

  // SEIZE heuristic — fire when bot has seize tokens and there's a player road tile
  // that's blocking a bot spawn-dest manhattan corridor
  if (tokens.bot.seize > 0) {
    const playerTiles: string[] = [];
    for (const path of paths) {
      if (path.ownerId !== PLAYER) continue;
      for (const p of path.points) {
        const k = posKey(p);
        if (seizedTiles.has(k)) continue;
        playerTiles.push(k);
      }
    }
    if (playerTiles.length === 0) return;

    // Pick player tile closest to any bot spawn (proxy for "in our way")
    const botSpawns = spawnPoints.filter((s) => s.ownerId === BOT);
    if (botSpawns.length === 0) return;

    let bestKey: string | null = null;
    let bestDist = Infinity;
    for (const tk of playerTiles) {
      const [x, z] = tk.split(",").map(Number) as [number, number];
      for (const sp of botSpawns) {
        const d = heuristic([x, z], sp.position);
        if (d < bestDist) { bestDist = d; bestKey = tk; }
      }
    }
    if (bestKey && bestDist <= 5) {
      onSeize(bestKey);
      return;
    }
  }
}

/**
 * Evaluate treaty proposal on `targetPath` for `evaluator` side.
 * Accepts iff that side has spawn/dest within `radius` of any path tile.
 */
function evaluateTreatyFor(
  evaluator: OwnerId,
  targetPath: Path,
  spawnPoints: SpawnPoint[],
  destPoints: DestinationPoint[],
  radius = 4,
): boolean {
  const points: [number, number][] = [
    ...spawnPoints.filter((s) => s.ownerId === evaluator).map((s) => s.position),
    ...destPoints.filter((d) => d.ownerId === evaluator).map((d) => d.position),
  ];
  if (points.length === 0) return false;

  for (const tile of targetPath.points) {
    for (const p of points) {
      if (heuristic(tile, p) <= radius) return true;
    }
  }
  return false;
}

function botEvaluateTreaty(
  targetPath: Path,
  spawnPoints: SpawnPoint[],
  destPoints: DestinationPoint[],
  radius = 4,
): boolean {
  return evaluateTreatyFor(BOT, targetPath, spawnPoints, destPoints, radius);
}

/**
 * Bot picks a player path that bot would benefit from + that player would
 * plausibly accept (player has spawns/dests near it). Fires occasionally.
 */
function botProposeTreaty(args: {
  paths: Path[];
  treatiedTiles: Set<string>;
  spawnPoints: SpawnPoint[];
  destPoints: DestinationPoint[];
  onPropose: (path: Path, accepted: boolean) => void;
}) {
  // Random gate so bot doesn't spam treaties — ~25% chance per decision tick
  if (Math.random() > 0.25) return;

  const { paths, treatiedTiles, spawnPoints, destPoints, onPropose } = args;

  // Candidate paths: player-owned, not already fully treatied, that bot would use
  const candidates = paths.filter((p) => {
    if (p.ownerId !== PLAYER) return false;
    const allTreatied = p.points.every((pt) => treatiedTiles.has(posKey(pt)));
    if (allTreatied) return false;
    return botEvaluateTreaty(p, spawnPoints, destPoints);
  });

  if (candidates.length === 0) return;

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  // Player auto-accepts bot proposals — speed bonus is incentive enough for prototype.
  // (Future: surface accept/reject UI button to player.)
  onPropose(target, true);
}

// --- Config ---

export interface GameConfig {
  agentSpeed: number;
  spawnInterval: number;
  demandInterval: number;
  newPairInterval: number;
  maxDemand: number;
  botEnabled: boolean;
  botDecisionInterval: number;
  crossOwnerPlanningPenalty: number;
  crossOwnerSpeedMult: number;
  treatySpeedMult: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  agentSpeed: AGENT_SPEED,
  spawnInterval: INITIAL_SPAWN_INTERVAL,
  demandInterval: INITIAL_DEMAND_INTERVAL,
  newPairInterval: NEW_PAIR_INTERVAL,
  maxDemand: 7,
  botEnabled: true,
  botDecisionInterval: 2.5,
  crossOwnerPlanningPenalty: 0.5,
  crossOwnerSpeedMult: 0.7,
  treatySpeedMult: 1.15,
};

// --- Main Game Component ---

export interface GameUiState {
  pathCount: number;
  pending: boolean;
  score: DualScore;
  gameOver: boolean;
  tokens: DualTokens;
  mode: ClickMode;
  treatyResult: TreatyResult;
  stats: DualStats;
}

export interface GameHandlers {
  clear: () => void;
  undo: () => void;
  setMode: (m: ClickMode) => void;
}

interface GameGridProps {
  config: GameConfig;
  onStateChange: (state: GameUiState, handlers: GameHandlers) => void;
}

export function GameGrid({ config, onStateChange }: GameGridProps) {
  const [paths, setPaths] = useState<Path[]>([]);
  const [pendingStart, setPendingStart] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const planeRef = useRef<THREE.Mesh>(null);
  const agentsRef = useRef<Agent[]>([]);
  const scoreRef = useRef<DualScore>({ player: 0, bot: 0 });
  const gameOverRef = useRef(false);
  const newPairTimerRef = useRef(NEW_PAIR_INTERVAL);
  const botTimerRef = useRef(2);
  const [seizedTiles, setSeizedTiles] = useState<Map<string, OwnerId>>(new Map());
  const [treatiedTiles, setTreatiedTiles] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<DualTokens>(() => ({
    player: { ...INITIAL_TOKENS.player },
    bot: { ...INITIAL_TOKENS.bot },
  }));
  const [mode, setMode] = useState<ClickMode>("build");
  const [treatyResult, setTreatyResult] = useState<TreatyResult>(null);
  const treatyResultTimerRef = useRef<number | null>(null);
  const [stats, setStats] = useState<DualStats>(() => ({
    player: { ...EMPTY_STATS },
    bot: { ...EMPTY_STATS },
  }));

  // --- Intro animation state ---
  const [introPhase, setIntroPhase] = useState<IntroPhase>("grid");
  const introTimerRef = useRef(0);
  const [gridProgress, setGridProgress] = useState(0);
  const [spawnScales, setSpawnScales] = useState<number[]>([]);
  const [destScales, setDestScales] = useState<number[]>([]);

  // Generate spawn/destination pairs once
  const [spawnPoints, setSpawnPoints] = useState<SpawnPoint[]>([]);
  const [destPoints, setDestPoints] = useState<DestinationPoint[]>([]);

  // Initialize points on first render — 2 pairs per owner (4 total)
  useEffect(() => {
    const { spawns, destinations } = generateInitialPairs(2);
    setSpawnPoints(spawns);
    setDestPoints(destinations);
  }, []);

  // Build occupied set including spawn/dest positions
  const pointPositions = useMemo(() => {
    const set = new Set<string>();
    for (const sp of spawnPoints) set.add(posKey(sp.position));
    for (const dp of destPoints) set.add(posKey(dp.position));
    return set;
  }, [spawnPoints, destPoints]);

  const tileOwners = useMemo(() => buildTileOwners(paths, seizedTiles, treatiedTiles), [paths, seizedTiles, treatiedTiles]);

  const handleClear = useCallback(() => {
    setPaths([]);
    setPendingStart(null);
    agentsRef.current = [];
    scoreRef.current = { player: 0, bot: 0 };
    gameOverRef.current = false;
    newPairTimerRef.current = NEW_PAIR_INTERVAL;
    botTimerRef.current = 2;
    setSeizedTiles(new Map());
    setTreatiedTiles(new Set());
    setTokens({
      player: { ...INITIAL_TOKENS.player },
      bot: { ...INITIAL_TOKENS.bot },
    });
    setMode("build");
    setTreatyResult(null);
    setStats({
      player: { ...EMPTY_STATS },
      bot: { ...EMPTY_STATS },
    });
    // Reset intro animation
    setIntroPhase("grid");
    introTimerRef.current = 0;
    setGridProgress(0);
    setSpawnScales([]);
    setDestScales([]);
    // Re-generate points
    const { spawns, destinations } = generateInitialPairs(2);
    setSpawnPoints(spawns);
    setDestPoints(destinations);
  }, []);

  const handleUndo = useCallback(() => {
    setPaths((prev) => {
      // Walk backwards, skip locked paths (any tile in seizedTiles or treatiedTiles)
      for (let i = prev.length - 1; i >= 0; i--) {
        const p = prev[i];
        if (p.ownerId !== PLAYER) continue;
        const locked = p.points.some((pt) => {
          const k = posKey(pt);
          return seizedTiles.has(k) || treatiedTiles.has(k);
        });
        if (locked) continue;
        const next = [...prev.slice(0, i), ...prev.slice(i + 1)];
        agentsRef.current = agentsRef.current.filter(
          (a) => next.some((q) => q.id === a.pathId)
        );
        return next;
      }
      return prev;
    });
  }, [seizedTiles, treatiedTiles]);

  // Sync state up to parent
  useEffect(() => {
    onStateChange(
      {
        pathCount: paths.length,
        pending: !!pendingStart,
        score: { ...scoreRef.current },
        gameOver: gameOverRef.current,
        tokens,
        mode,
        treatyResult,
        stats,
      },
      { clear: handleClear, undo: handleUndo, setMode },
    );
  }, [paths.length, pendingStart, onStateChange, handleClear, handleUndo, tokens, mode, treatyResult, stats]);

  // --- Intro animation tick ---
  useFrame((_, delta) => {
    if (introPhase === "done") return;

    introTimerRef.current += delta;
    const t = introTimerRef.current;

    if (introPhase === "grid") {
      const p = Math.min(t / INTRO_GRID_DURATION, 1);
      setGridProgress(p);
      if (p >= 1) {
        setIntroPhase("spawners");
        introTimerRef.current = 0;
        setSpawnScales(spawnPoints.map(() => 0));
      }
    } else if (introPhase === "spawners") {
      const scales = spawnPoints.map((_, i) => {
        const startTime = i * INTRO_SPAWN_STAGGER;
        const elapsed = Math.max(0, t - startTime);
        const raw = Math.min(elapsed / INTRO_SPAWN_DURATION, 1);
        return easeOutBack(raw);
      });
      setSpawnScales(scales);
      const totalDuration = (spawnPoints.length - 1) * INTRO_SPAWN_STAGGER + INTRO_SPAWN_DURATION;
      if (t >= totalDuration) {
        setIntroPhase("destinations");
        introTimerRef.current = 0;
        setDestScales(destPoints.map(() => 0));
      }
    } else if (introPhase === "destinations") {
      const scales = destPoints.map((_, i) => {
        const startTime = i * INTRO_DEST_STAGGER;
        const elapsed = Math.max(0, t - startTime);
        const raw = Math.min(elapsed / INTRO_DEST_DURATION, 1);
        return easeOutBack(raw);
      });
      setDestScales(scales);
      const totalDuration = (destPoints.length - 1) * INTRO_DEST_STAGGER + INTRO_DEST_DURATION;
      if (t >= totalDuration) {
        setIntroPhase("done");
      }
    }
  });

  // --- Game tick: spawn agents + accumulate demand ---
  useFrame((_, delta) => {
    if (introPhase !== "done") return;
    if (gameOverRef.current) return;

    // Update demand on destinations
    for (const dest of destPoints) {
      dest.demandTimer -= delta;
      if (dest.demandTimer <= 0) {
        dest.demandTimer = dest.demandInterval;
        dest.demand += 1;

        if (dest.demand >= dest.maxDemand) {
          gameOverRef.current = true;
          onStateChange(
            {
              pathCount: paths.length,
              pending: !!pendingStart,
              score: { ...scoreRef.current },
              gameOver: true,
              tokens,
              mode,
              treatyResult,
              stats,
            },
            { clear: handleClear, undo: handleUndo, setMode },
          );
          return;
        }
      }
    }

    // Periodically add new spawn/dest pair to increase difficulty — alternate owners
    newPairTimerRef.current -= delta;
    if (newPairTimerRef.current <= 0) {
      newPairTimerRef.current = config.newPairInterval;
      const used = new Set<string>();
      for (const sp of spawnPoints) used.add(posKey(sp.position));
      for (const dp of destPoints) used.add(posKey(dp.position));
      for (const path of paths) {
        for (const p of path.points) used.add(posKey(p));
      }
      const owner: OwnerId = (spawnPoints.length % 2) as OwnerId;
      const colorIdx = Math.floor(spawnPoints.length / 2);
      const { spawn, destination } = generatePair(owner, colorIdx, used);
      // Apply runtime config intervals
      spawn.spawnTimer = config.spawnInterval;
      spawn.spawnInterval = config.spawnInterval;
      destination.maxDemand = config.maxDemand;
      destination.demandTimer = config.demandInterval;
      destination.demandInterval = config.demandInterval;

      setSpawnPoints((prev) => [...prev, spawn]);
      setDestPoints((prev) => [...prev, destination]);
    }

    // Spawn agents from spawn points that have connected paths
    for (const spawn of spawnPoints) {
      const connection = findConnectingPath(spawn, destPoints, paths);
      if (!connection) continue;

      // Only spawn if destination has demand
      if (connection.dest.demand <= 0) continue;

      spawn.spawnTimer -= delta;
      if (spawn.spawnTimer <= 0) {
        spawn.spawnTimer = spawn.spawnInterval;

        agentsRef.current.push({
          id: crypto.randomUUID(),
          pathId: connection.path.id,
          progress: connection.spawnAtStart ? 0 : connection.path.points.length - 1,
          speed: config.agentSpeed,
          forward: connection.spawnAtStart,
          color: spawn.color,
          ownerId: spawn.ownerId,
          spawnId: spawn.id,
          destId: connection.dest.id,
          returning: false,
        });
      }
    }

    // Check agents reaching destinations
    const toRemove: string[] = [];
    for (const agent of agentsRef.current) {
      const path = paths.find((p) => p.id === agent.pathId);
      if (!path) { toRemove.push(agent.id); continue; }

      if (!agent.returning) {
        // Heading to destination
        const atEnd = agent.forward
          ? agent.progress >= path.points.length - 1 - 0.05
          : agent.progress <= 0.05;

        if (atEnd) {
          // Arrived at destination — reduce demand, score point for agent's owner
          const dest = destPoints.find((d) => d.id === agent.destId);
          if (dest && dest.demand > 0) {
            dest.demand -= 1;
            if (agent.ownerId === PLAYER) scoreRef.current.player += 1;
            else scoreRef.current.bot += 1;
            onStateChange(
              {
                pathCount: paths.length,
                pending: !!pendingStart,
                score: { ...scoreRef.current },
                gameOver: false,
                tokens,
                mode,
                treatyResult,
                stats,
              },
              { clear: handleClear, undo: handleUndo, setMode },
            );
          }
          // Start returning
          agent.returning = true;
          agent.forward = !agent.forward;
        }
      } else {
        // Returning to spawn
        const atHome = agent.forward
          ? agent.progress >= path.points.length - 1 - 0.05
          : agent.progress <= 0.05;

        if (atHome) {
          toRemove.push(agent.id);
        }
      }
    }

    if (toRemove.length > 0) {
      agentsRef.current = agentsRef.current.filter((a) => !toRemove.includes(a.id));
    }
  });

  // --- Bot decision tick ---
  useFrame((_, delta) => {
    if (introPhase !== "done" || gameOverRef.current) return;
    if (!config.botEnabled) return;

    botTimerRef.current -= delta;
    if (botTimerRef.current > 0) return;
    botTimerRef.current = config.botDecisionInterval;

    const newRoads = botGreedyConnect(spawnPoints, destPoints, paths, pointPositions, config.crossOwnerPlanningPenalty);
    if (newRoads.length > 0) {
      setPaths((prev) => [...prev, ...newRoads]);
      setStats((s) => ({ ...s, bot: { ...s.bot, pathsBuilt: s.bot.pathsBuilt + newRoads.length } }));
    }

    // Bot token use — fires once per decision tick if heuristic matches
    botUseTokens({
      tokens,
      spawnPoints,
      destPoints,
      paths,
      seizedTiles,
      onClaim: (spawnId) => {
        setSpawnPoints((prev) => prev.filter((s) => s.id !== spawnId));
        agentsRef.current = agentsRef.current.filter((a) => a.spawnId !== spawnId);
        setTokens((t) => ({ ...t, bot: { ...t.bot, claim: t.bot.claim - 1 } }));
        setStats((s) => ({ ...s, bot: { ...s.bot, claimsUsed: s.bot.claimsUsed + 1 } }));
      },
      onSeize: (tileKey) => {
        setSeizedTiles((prev) => {
          const next = new Map(prev);
          next.set(tileKey, BOT);
          return next;
        });
        setTokens((t) => ({ ...t, bot: { ...t.bot, seize: t.bot.seize - 1 } }));
        setStats((s) => ({ ...s, bot: { ...s.bot, seizesUsed: s.bot.seizesUsed + 1 } }));
      },
    });

    // Bot proposes treaty (Phase F): occasional, on a player path near bot network
    botProposeTreaty({
      paths,
      treatiedTiles,
      spawnPoints,
      destPoints,
      onPropose: (path, accepted) => {
        if (accepted) {
          setTreatiedTiles((prev) => {
            const next = new Set(prev);
            for (const pt of path.points) next.add(posKey(pt));
            return next;
          });
        }
        setStats((s) => ({
          ...s,
          bot: {
            ...s.bot,
            treatiesProposed: s.bot.treatiesProposed + 1,
            treatiesAccepted: s.bot.treatiesAccepted + (accepted ? 1 : 0),
            treatiesRejected: s.bot.treatiesRejected + (accepted ? 0 : 1),
          },
        }));
        setTreatyResult(accepted ? "accepted" : "rejected");
        if (treatyResultTimerRef.current !== null) {
          clearTimeout(treatyResultTimerRef.current);
        }
        treatyResultTimerRef.current = window.setTimeout(() => {
          setTreatyResult(null);
          treatyResultTimerRef.current = null;
        }, 2200);
      },
    });
  });

  const previewResult = useMemo(() => {
    if (!pendingStart || !hover) return null;
    if (pendingStart[0] === hover[0] && pendingStart[1] === hover[1]) return null;
    const hoverKey = posKey(hover);
    const isEndOnPoint = pointPositions.has(hoverKey);
    // Block endpoint on any existing road tile
    if (tileOwners.has(hoverKey) && !isEndOnPoint) return { path: null, blocked: true };
    const path = findPath(pendingStart, hover, pointPositions, tileOwners, PLAYER, config.crossOwnerPlanningPenalty);
    return { path, blocked: path === null };
  }, [pendingStart, hover, tileOwners, pointPositions, config.crossOwnerPlanningPenalty]);

  const previewColor = previewResult?.blocked
    ? "#ff0000"
    : PATH_COLOR;

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const snapped = snapToGrid(e.point.x, e.point.z);
    setHover(snapped);
  }, []);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (introPhase !== "done") return;
      if (gameOverRef.current) return;
      e.stopPropagation();
      const snapped = snapToGrid(e.point.x, e.point.z);
      const cellKey = posKey(snapped);
      const isOnPoint = pointPositions.has(cellKey);

      // --- CLAIM mode: target opp spawn, remove it ---
      if (mode === "claim") {
        if (tokens.player.claim <= 0) { setMode("build"); return; }
        const target = spawnPoints.find(
          (s) => posEqual(s.position, snapped) && s.ownerId !== PLAYER,
        );
        if (!target) return;
        setSpawnPoints((prev) => prev.filter((s) => s.id !== target.id));
        // Remove agents from that spawn
        agentsRef.current = agentsRef.current.filter((a) => a.spawnId !== target.id);
        setTokens((t) => ({ ...t, player: { ...t.player, claim: t.player.claim - 1 } }));
        setStats((s) => ({ ...s, player: { ...s.player, claimsUsed: s.player.claimsUsed + 1 } }));
        setMode("build");
        return;
      }

      // --- TREATY mode: propose mutual sharing on a path ---
      if (mode === "treaty") {
        const targetPath = paths.find((p) => p.points.some((pt) => posEqual(pt, snapped)));
        if (!targetPath) return;
        // Skip already fully-treatied paths
        const allAlready = targetPath.points.every((pt) => treatiedTiles.has(posKey(pt)));
        if (allAlready) return;

        const accepted = botEvaluateTreaty(targetPath, spawnPoints, destPoints);
        if (accepted) {
          setTreatiedTiles((prev) => {
            const next = new Set(prev);
            for (const pt of targetPath.points) next.add(posKey(pt));
            return next;
          });
        }
        setStats((s) => ({
          ...s,
          player: {
            ...s.player,
            treatiesProposed: s.player.treatiesProposed + 1,
            treatiesAccepted: s.player.treatiesAccepted + (accepted ? 1 : 0),
            treatiesRejected: s.player.treatiesRejected + (accepted ? 0 : 1),
          },
        }));
        setTreatyResult(accepted ? "accepted" : "rejected");
        if (treatyResultTimerRef.current !== null) {
          clearTimeout(treatyResultTimerRef.current);
        }
        treatyResultTimerRef.current = window.setTimeout(() => {
          setTreatyResult(null);
          treatyResultTimerRef.current = null;
        }, 2200);
        setMode("build");
        return;
      }

      // --- SEIZE mode: target opp road tile, lock + co-own ---
      if (mode === "seize") {
        if (tokens.player.seize <= 0) { setMode("build"); return; }
        const owners = tileOwners.get(cellKey);
        // Must be a tile owned only by opponent (not already shared, not your own)
        if (!owners || owners.has(PLAYER) || owners.size === 0) return;
        if (seizedTiles.has(cellKey)) return;
        setSeizedTiles((prev) => {
          const next = new Map(prev);
          next.set(cellKey, PLAYER);
          return next;
        });
        setTokens((t) => ({ ...t, player: { ...t.player, seize: t.player.seize - 1 } }));
        setStats((s) => ({ ...s, player: { ...s.player, seizesUsed: s.player.seizesUsed + 1 } }));
        setMode("build");
        return;
      }

      // --- BUILD mode (default) ---
      if (!pendingStart) {
        if (tileOwners.has(cellKey) && !isOnPoint) return;
        setPendingStart(snapped);
      } else {
        if (snapped[0] === pendingStart[0] && snapped[1] === pendingStart[1]) {
          setPendingStart(null);
          return;
        }

        if (tileOwners.has(cellKey) && !isOnPoint) return;

        const pathPoints = findPath(pendingStart, snapped, pointPositions, tileOwners, PLAYER, config.crossOwnerPlanningPenalty);
        if (!pathPoints) return;

        const color = PATH_COLOR;
        const pathId = crypto.randomUUID();
        setPaths((prev) => [
          ...prev,
          { id: pathId, points: pathPoints, color, ownerId: PLAYER },
        ]);
        setStats((s) => ({ ...s, player: { ...s.player, pathsBuilt: s.player.pathsBuilt + 1 } }));
        setPendingStart(null);
      }
    },
    [pendingStart, paths, pointPositions, tileOwners, introPhase, config.crossOwnerPlanningPenalty, mode, tokens.player.claim, tokens.player.seize, spawnPoints, destPoints, seizedTiles, treatiedTiles]
  );

  return (
    <>
      {/* Clickable ground plane */}
      <mesh
        ref={planeRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <planeGeometry args={[GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE]} />
        <meshStandardMaterial color={GROUND_COLOR} roughness={1} />
      </mesh>

      <GridLines progress={gridProgress} />

      {/* Hover indicator */}
      {introPhase === "done" && (
        <HoverCell
          position={hover}
          tint={
            mode === "claim" ? "#ff8a3c" :
            mode === "seize" ? "#a86bff" :
            mode === "treaty" ? "#5be0a6" :
            undefined
          }
        />
      )}

      {/* Pending start marker */}
      {pendingStart && <Marker position={pendingStart} color="#ff6b9d" />}

      {/* Preview path */}
      {previewResult?.path && <PathLine path={previewResult.path} color={previewColor} opacity={0.4} />}
      {previewResult?.blocked && hover && <HoverCell position={hover} blocked />}

      {/* Spawn points (houses) */}
      {(introPhase === "spawners" || introPhase === "destinations" || introPhase === "done") &&
        spawnPoints.map((sp, i) => (
          <SpawnPointMesh key={sp.id} point={sp} scale={introPhase === "done" ? 1 : (spawnScales[i] ?? 0)} />
        ))}

      {/* Destination points (buildings) */}
      {(introPhase === "destinations" || introPhase === "done") &&
        destPoints.map((dp, i) => (
          <DestinationPointMesh key={dp.id} point={dp} scale={introPhase === "done" ? 1 : (destScales[i] ?? 0)} />
        ))}

      {/* Paths */}
      {paths.map((p) => (
        <group key={p.id}>
          <PathLine path={p.points} color={p.color} edgeColor={ROAD_EDGE_BY_OWNER[p.ownerId]} />
        </group>
      ))}

      {/* Seized tile markers */}
      {Array.from(seizedTiles.entries()).map(([k, seizer]) => {
        const [x, z] = k.split(",").map(Number) as [number, number];
        return <SeizedMarker key={k} position={[x, z]} color={seizer === PLAYER ? "#a86bff" : "#ff8a3c"} />;
      })}

      {/* Treaty tile markers */}
      {Array.from(treatiedTiles).map((k) => {
        const [x, z] = k.split(",").map(Number) as [number, number];
        return <TreatyMarker key={`t-${k}`} position={[x, z]} />;
      })}

      {/* Traveling agents */}
      {agentsRef.current.map((agent) => {
        const path = paths.find((p) => p.id === agent.pathId);
        if (!path || path.points.length < 2) return null;
        return <AgentMesh key={agent.id} agent={agent} path={path.points} tileOwners={tileOwners} treatiedTiles={treatiedTiles} speedMult={config.crossOwnerSpeedMult} treatyMult={config.treatySpeedMult} />;
      })}
    </>
  );
}

// --- Overlay ---

export function GameOverlay({
  pathCount,
  pending,
  onClear,
  onUndo,
  score,
  gameOver,
  tokens,
  mode,
  onSetMode,
  treatyResult,
  username,
  onLogout,
  onLeaderboard,
}: {
  pathCount: number;
  pending: boolean;
  onClear: () => void;
  onUndo: () => void;
  score: DualScore;
  gameOver: boolean;
  tokens: DualTokens;
  mode: ClickMode;
  onSetMode: (m: ClickMode) => void;
  treatyResult: TreatyResult;
  username?: string;
  onLogout?: () => void;
  onLeaderboard?: () => void;
}) {
  const winner =
    score.player > score.bot ? "YOU WIN" :
    score.player < score.bot ? "BOT WINS" :
    "TIE";
  const modeHint =
    mode === "claim" ? "CLAIM mode — click opponent spawn" :
    mode === "seize" ? "SEIZE mode — click opponent road tile" :
    mode === "treaty" ? "TREATY mode — click any road tile to propose" :
    pending ? "Click to set endpoint" : "Click to set start point";
  return (
    <div style={overlayStyles.container}>
      <div style={overlayStyles.info}>
        {username && (
          <span style={{ color: "#6c5ce7", marginRight: "8px" }}>{username}</span>
        )}
        {gameOver ? (
          <span style={{ color: "#ff4444", fontWeight: "bold" }}>
            GAME OVER — {winner}
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <span>{modeHint}</span>
            <span style={{ color: "#556677" }}>·</span>
            <span>Paths: {pathCount}</span>
            <span style={{ color: "#556677" }}>·</span>
            <ScoreBar player={score.player} bot={score.bot} />
            <span style={{ color: "#556677" }}>·</span>
            <span style={{ color: "#ff8a3c" }}>◆ {tokens.player.claim}</span>
            <span style={{ color: "#a86bff" }}>● {tokens.player.seize}</span>
            {treatyResult && (
              <span style={{ color: treatyResult === "accepted" ? "#5be0a6" : "#ff8a8a", fontWeight: "bold" }}>
                {treatyResult === "accepted" ? "TREATY ACCEPTED" : "TREATY REJECTED"}
              </span>
            )}
          </div>
        )}
      </div>
      <div style={overlayStyles.buttons}>
        <button
          style={modeBtnStyle(mode === "claim", "#ff8a3c")}
          disabled={tokens.player.claim === 0 || gameOver}
          onClick={() => onSetMode(mode === "claim" ? "build" : "claim")}
        >
          Claim ({tokens.player.claim})
        </button>
        <button
          style={modeBtnStyle(mode === "seize", "#a86bff")}
          disabled={tokens.player.seize === 0 || gameOver}
          onClick={() => onSetMode(mode === "seize" ? "build" : "seize")}
        >
          Seize ({tokens.player.seize})
        </button>
        <button
          style={modeBtnStyle(mode === "treaty", "#5be0a6")}
          disabled={gameOver}
          onClick={() => onSetMode(mode === "treaty" ? "build" : "treaty")}
        >
          Treaty
        </button>
        <button style={overlayStyles.btn} onClick={onUndo} disabled={pathCount === 0}>
          Undo
        </button>
        <button style={overlayStyles.btn} onClick={onClear}>
          {gameOver ? "New Game" : "Clear All"}
        </button>
        {onLeaderboard && (
          <button style={overlayStyles.btn} onClick={onLeaderboard}>
            Scores
          </button>
        )}
        {onLogout && (
          <button style={{ ...overlayStyles.btn, marginLeft: "8px" }} onClick={onLogout}>
            Logout
          </button>
        )}
      </div>
    </div>
  );
}

const overlayStyles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.5rem 1rem",
    background: "rgba(15,25,35,0.85)",
    borderBottom: "1px solid #1e3044",
  },
  info: {
    fontSize: "14px",
    color: "#8899aa",
  },
  buttons: {
    display: "flex",
    gap: "8px",
  },
  btn: {
    padding: "4px 12px",
    borderRadius: "4px",
    border: "1px solid #2a3a4a",
    background: "#1b2838",
    color: "#8899aa",
    cursor: "pointer",
    fontSize: "13px",
  },
};

function ScoreBar({ player, bot }: { player: number; bot: number }) {
  const total = Math.max(player + bot, 1);
  const playerPct = (player / total) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ color: PLAYER_COLORS[0], fontWeight: 600, minWidth: "20px", textAlign: "right" }}>{player}</span>
      <div style={{ width: "120px", height: "8px", borderRadius: "4px", background: "#1b2838", overflow: "hidden", display: "flex" }}>
        <div style={{ width: `${playerPct}%`, background: PLAYER_COLORS[0], transition: "width 0.3s" }} />
        <div style={{ width: `${100 - playerPct}%`, background: BOT_COLORS[0], transition: "width 0.3s" }} />
      </div>
      <span style={{ color: BOT_COLORS[0], fontWeight: 600, minWidth: "20px" }}>{bot}</span>
    </div>
  );
}

// --- End Game Modal ---

export function EndGameModal({
  score,
  stats,
  onRestart,
}: {
  score: DualScore;
  stats: DualStats;
  onRestart: () => void;
}) {
  const winner =
    score.player > score.bot ? "YOU WIN" :
    score.player < score.bot ? "BOT WINS" :
    "TIE";
  const winnerColor =
    score.player > score.bot ? PLAYER_COLORS[0] :
    score.player < score.bot ? BOT_COLORS[0] :
    "#aaa";

  return (
    <div style={modalStyles.backdrop}>
      <div style={modalStyles.box}>
        <div style={{ ...modalStyles.title, color: winnerColor }}>{winner}</div>
        <div style={modalStyles.scoreRow}>
          <div style={{ color: PLAYER_COLORS[0] }}>You: {score.player}</div>
          <div style={{ color: "#666" }}>vs</div>
          <div style={{ color: BOT_COLORS[0] }}>Bot: {score.bot}</div>
        </div>
        <table style={modalStyles.statsTable}>
          <thead>
            <tr>
              <th style={modalStyles.statTh}></th>
              <th style={{ ...modalStyles.statTh, color: PLAYER_COLORS[0] }}>You</th>
              <th style={{ ...modalStyles.statTh, color: BOT_COLORS[0] }}>Bot</th>
            </tr>
          </thead>
          <tbody>
            <StatRow label="Paths built" p={stats.player.pathsBuilt} b={stats.bot.pathsBuilt} />
            <StatRow label="Claims used" p={stats.player.claimsUsed} b={stats.bot.claimsUsed} />
            <StatRow label="Seizes used" p={stats.player.seizesUsed} b={stats.bot.seizesUsed} />
            <StatRow label="Treaties proposed" p={stats.player.treatiesProposed} b={stats.bot.treatiesProposed} />
            <StatRow label="Treaties accepted" p={stats.player.treatiesAccepted} b={stats.bot.treatiesAccepted} />
            <StatRow label="Treaties rejected" p={stats.player.treatiesRejected} b={stats.bot.treatiesRejected} />
          </tbody>
        </table>
        <button style={modalStyles.restartBtn} onClick={onRestart}>Play Again</button>
      </div>
    </div>
  );
}

function StatRow({ label, p, b }: { label: string; p: number; b: number }) {
  return (
    <tr>
      <td style={modalStyles.statLabel}>{label}</td>
      <td style={modalStyles.statCell}>{p}</td>
      <td style={modalStyles.statCell}>{b}</td>
    </tr>
  );
}

const modalStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(8,14,20,0.78)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  box: {
    background: "#0f1923",
    border: "1px solid #2a3a4a",
    borderRadius: "8px",
    padding: "28px 36px",
    minWidth: "340px",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
    color: "#cdd5dd",
    fontFamily: "system-ui",
  },
  title: {
    fontSize: "26px",
    fontWeight: 700,
    textAlign: "center",
    marginBottom: "12px",
    letterSpacing: "1px",
  },
  scoreRow: {
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    fontSize: "20px",
    fontWeight: 600,
    marginBottom: "20px",
  },
  statsTable: {
    width: "100%",
    borderCollapse: "collapse",
    marginBottom: "20px",
    fontSize: "13px",
  },
  statTh: {
    textAlign: "right",
    padding: "4px 8px",
    fontWeight: 600,
    borderBottom: "1px solid #2a3a4a",
  },
  statLabel: {
    padding: "4px 8px",
    color: "#8899aa",
  },
  statCell: {
    padding: "4px 8px",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  restartBtn: {
    width: "100%",
    padding: "10px",
    background: "#1b2838",
    border: "1px solid #5b6fff",
    color: "#cdd5dd",
    borderRadius: "4px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  },
};

function modeBtnStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    ...overlayStyles.btn,
    background: active ? accent : "#1b2838",
    color: active ? "#0f1923" : "#8899aa",
    border: `1px solid ${active ? accent : "#2a3a4a"}`,
    fontWeight: active ? "bold" : "normal",
  };
}
