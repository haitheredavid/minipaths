import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const GRID_SIZE = 20;
const CELL_SIZE = 1;
const HALF = (GRID_SIZE * CELL_SIZE) / 2;

interface Path {
  id: string;
  points: [number, number][];
  color: string;
}

const PATH_COLORS = ["#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e", "#e84393"];

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
): [number, number][] {
  // A* on grid
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
      // Reconstruct
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

      // Bounds check
      if (
        next[0] < -HALF + CELL_SIZE / 2 ||
        next[0] > HALF - CELL_SIZE / 2 ||
        next[1] < -HALF + CELL_SIZE / 2 ||
        next[1] > HALF - CELL_SIZE / 2
      ) continue;

      // Skip occupied unless it's start or end
      if (occupied.has(nk) && nk !== key(start) && nk !== key(end)) continue;

      const tentG = current.g + CELL_SIZE;
      if (tentG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, current.pos);
        gScore.set(nk, tentG);
        open.push({ pos: next, g: tentG, f: tentG + heuristic(next, end) });
      }
    }
  }

  // No path found — straight line fallback
  return [start, end];
}

function heuristic(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function GridLines() {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i * CELL_SIZE - HALF;
      pts.push(new THREE.Vector3(pos, 0.01, -HALF), new THREE.Vector3(pos, 0.01, HALF));
      pts.push(new THREE.Vector3(-HALF, 0.01, pos), new THREE.Vector3(HALF, 0.01, pos));
    }
    return pts;
  }, []);

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(points.flatMap((p) => [p.x, p.y, p.z])), 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#ddd" />
    </lineSegments>
  );
}

function buildPathGeometry(path: [number, number][], yHeight: number): THREE.BufferGeometry {
  const width = CELL_SIZE * 0.5;
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

function PathLine({ path, color, opacity = 1 }: { path: [number, number][]; color: string; opacity?: number }) {
  const geometry = useMemo(() => buildPathGeometry(path, 0.05), [path]);

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Marker({ position, color }: { position: [number, number]; color: string }) {
  return (
    <mesh position={[position[0], 0.15, position[1]]}>
      <cylinderGeometry args={[0.2, 0.2, 0.3, 16]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

interface Agent {
  id: string;
  pathId: string;
  progress: number; // 0 → path.length-1, fractional
  speed: number;    // cells per second
  forward: boolean; // direction (ping-pong)
  color: string;
}

const AGENT_SPEED = 2.5;

function AgentMesh({ agent, path }: { agent: Agent; path: [number, number][] }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!meshRef.current || path.length < 2) return;

    // Move progress
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

    // Lerp position between path points
    const idx = Math.floor(agent.progress);
    const frac = agent.progress - idx;
    const curr = path[Math.min(idx, path.length - 1)];
    const next = path[Math.min(idx + 1, path.length - 1)];

    const x = curr[0] + (next[0] - curr[0]) * frac;
    const z = curr[1] + (next[1] - curr[1]) * frac;

    meshRef.current.position.set(x, 0.25, z);

    // Face movement direction
    if (Math.abs(next[0] - curr[0]) > 0.01 || Math.abs(next[1] - curr[1]) > 0.01) {
      const angle = Math.atan2(next[0] - curr[0], next[1] - curr[1]);
      meshRef.current.rotation.y = angle;
    }
  });

  const startPos = path[0];
  return (
    <mesh ref={meshRef} position={[startPos[0], 0.25, startPos[1]]}>
      <boxGeometry args={[0.3, 0.2, 0.4]} />
      <meshStandardMaterial color={agent.color} />
    </mesh>
  );
}

function HoverCell({ position }: { position: [number, number] | null }) {
  if (!position) return null;
  return (
    <mesh position={[position[0], 0.02, position[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CELL_SIZE * 0.9, CELL_SIZE * 0.9]} />
      <meshBasicMaterial color="#b8e6ff" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

interface GameGridProps {
  onStateChange: (
    pathCount: number,
    pending: boolean,
    clearFn: () => void,
    undoFn: () => void,
  ) => void;
}

export function GameGrid({ onStateChange }: GameGridProps) {
  const [paths, setPaths] = useState<Path[]>([]);
  const [pendingStart, setPendingStart] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const planeRef = useRef<THREE.Mesh>(null);
  const agentsRef = useRef<Agent[]>([]);

  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const path of paths) {
      for (const p of path.points) {
        set.add(`${p[0]},${p[1]}`);
      }
    }
    return set;
  }, [paths]);

  const handleClear = useCallback(() => {
    setPaths([]);
    setPendingStart(null);
    agentsRef.current = [];
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
    onStateChange(paths.length, !!pendingStart, handleClear, handleUndo);
  }, [paths.length, pendingStart, onStateChange, handleClear, handleUndo]);

  const previewPath = useMemo(() => {
    if (!pendingStart || !hover) return null;
    if (pendingStart[0] === hover[0] && pendingStart[1] === hover[1]) return null;
    return findPath(pendingStart, hover, occupied);
  }, [pendingStart, hover, occupied]);

  const previewColor = PATH_COLORS[paths.length % PATH_COLORS.length];

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const snapped = snapToGrid(e.point.x, e.point.z);
    setHover(snapped);
  }, []);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const snapped = snapToGrid(e.point.x, e.point.z);

      if (!pendingStart) {
        setPendingStart(snapped);
      } else {
        // Same cell — cancel
        if (snapped[0] === pendingStart[0] && snapped[1] === pendingStart[1]) {
          setPendingStart(null);
          return;
        }

        const pathPoints = findPath(pendingStart, snapped, occupied);
        const color = PATH_COLORS[paths.length % PATH_COLORS.length];
        const pathId = crypto.randomUUID();
        agentsRef.current.push({
          id: crypto.randomUUID(),
          pathId,
          progress: 0,
          speed: AGENT_SPEED,
          forward: true,
          color,
        });
        setPaths((prev) => [
          ...prev,
          { id: pathId, points: pathPoints, color },
        ]);
        setPendingStart(null);
      }
    },
    [pendingStart, occupied, paths.length]
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
        <meshStandardMaterial color="#f5f5f0" />
      </mesh>

      <GridLines />

      {/* Hover indicator */}
      <HoverCell position={hover} />

      {/* Pending start marker */}
      {pendingStart && <Marker position={pendingStart} color="#e84393" />}

      {/* Preview path */}
      {previewPath && <PathLine path={previewPath} color={previewColor} opacity={0.4} />}

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

export function GameOverlay({
  pathCount,
  pending,
  onClear,
  onUndo,
}: {
  pathCount: number;
  pending: boolean;
  onClear: () => void;
  onUndo: () => void;
}) {
  return (
    <div style={overlayStyles.container}>
      <div style={overlayStyles.info}>
        {pending ? "Click to set endpoint" : "Click to set start point"} | Paths: {pathCount}
      </div>
      <div style={overlayStyles.buttons}>
        <button style={overlayStyles.btn} onClick={onUndo} disabled={pathCount === 0}>
          Undo
        </button>
        <button style={overlayStyles.btn} onClick={onClear} disabled={pathCount === 0}>
          Clear All
        </button>
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
    background: "rgba(255,255,255,0.9)",
    borderBottom: "1px solid #ddd",
  },
  info: {
    fontSize: "14px",
    color: "#555",
  },
  buttons: {
    display: "flex",
    gap: "8px",
  },
  btn: {
    padding: "4px 12px",
    borderRadius: "4px",
    border: "1px solid #ccc",
    background: "white",
    cursor: "pointer",
    fontSize: "13px",
  },
};
