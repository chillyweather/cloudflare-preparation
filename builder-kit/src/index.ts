import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

type User = { email: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function verifyAccessJwt(request: Request, env: Env): Promise<User | null> {
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) return null;

	try {
		jwks ??= createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
		const { payload } = await jwtVerify(token, jwks, {
			issuer: env.TEAM_DOMAIN,
			audience: env.POLICY_AUD,
		});
		if (typeof payload.email !== "string") return null;
		return { email: payload.email };
	} catch {
		return null;
	}
}

function createServer(request: Request, env: Env, user: User) {
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
			const owner = user.email;

			// 1. Feature flag: can be switched off without a deploy
			const open = await env.FLAGS.get("registration_open");
			if (open !== "true") {
				return {
					isError: true,
					content: [{ type: "text", text: "App registration is temporarily closed." }],
				};
			}

			// 2. Naive rate limit: max 5 registrations per owner per hour
			const hour = new Date().toISOString().slice(0, 13); // e.g. "2026-11-21T14"
			const rateKey = `rate:register_app:${owner}:${hour}`;
			const count = Number((await env.FLAGS.get(rateKey)) ?? "0");
			if (count >= 5) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: "Rate limit: max 5 registrations per hour. Try later.",
						},
					],
				};
			}
			await env.FLAGS.put(rateKey, String(count + 1), { expirationTtl: 3600 });

			const id = crypto.randomUUID();
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
			const owner = user.email;

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

	server.registerTool(
		"delete_app",
		{
			description: "Delete one of your registered apps by id (from list_my_apps).",
			inputSchema: z.object({ id: z.uuid() }),
		},
		async ({ id }) => {
			const owner = user.email;
			const result = await env.DB.prepare("DELETE FROM apps WHERE id = ? AND owner = ?")
				.bind(id, owner)
				.run();

			if (result.meta.changes === 0) {
				return {
					content: [{ type: "text", text: `No app with id ${id}. Call list_my_apps.` }],
					isError: true,
				};
			}
			return { content: [{ type: "text", text: `Deleted app ${id}` }] };
		},
	);

	server.registerTool(
		"list_templates",
		{
			description:
				"List the approved app templates. Use get_template to read one before starting a new app.",
		},
		async () => {
			const { objects } = await env.TEMPLATES.list({ limit: 100 });
			const names = objects
				.filter((o) => o.key.endsWith(".md") && !o.key.includes("/"))
				.map((o) => o.key.replace(/\.md$/, ""));

			return {
				content: [{ type: "text", text: JSON.stringify(names) }],
			};
		},
	);

	server.registerTool(
		"get_template",
		{
			description:
				"Get the full markdown of an approved app template by name (from list_templates).",
			inputSchema: z.object({
				name: z
					.string()
					.regex(/^[a-z0-9-]{1,64}$/, "Use a template name from list_templates"),
			}),
		},
		async ({ name }) => {
			const object = await env.TEMPLATES.get(`${name}.md`);
			if (!object) {
				return {
					isError: true,
					content: [
						{ type: "text", text: `No template named "${name}". Call list_templates.` },
					],
				};
			}

			return {
				content: [{ type: "text", text: await object.text() }],
			};
		},
	);

	return server;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const user = await verifyAccessJwt(request, env);
		if (!user) {
			return new Response("Unauthorized", { status: 401 });
		}

		const handler = createMcpHandler(() => createServer(request, env, user));
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
