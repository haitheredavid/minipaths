import { useState, useEffect, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { GameGrid, GameOverlay } from "./Grid.tsx";

export function App() {
  const [pathCount, setPathCount] = useState(0);
  const [pending, setPending] = useState(false);
  const clearRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});

  return (
    <div style={{ fontFamily: "system-ui", height: "100vh", display: "flex", flexDirection: "column", background: "#0f1923" }}>
      <GameOverlay
        pathCount={pathCount}
        pending={pending}
        onClear={() => clearRef.current()}
        onUndo={() => undoRef.current()}
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
          onStateChange={(count, isPending, clearFn, undoFn) => {
            setPathCount(count);
            setPending(isPending);
            clearRef.current = clearFn;
            undoRef.current = undoFn;
          }}
        />
      </Canvas>
    </div>
  );
}
