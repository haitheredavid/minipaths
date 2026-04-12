import { useState, useEffect, useRef, useCallback } from "react";

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "history") {
        setMessages(data.messages);
      } else if (data.type === "message") {
        setMessages((prev) => [...prev, data.message]);
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  const send = useCallback(() => {
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "message", user: username, text: input }));
    setInput("");
  }, [input, username]);

  if (!joined) {
    return (
      <div style={styles.container}>
        <div style={styles.joinBox}>
          <input
            style={styles.input}
            placeholder="Enter your name..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && username.trim() && setJoined(true)}
          />
          <button style={styles.button} onClick={() => username.trim() && setJoined(true)}>
            Join Chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div ref={listRef} style={styles.messageList}>
        {messages.map((m) => (
          <div key={m.id} style={styles.message}>
            <strong>{m.user}</strong>: {m.text}
          </div>
        ))}
        {messages.length === 0 && <div style={styles.empty}>No messages yet</div>}
      </div>
      <div style={styles.inputRow}>
        <input
          style={{ ...styles.input, flex: 1 }}
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button style={styles.button} onClick={send}>Send</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "250px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "500px",
    overflow: "hidden",
  },
  joinBox: {
    display: "flex",
    gap: "8px",
    padding: "1rem",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "0.5rem",
    textAlign: "left",
  },
  message: {
    padding: "4px 0",
    fontSize: "14px",
  },
  empty: {
    color: "#999",
    textAlign: "center",
    marginTop: "2rem",
  },
  inputRow: {
    display: "flex",
    gap: "8px",
    padding: "0.5rem",
    borderTop: "1px solid #ddd",
  },
  input: {
    padding: "8px 12px",
    borderRadius: "4px",
    border: "1px solid #ccc",
    fontSize: "14px",
  },
  button: {
    padding: "8px 16px",
    borderRadius: "4px",
    border: "none",
    background: "#6c5ce7",
    color: "white",
    cursor: "pointer",
    fontSize: "14px",
  },
};
