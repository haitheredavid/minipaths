interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
}

const clients = new Set<WebSocket>();
const messageHistory: Message[] = [];
const MAX_HISTORY = 100;

function broadcast(data: string) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export function handleWebSocket(req: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: "history", messages: messageHistory }));
    console.log(`Client connected. Total: ${clients.size}`);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "message" && data.text && data.user) {
        const msg: Message = {
          id: crypto.randomUUID(),
          user: data.user,
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
    clients.delete(socket);
    console.log(`Client disconnected. Total: ${clients.size}`);
  };

  return response;
}
