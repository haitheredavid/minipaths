import { useState, useRef, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { useControls } from "leva";
import { GameGrid, GameOverlay, DEFAULT_CONFIG, type GameConfig } from "./Grid.tsx";

export function App() {
  const [pathCount, setPathCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const clearRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});

  const controls = useControls("Spawning", {
    agentSpeed: { value: DEFAULT_CONFIG.agentSpeed, min: 0.5, max: 10, step: 0.5, label: "Agent Speed" },
    spawnInterval: { value: DEFAULT_CONFIG.spawnInterval, min: 1, max: 20, step: 0.5, label: "Spawn Interval" },
    demandInterval: { value: DEFAULT_CONFIG.demandInterval, min: 1, max: 30, step: 0.5, label: "Demand Interval" },
    newPairInterval: { value: DEFAULT_CONFIG.newPairInterval, min: 5, max: 120, step: 5, label: "New Pair Timer" },
    maxDemand: { value: DEFAULT_CONFIG.maxDemand, min: 3, max: 20, step: 1, label: "Max Demand" },
  });

  const config: GameConfig = useMemo(() => ({
    agentSpeed: controls.agentSpeed,
    spawnInterval: controls.spawnInterval,
    demandInterval: controls.demandInterval,
    newPairInterval: controls.newPairInterval,
    maxDemand: controls.maxDemand,
  }), [controls.agentSpeed, controls.spawnInterval, controls.demandInterval, controls.newPairInterval, controls.maxDemand]);

  return (
    <div style={{ fontFamily: "system-ui", height: "100vh", display: "flex", flexDirection: "column", background: "#0f1923" }}>
      <GameOverlay
        pathCount={pathCount}
        pending={pending}
        onClear={() => { clearRef.current(); setScore(0); setGameOver(false); }}
        onUndo={() => undoRef.current()}
        score={score}
        gameOver={gameOver}
      />
      <Canvas
        style={{ flex: 1 }}
        orthographic
        onCreated={({ gl }) => gl.setClearColor("#0f1923")}
      >
        <OrthographicCamera
          makeDefault
          position={[0, 50, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          zoom={38}
          near={0.1}
          far={200}
        />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 15, 10]} intensity={0.6} />
        <GameGrid
          config={config}
          onStateChange={(count, isPending, clearFn, undoFn, newScore, isGameOver) => {
            setPathCount(count);
            setPending(isPending);
            clearRef.current = clearFn;
            undoRef.current = undoFn;
            setScore(newScore);
            setGameOver(isGameOver);
          }}
        />
      </Canvas>
    </div>
  );
}
