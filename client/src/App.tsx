import { useState, useRef, useMemo, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { Leva, useControls } from "leva";
import { GameGrid, GameOverlay, DEFAULT_CONFIG, type GameConfig, type DualScore, type DualTokens, type ClickMode, type TreatyResult } from "./Grid.tsx";
import { useAuth } from "./AuthContext.tsx";
import { AuthScreen } from "./AuthScreen.tsx";
import { apiPost } from "./api.ts";
import { Leaderboard } from "./Leaderboard.tsx";

export function App() {
  const { user, loading, logout } = useAuth();
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
  const clearRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const setModeRef = useRef<(m: ClickMode) => void>(() => {});
  const gameStartRef = useRef<number>(Date.now());
  const scoreSavedRef = useRef(false);

  const controls = useControls("Spawning", {
    agentSpeed: { value: DEFAULT_CONFIG.agentSpeed, min: 0.5, max: 10, step: 0.5, label: "Agent Speed" },
    spawnInterval: { value: DEFAULT_CONFIG.spawnInterval, min: 1, max: 20, step: 0.5, label: "Spawn Interval" },
    demandInterval: { value: DEFAULT_CONFIG.demandInterval, min: 1, max: 30, step: 0.5, label: "Demand Interval" },
    newPairInterval: { value: DEFAULT_CONFIG.newPairInterval, min: 5, max: 120, step: 5, label: "New Pair Timer" },
    maxDemand: { value: DEFAULT_CONFIG.maxDemand, min: 3, max: 20, step: 1, label: "Max Demand" },
  });

  const botControls = useControls("Bot", {
    botEnabled: { value: DEFAULT_CONFIG.botEnabled, label: "Enabled" },
    botDecisionInterval: { value: DEFAULT_CONFIG.botDecisionInterval, min: 0.5, max: 10, step: 0.5, label: "Decision Interval" },
  });

  const aggressionControls = useControls("Aggression", {
    crossOwnerPlanningPenalty: { value: DEFAULT_CONFIG.crossOwnerPlanningPenalty, min: 0, max: 5, step: 0.1, label: "Planning Penalty" },
    crossOwnerSpeedMult: { value: DEFAULT_CONFIG.crossOwnerSpeedMult, min: 0.1, max: 1, step: 0.05, label: "Cross-owner Speed" },
    treatySpeedMult: { value: DEFAULT_CONFIG.treatySpeedMult, min: 1, max: 2, step: 0.05, label: "Treaty Bonus" },
  });

  const config: GameConfig = useMemo(() => ({
    agentSpeed: controls.agentSpeed,
    spawnInterval: controls.spawnInterval,
    demandInterval: controls.demandInterval,
    newPairInterval: controls.newPairInterval,
    maxDemand: controls.maxDemand,
    botEnabled: botControls.botEnabled,
    botDecisionInterval: botControls.botDecisionInterval,
    crossOwnerPlanningPenalty: aggressionControls.crossOwnerPlanningPenalty,
    crossOwnerSpeedMult: aggressionControls.crossOwnerSpeedMult,
    treatySpeedMult: aggressionControls.treatySpeedMult,
  }), [controls.agentSpeed, controls.spawnInterval, controls.demandInterval, controls.newPairInterval, controls.maxDemand, botControls.botEnabled, botControls.botDecisionInterval, aggressionControls.crossOwnerPlanningPenalty, aggressionControls.crossOwnerSpeedMult, aggressionControls.treatySpeedMult]);

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
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f1923", color: "#8899aa", fontFamily: "system-ui" }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div style={{ fontFamily: "system-ui", height: "100vh", display: "flex", flexDirection: "column", background: "#0f1923" }}>
      <Leva collapsed />
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
      <Canvas
        style={{ flex: 1 }}
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: true }}
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
            if (state.gameOver && !gameOver) {
              saveScore(state.score);
            }
            setGameOver(state.gameOver);
          }}
        />
      </Canvas>
      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
    </div>
  );
}
