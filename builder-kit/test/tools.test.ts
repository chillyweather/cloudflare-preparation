import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { accessJwt, untrustedKey } from "./access";

const ALICE = "alice@example.com";

// Storage is shared between tests in this file, so tests that count rows use fresh users.
const newUser = (name: string) => `${name}-${crypto.randomUUID()}@example.com`;

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

/** Sends one MCP JSON-RPC message, optionally with an Access JWT. Returns the raw HTTP response. */
async function mcpRequest(token: string | null, method: string, params: Record<string, unknown>) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
	};
	if (token) headers["Cf-Access-Jwt-Assertion"] = token;

	return exports.default.fetch("http://example.com/mcp", {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
}

/** Calls a tool as a signed-in user, the way Claude Code does after logging in through Access. */
async function callTool(name: string, args: Record<string, unknown> = {}, as = ALICE) {
	const response = await mcpRequest(await accessJwt(as), "tools/call", { name, arguments: args });
	const body = await response.text();
	const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
	const message = JSON.parse(dataLine ? dataLine.slice(6) : body);
	return message.result as ToolResult;
}

describe("authentication", () => {
	const listTools = (token: string | null) => mcpRequest(token, "tools/list", {});

	it("accepts a valid Access token", async () => {
		const response = await listTools(await accessJwt(ALICE));
		expect(response.status).toBe(200);
	});

	it("rejects a request without a token", async () => {
		const response = await listTools(null);
		expect(response.status).toBe(401);
	});

	it("rejects a malformed token", async () => {
		const response = await listTools("not-a-jwt");
		expect(response.status).toBe(401);
	});

	it("rejects a token signed by someone else (forged)", async () => {
		const response = await listTools(
			await accessJwt(ALICE, { signWith: await untrustedKey() }),
		);
		expect(response.status).toBe(401);
	});

	it("rejects a token for a different Access application (wrong audience)", async () => {
		const response = await listTools(await accessJwt(ALICE, { audience: "some-other-app" }));
		expect(response.status).toBe(401);
	});

	it("rejects a token from a different team (wrong issuer)", async () => {
		const response = await listTools(
			await accessJwt(ALICE, { issuer: "https://evil.cloudflareaccess.com" }),
		);
		expect(response.status).toBe(401);
	});

	it("rejects an expired token", async () => {
		const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
		const response = await listTools(await accessJwt(ALICE, { expiresAt: anHourAgo }));
		expect(response.status).toBe(401);
	});
});

describe("ping", () => {
	it("answers pong", async () => {
		const result = await callTool("ping");
		expect(result.content[0].text).toMatch(/^ping from /);
	});
});

describe("apps", () => {
	it("register_app stores an app that list_my_apps returns", async () => {
		const user = newUser("carol");
		await env.FLAGS.put("registration_open", "true");
		const registered = await callTool(
			"register_app",
			{ name: "Test app", url: "https://test.example" },
			user,
		);
		expect(registered.isError).toBeFalsy();

		const listed = await callTool("list_my_apps", {}, user);
		const apps = JSON.parse(listed.content[0].text);
		expect(apps).toHaveLength(1);
		expect(apps[0]).toMatchObject({ name: "Test app", url: "https://test.example" });
	});

	it("each user sees only their own apps", async () => {
		const [ALICE, BOB] = [newUser("alice"), newUser("bob")];
		await env.FLAGS.put("registration_open", "true");
		await callTool("register_app", { name: "Alice app", url: "https://alice.example" }, ALICE);
		await callTool("register_app", { name: "Bob app", url: "https://bob.example" }, BOB);

		const aliceApps = JSON.parse((await callTool("list_my_apps", {}, ALICE)).content[0].text);
		const bobApps = JSON.parse((await callTool("list_my_apps", {}, BOB)).content[0].text);

		expect(aliceApps.map((a: { name: string }) => a.name)).toEqual(["Alice app"]);
		expect(bobApps.map((a: { name: string }) => a.name)).toEqual(["Bob app"]);
	});

	it("register_app rejects javascript: URLs", async () => {
		await env.FLAGS.put("registration_open", "true");
		const result = await callTool("register_app", { name: "Bad", url: "javascript:alert(1)" });
		expect(result.isError).toBe(true);
	});

	it("register_app refuses when the flag is off", async () => {
		await env.FLAGS.put("registration_open", "false");
		const result = await callTool("register_app", { name: "X", url: "https://x.example" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/closed/);
	});
});

describe("delete_app", () => {
	/** Registers an app as `owner` and returns its id (read back via list_my_apps). */
	async function registerApp(owner: string, name: string) {
		await env.FLAGS.put("registration_open", "true");
		await callTool("register_app", { name, url: "https://app.example" }, owner);
		const apps = JSON.parse((await callTool("list_my_apps", {}, owner)).content[0].text);
		return apps.find((a: { name: string }) => a.name === name).id as string;
	}
	const appNames = async (owner: string) =>
		JSON.parse((await callTool("list_my_apps", {}, owner)).content[0].text).map(
			(a: { name: string }) => a.name,
		);

	it("deletes your own app", async () => {
		const alice = newUser("alice");
		const id = await registerApp(alice, "Doomed app");

		const result = await callTool("delete_app", { id }, alice);
		expect(result.isError).toBeFalsy();
		expect(await appNames(alice)).toEqual([]);
	});

	it("cannot delete another user's app (IDOR)", async () => {
		const [alice, bob] = [newUser("alice"), newUser("bob")];
		const id = await registerApp(alice, "Alice app");

		const result = await callTool("delete_app", { id }, bob);
		expect(result.isError).toBe(true);
		expect(await appNames(alice)).toEqual(["Alice app"]);
	});

	it("gives the same answer for someone else's app and a missing app", async () => {
		const [alice, bob] = [newUser("alice"), newUser("bob")];
		const aliceAppId = await registerApp(alice, "Alice app");
		const missingId = crypto.randomUUID();

		const othersApp = await callTool("delete_app", { id: aliceAppId }, bob);
		const missing = await callTool("delete_app", { id: missingId }, bob);
		const normalize = (text: string, id: string) => text.replace(id, "<id>");
		expect(normalize(othersApp.content[0].text, aliceAppId)).toBe(
			normalize(missing.content[0].text, missingId),
		);
	});

	it("rejects ids that are not UUIDs", async () => {
		const result = await callTool("delete_app", { id: "1 OR 1=1" });
		expect(result.isError).toBe(true);
	});
});

describe("templates", () => {
	it("list_templates and get_template read from R2", async () => {
		await env.TEMPLATES.put("demo.md", "# Demo");
		const listed = await callTool("list_templates");
		expect(JSON.parse(listed.content[0].text)).toEqual(["demo"]);

		const got = await callTool("get_template", { name: "demo" });
		expect(got.content[0].text).toBe("# Demo");
	});

	it("get_template rejects path-like names", async () => {
		const result = await callTool("get_template", { name: "../demo" });
		expect(result.isError).toBe(true);
	});
});
