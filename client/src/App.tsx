import { useState, useRef, useMemo, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { GameGrid, GameOverlay, DEFAULT_CONFIG, type GameConfig } from "./Grid.tsx";
import { useAuth } from "./AuthContext.tsx";
import { AuthScreen } from "./AuthScreen.tsx";
import { apiPost } from "./api.ts";
import { Leaderboard } from "./Leaderboard.tsx";
import { useBoardZoom } from "./useViewport.ts";

export function App() {
  const { user, loading, logout } = useAuth();
  const zoom = useBoardZoom();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [pathCount, setPathCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const clearRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const gameStartRef = useRef<number>(Date.now());
  const scoreSavedRef = useRef(false);

  const config: GameConfig = useMemo(() => ({ ...DEFAULT_CONFIG }), []);

  const saveScore = useCallback(async (finalScore: number) => {
    if (scoreSavedRef.current) return;
    scoreSavedRef.current = true;
    const durationSeconds = Math.floor((Date.now() - gameStartRef.current) / 1000);
    try {
      await apiPost("/api/game/sessions", {
        score: finalScore,
        durationSeconds,
        config,
      });
    } catch {
      // Score save failed silently — game still playable
    }
  }, [config]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className="shell">
      <GameOverlay
        pathCount={pathCount}
        pending={pending}
        onClear={() => {
          clearRef.current();
          setScore(0);
          setGameOver(false);
          gameStartRef.current = Date.now();
          scoreSavedRef.current = false;
        }}
        onUndo={() => undoRef.current()}
        score={score}
        gameOver={gameOver}
        username={user.username}
        onLogout={logout}
        onLeaderboard={() => setShowLeaderboard(true)}
      />
      <div className="canvas-host">
        <Canvas
          style={{ width: "100%", height: "100%" }}
          orthographic
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => gl.setClearColor("#0f1923")}
        >
          <OrthographicCamera
            makeDefault
            position={[0, 50, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            zoom={zoom}
            near={0.1}
            far={200}
          />
          <hemisphereLight args={["#b8c8d8", "#1a2530", 0.7]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[8, 20, 12]} intensity={0.85} />
          <directionalLight position={[-10, 12, -6]} intensity={0.25} color="#6a8abd" />
          <GameGrid
            config={config}
            onStateChange={(count, isPending, clearFn, undoFn, newScore, isGameOver) => {
              setPathCount(count);
              setPending(isPending);
              clearRef.current = clearFn;
              undoRef.current = undoFn;
              setScore(newScore);
              if (isGameOver && !gameOver) {
                saveScore(newScore);
              }
              setGameOver(isGameOver);
            }}
          />
        </Canvas>
      </div>
      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
    </div>
  );
}
