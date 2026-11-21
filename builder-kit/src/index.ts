import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

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
      return {
        content: [{ type: "text", text: `pong from ${colo} at ${time}` }],
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
