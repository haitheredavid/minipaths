import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { handleWebSocket } from "./messages.ts";

const app = new Hono();

// API routes
const api = new Hono();
api.get("/hello", (c) => {
  return c.json({ message: "Hello from Deno!" });
});
app.route("/api", api);

// WebSocket endpoint
app.get("/ws", (c) => {
  return handleWebSocket(c.req.raw);
});

// Serve static files in production
app.use("/*", serveStatic({ root: "./dist" }));

// SPA fallback — serve index.html for unmatched routes
app.get("*", async (c) => {
  try {
    const html = await Deno.readTextFile("./dist/index.html");
    return c.html(html);
  } catch {
    return c.text("Not found", 404);
  }
});

const port = Number(Deno.env.get("PORT") ?? 8000);
console.log(`Server running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
