import { parseSessionFromCookieHeader } from "./auth.ts";

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
}

interface ConnectedClient {
  socket: WebSocket;
  userId: string | null;
  username: string;
}

const clients = new Map<WebSocket, ConnectedClient>();
const messageHistory: Message[] = [];
const MAX_HISTORY = 100;

function broadcast(data: string) {
  for (const [, client] of clients) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(data);
    }
  }
}

export function handleWebSocket(req: Request): Response {
  // Authenticate via session cookie on the upgrade request
  const cookieHeader = req.headers.get("cookie");
  const auth = parseSessionFromCookieHeader(cookieHeader);

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    clients.set(socket, {
      socket,
      userId: auth?.userId ?? null,
      username: auth?.username ?? "Anonymous",
    });
    socket.send(JSON.stringify({ type: "history", messages: messageHistory }));
    console.log(`Client connected: ${auth?.username ?? "Anonymous"}. Total: ${clients.size}`);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "message" && data.text) {
        const client = clients.get(socket);
        // Use server-verified username, not client-supplied
        const username = client?.username ?? "Anonymous";
        const msg: Message = {
          id: crypto.randomUUID(),
          user: username,
          text: data.text,
          timestamp: Date.now(),
        };
        messageHistory.push(msg);
        if (messageHistory.length > MAX_HISTORY) {
          messageHistory.shift();
        }
        broadcast(JSON.stringify({ type: "message", message: msg }));
      }
    } catch {
      // Ignore malformed messages
    }
  };

  socket.onclose = () => {
    const client = clients.get(socket);
    clients.delete(socket);
    console.log(`Client disconnected: ${client?.username ?? "?"}. Total: ${clients.size}`);
  };

  return response;
}
