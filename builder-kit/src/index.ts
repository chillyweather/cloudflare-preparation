import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer(request: Request, env: Env) {
  const server = new McpServer({
    name: "builder-kit",
    version: "0.1.0",
  });

  server.registerTool(
    "ping",
    {
      description:
        "Health check. Returns the Cloudflare data center that served the request and the server time.",
    },
    async () => {
      const colo = request.cf?.colo ?? "local";
      const time = new Date().toISOString();
      console.log("ping called", { colo, ip: request.headers.get("cf-connecting-ip") });
      return {
        content: [{ type: "text", text: `pong from ${colo} at ${time}` }],
      };
    },
  );

  server.registerTool(
    "register_app",
    {
      description: "Register an app you have shipped so it appears in your app list.",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        url: z.url({ protocol: /^https?$/ }).max(2000),
      }),
    },
    async ({ name, url }) => {
      const id = crypto.randomUUID();
      const owner = "anonymous"; // replaced by the signed-in user in stage 3

      await env.DB.prepare("INSERT INTO apps (id, owner, name, url) VALUES (?, ?, ?, ?)")
        .bind(id, owner, name, url)
        .run();

      return {
        content: [{ type: "text", text: `Registered "${name}" (id: ${id})` }],
      };
    },
  );

  server.registerTool(
    "list_my_apps",
    {
      description: "List the apps you have registered, newest first.",
    },
    async () => {
      const owner = "anonymous"; // replaced by the signed-in user in stage 3

      const { results } = await env.DB.prepare(
        "SELECT id, name, url, created_at FROM apps WHERE owner = ? ORDER BY created_at DESC LIMIT 50",
      )
        .bind(owner)
        .all();

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const handler = createMcpHandler(() => createServer(request, env));
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
