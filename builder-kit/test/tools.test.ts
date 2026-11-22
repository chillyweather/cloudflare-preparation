import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

async function callTool(name: string, args: Record<string, unknown> = {}) {
	const response = await exports.default.fetch("http://example.com/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});
	const body = await response.text();
	const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
	const message = JSON.parse(dataLine ? dataLine.slice(6) : body);
	return message.result as { content: { type: string; text: string }[]; isError?: boolean };
}

describe("ping", () => {
	it("answers pong", async () => {
		const result = await callTool("ping");
		expect(result.content[0].text).toMatch(/^pong from /);
	});
});

describe("apps", () => {
	it("register_app stores an app that list_my_apps returns", async () => {
		await env.FLAGS.put("registration_open", "true");
		const registered = await callTool("register_app", { name: "Test app", url: "https://test.example" });
		expect(registered.isError).toBeFalsy();

		const listed = await callTool("list_my_apps");
		const apps = JSON.parse(listed.content[0].text);
		expect(apps).toHaveLength(1);
		expect(apps[0]).toMatchObject({ name: "Test app", url: "https://test.example" });
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
