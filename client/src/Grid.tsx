import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const GRID_SIZE = 20;
const CELL_SIZE = 1;
const HALF = (GRID_SIZE * CELL_SIZE) / 2;

// --- Interfaces ---

interface Path {
  id: string;
  points: [number, number][];
  color: string;
}

interface SpawnPoint {
  id: string;
  position: [number, number];
  color: string;
  spawnTimer: number;     // seconds until next agent spawn
  spawnInterval: number;  // seconds between spawns
}

interface DestinationPoint {
  id: string;
  position: [number, number];
  color: string;
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
  spawnId: string;    // which spawn point created this agent
  destId: string;     // target destination
  returning: boolean; // heading back to spawn after delivery
}

const OBJECT_SCALE = 1.2;
const POINT_COLORS = ["#8b7bff", "#2ee0b0", "#ff8a6b", "#4db5ff"];
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

function findPath(
  start: [number, number],
  end: [number, number],
  occupied: Set<string>
): [number, number][] | null {
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
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
  gScore.set(key(start), 0);

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

      if (occupied.has(nk) && nk !== key(start) && nk !== key(end)) continue;

      const tentG = current.g + CELL_SIZE;
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

/** Generate initial spawn/destination pairs with some distance between them */
function generatePointPairs(count: number): { spawns: SpawnPoint[]; destinations: DestinationPoint[] } {
  const used = new Set<string>();
  const spawns: SpawnPoint[] = [];
  const destinations: DestinationPoint[] = [];

  for (let i = 0; i < count; i++) {
    const color = POINT_COLORS[i % POINT_COLORS.length];

    // Place spawn point
    let spawnPos: [number, number];
    let destPos: [number, number];
    let tries = 0;

    do {
      spawnPos = randomGridPos(used);
      // Remove from used temporarily to allow distance check
      used.delete(posKey(spawnPos));
      destPos = randomGridPos(used);
      used.delete(posKey(destPos));
      tries++;
    } while (heuristic(spawnPos, destPos) < 6 && tries < 50);

    used.add(posKey(spawnPos));
    used.add(posKey(destPos));

    spawns.push({
      id: crypto.randomUUID(),
      position: spawnPos,
      color,
      spawnTimer: INITIAL_SPAWN_INTERVAL,
      spawnInterval: INITIAL_SPAWN_INTERVAL,
    });

    destinations.push({
      id: crypto.randomUUID(),
      position: destPos,
      color,
      demand: 1,
      maxDemand: 7,
      demandTimer: INITIAL_DEMAND_INTERVAL,
      demandInterval: INITIAL_DEMAND_INTERVAL,
    });
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

function AgentMesh({ agent, path }: { agent: Agent; path: [number, number][] }) {
  const meshRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!meshRef.current || path.length < 2) return;

    const step = agent.speed * delta;
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

function HoverCell({ position, blocked = false }: { position: [number, number] | null; blocked?: boolean }) {
  if (!position) return null;
  return (
    <mesh position={[position[0], 0.02, position[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CELL_SIZE * 0.9, CELL_SIZE * 0.9]} />
      <meshBasicMaterial color={blocked ? "#ff5566" : "#5eb2ff"} transparent opacity={blocked ? 0.55 : 0.4} side={THREE.DoubleSide} />
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

/** Find a path that connects a spawn to a matching destination */
function findConnectingPath(
  spawn: SpawnPoint,
  destinations: DestinationPoint[],
  paths: Path[]
): { path: Path; dest: DestinationPoint; spawnAtStart: boolean } | null {
  const matchingDests = destinations.filter((d) => d.color === spawn.color);

  for (const path of paths) {
    const start = path.points[0];
    const end = path.points[path.points.length - 1];

    for (const dest of matchingDests) {
      // spawn at start, dest at end
      if (posEqual(start, spawn.position) && posEqual(end, dest.position)) {
        return { path, dest, spawnAtStart: true };
      }
      // spawn at end, dest at start
      if (posEqual(end, spawn.position) && posEqual(start, dest.position)) {
        return { path, dest, spawnAtStart: false };
      }
    }
  }

  return null;
}

// --- Config ---

export interface GameConfig {
  agentSpeed: number;
  spawnInterval: number;
  demandInterval: number;
  newPairInterval: number;
  maxDemand: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  agentSpeed: AGENT_SPEED,
  spawnInterval: INITIAL_SPAWN_INTERVAL,
  demandInterval: INITIAL_DEMAND_INTERVAL,
  newPairInterval: NEW_PAIR_INTERVAL,
  maxDemand: 7,
};

// --- Main Game Component ---

interface GameGridProps {
  config: GameConfig;
  onStateChange: (
    pathCount: number,
    pending: boolean,
    clearFn: () => void,
    undoFn: () => void,
    score: number,
    gameOver: boolean,
  ) => void;
}

export function GameGrid({ config, onStateChange }: GameGridProps) {
  const [paths, setPaths] = useState<Path[]>([]);
  const [pendingStart, setPendingStart] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const planeRef = useRef<THREE.Mesh>(null);
  const agentsRef = useRef<Agent[]>([]);
  const scoreRef = useRef(0);
  const gameOverRef = useRef(false);
  const newPairTimerRef = useRef(NEW_PAIR_INTERVAL);

  // --- Intro animation state ---
  const [introPhase, setIntroPhase] = useState<IntroPhase>("grid");
  const introTimerRef = useRef(0);
  const [gridProgress, setGridProgress] = useState(0);
  const [spawnScales, setSpawnScales] = useState<number[]>([]);
  const [destScales, setDestScales] = useState<number[]>([]);

  // Generate spawn/destination pairs once
  const [spawnPoints, setSpawnPoints] = useState<SpawnPoint[]>([]);
  const [destPoints, setDestPoints] = useState<DestinationPoint[]>([]);

  // Initialize points on first render
  useEffect(() => {
    const { spawns, destinations } = generatePointPairs(3);
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

  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const path of paths) {
      for (const p of path.points) {
        set.add(posKey(p));
      }
    }
    return set;
  }, [paths]);

  // For pathfinding, roads can't overlap but CAN start/end on spawn/dest points
  const pathfindingOccupied = useMemo(() => {
    const set = new Set(occupied);
    // Block spawn/dest positions so paths can't route through them
    // (findPath already allows start/end on occupied cells)
    for (const key of pointPositions) set.add(key);
    return set;
  }, [occupied, pointPositions]);

  const handleClear = useCallback(() => {
    setPaths([]);
    setPendingStart(null);
    agentsRef.current = [];
    scoreRef.current = 0;
    gameOverRef.current = false;
    newPairTimerRef.current = NEW_PAIR_INTERVAL;
    // Reset intro animation
    setIntroPhase("grid");
    introTimerRef.current = 0;
    setGridProgress(0);
    setSpawnScales([]);
    setDestScales([]);
    // Re-generate points
    const { spawns, destinations } = generatePointPairs(3);
    setSpawnPoints(spawns);
    setDestPoints(destinations);
  }, []);

  const handleUndo = useCallback(() => {
    setPaths((prev) => {
      const next = prev.slice(0, -1);
      agentsRef.current = agentsRef.current.filter(
        (a) => next.some((p) => p.id === a.pathId)
      );
      return next;
    });
  }, []);

  // Sync state up to parent
  useEffect(() => {
    onStateChange(paths.length, !!pendingStart, handleClear, handleUndo, scoreRef.current, gameOverRef.current);
  }, [paths.length, pendingStart, onStateChange, handleClear, handleUndo]);

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
          onStateChange(paths.length, !!pendingStart, handleClear, handleUndo, scoreRef.current, true);
          return;
        }
      }
    }

    // Periodically add new spawn/dest pair to increase difficulty
    newPairTimerRef.current -= delta;
    if (newPairTimerRef.current <= 0) {
      newPairTimerRef.current = config.newPairInterval;
      const used = new Set<string>();
      for (const sp of spawnPoints) used.add(posKey(sp.position));
      for (const dp of destPoints) used.add(posKey(dp.position));
      for (const path of paths) {
        for (const p of path.points) used.add(posKey(p));
      }
      const colorIdx = spawnPoints.length % POINT_COLORS.length;
      const color = POINT_COLORS[colorIdx];
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

      setSpawnPoints((prev) => [...prev, {
        id: crypto.randomUUID(),
        position: spawnPos,
        color,
        spawnTimer: config.spawnInterval,
        spawnInterval: config.spawnInterval,
      }]);
      setDestPoints((prev) => [...prev, {
        id: crypto.randomUUID(),
        position: destPos,
        color,
        demand: 1,
        maxDemand: config.maxDemand,
        demandTimer: config.demandInterval,
        demandInterval: config.demandInterval,
      }]);
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
          // Arrived at destination — reduce demand, score point
          const dest = destPoints.find((d) => d.id === agent.destId);
          if (dest && dest.demand > 0) {
            dest.demand -= 1;
            scoreRef.current += 1;
            onStateChange(paths.length, !!pendingStart, handleClear, handleUndo, scoreRef.current, false);
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

  const previewResult = useMemo(() => {
    if (!pendingStart || !hover) return null;
    if (pendingStart[0] === hover[0] && pendingStart[1] === hover[1]) return null;
    // Allow ending on spawn/dest positions
    const isEndOnPoint = pointPositions.has(posKey(hover));
    if (occupied.has(posKey(hover)) && !isEndOnPoint) return { path: null, blocked: true };
    const path = findPath(pendingStart, hover, pathfindingOccupied);
    return { path, blocked: path === null };
  }, [pendingStart, hover, occupied, pathfindingOccupied, pointPositions]);

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

      if (!pendingStart) {
        // Can start on a spawn/dest point OR empty cell
        if (occupied.has(cellKey) && !isOnPoint) return;
        setPendingStart(snapped);
      } else {
        if (snapped[0] === pendingStart[0] && snapped[1] === pendingStart[1]) {
          setPendingStart(null);
          return;
        }

        if (occupied.has(cellKey) && !isOnPoint) return;

        const pathPoints = findPath(pendingStart, snapped, pathfindingOccupied);
        if (!pathPoints) return;

        const color = PATH_COLOR;
        const pathId = crypto.randomUUID();
        setPaths((prev) => [
          ...prev,
          { id: pathId, points: pathPoints, color },
        ]);
        setPendingStart(null);
      }
    },
    [pendingStart, occupied, paths.length, pointPositions, pathfindingOccupied, introPhase]
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
      {introPhase === "done" && <HoverCell position={hover} />}

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
          <PathLine path={p.points} color={p.color} />
          <Marker position={p.points[0]} color={p.color} />
          <Marker position={p.points[p.points.length - 1]} color={p.color} />
        </group>
      ))}

      {/* Traveling agents */}
      {agentsRef.current.map((agent) => {
        const path = paths.find((p) => p.id === agent.pathId);
        if (!path || path.points.length < 2) return null;
        return <AgentMesh key={agent.id} agent={agent} path={path.points} />;
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
  username,
  onLogout,
  onLeaderboard,
}: {
  pathCount: number;
  pending: boolean;
  onClear: () => void;
  onUndo: () => void;
  score: number;
  gameOver: boolean;
  username?: string;
  onLogout?: () => void;
  onLeaderboard?: () => void;
}) {
  return (
    <div className="bar">
      <div className="bar__info">
        {username && <span className="bar__user">{username}</span>}
        {gameOver ? (
          <span style={{ color: "var(--danger)", fontWeight: "bold" }}>
            GAME OVER — Score: {score}
          </span>
        ) : (
          <>
            <span>{pending ? "Click to set endpoint" : "Click to set start"}</span>
            <span className="bar__sep">|</span>
            <span>Paths: {pathCount}</span>
            <span className="bar__sep">|</span>
            <span>Score: {score}</span>
          </>
        )}
      </div>
      <div className="bar__actions">
        <button className="btn" onClick={onUndo} disabled={pathCount === 0}>
          Undo
        </button>
        <button className="btn" onClick={onClear}>
          {gameOver ? "New Game" : "Clear"}
        </button>
        {onLeaderboard && (
          <button className="btn" onClick={onLeaderboard}>
            Scores
          </button>
        )}
        {onLogout && (
          <button className="btn" onClick={onLogout}>
            Logout
          </button>
        )}
      </div>
    </div>
  );
}
