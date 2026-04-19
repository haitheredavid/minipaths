import { useState, useRef, useMemo, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { GameGrid, GameOverlay, EndGameModal, DEFAULT_CONFIG, type GameConfig, type DualScore, type DualTokens, type ClickMode, type TreatyResult, type DualStats } from "./Grid.tsx";
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
  const [score, setScore] = useState<DualScore>({ player: 0, bot: 0 });
  const [gameOver, setGameOver] = useState(false);
  const [tokens, setTokens] = useState<DualTokens>({
    player: { claim: 2, seize: 2 },
    bot: { claim: 2, seize: 2 },
  });
  const [mode, setMode] = useState<ClickMode>("build");
  const [treatyResult, setTreatyResult] = useState<TreatyResult>(null);
  const [stats, setStats] = useState<DualStats>({
    player: { claimsUsed: 0, seizesUsed: 0, treatiesAccepted: 0, treatiesProposed: 0, treatiesRejected: 0, pathsBuilt: 0 },
    bot: { claimsUsed: 0, seizesUsed: 0, treatiesAccepted: 0, treatiesProposed: 0, treatiesRejected: 0, pathsBuilt: 0 },
  });
  const clearRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const setModeRef = useRef<(m: ClickMode) => void>(() => {});
  const gameStartRef = useRef<number>(Date.now());
  const scoreSavedRef = useRef(false);

  const config: GameConfig = useMemo(() => ({ ...DEFAULT_CONFIG }), []);

  const saveScore = useCallback(async (finalScore: DualScore) => {
    if (scoreSavedRef.current) return;
    scoreSavedRef.current = true;
    const durationSeconds = Math.floor((Date.now() - gameStartRef.current) / 1000);
    try {
      await apiPost("/api/game/sessions", {
        score: finalScore.player,
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
          setScore({ player: 0, bot: 0 });
          setGameOver(false);
          gameStartRef.current = Date.now();
          scoreSavedRef.current = false;
        }}
        onUndo={() => undoRef.current()}
        score={score}
        gameOver={gameOver}
        tokens={tokens}
        mode={mode}
        onSetMode={(m) => setModeRef.current(m)}
        treatyResult={treatyResult}
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
            onStateChange={(state, handlers) => {
              setPathCount(state.pathCount);
              setPending(state.pending);
              clearRef.current = handlers.clear;
              undoRef.current = handlers.undo;
              setModeRef.current = handlers.setMode;
              setScore(state.score);
              setTokens(state.tokens);
              setMode(state.mode);
              setTreatyResult(state.treatyResult);
              setStats(state.stats);
              if (state.gameOver && !gameOver) {
                saveScore(state.score);
              }
              setGameOver(state.gameOver);
            }}
          />
        </Canvas>
      </div>
      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
      {gameOver && (
        <EndGameModal
          score={score}
          stats={stats}
          onRestart={() => {
            clearRef.current();
            setScore({ player: 0, bot: 0 });
            setGameOver(false);
            gameStartRef.current = Date.now();
            scoreSavedRef.current = false;
          }}
        />
      )}
    </div>
  );
}
