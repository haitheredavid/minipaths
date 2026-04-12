import { useState, useEffect, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { Chat } from "./Chat.tsx";
import { GameGrid, GameOverlay } from "./Grid.tsx";

export function App() {
  const [message, setMessage] = useState("");
  const [pathCount, setPathCount] = useState(0);
  const [pending, setPending] = useState(false);
  const clearRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((data) => setMessage(data.message))
      .catch(() => setMessage("Failed to connect to API"));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui", height: "100vh", display: "flex", flexDirection: "column" }}>
      <h1 style={{ margin: "0.5rem 0 0", textAlign: "center", fontSize: "1.5rem" }}>Deno Vibes</h1>
      <p style={{ textAlign: "center", margin: "0.25rem 0" }}>{message || "Loading..."}</p>
      <GameOverlay
        pathCount={pathCount}
        pending={pending}
        onClear={() => clearRef.current()}
        onUndo={() => undoRef.current()}
      />
      <Canvas
        style={{ flex: 1 }}
        orthographic
        onCreated={({ gl }) => gl.setClearColor("#e8e8e0")}
      >
        <OrthographicCamera
          makeDefault
          position={[0, 50, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          zoom={40}
          near={0.1}
          far={200}
        />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 15, 10]} intensity={0.8} />
        <GameGrid
          onStateChange={(count, isPending, clearFn, undoFn) => {
            setPathCount(count);
            setPending(isPending);
            clearRef.current = clearFn;
            undoRef.current = undoFn;
          }}
        />
      </Canvas>
      <Chat />
    </div>
  );
}
