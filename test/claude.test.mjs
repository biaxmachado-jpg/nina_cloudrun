// Mesma validação de antes, adaptada pro armazenamento em Firestore (mock)
// em vez de D1.

import assert from "node:assert";

let claudeCallCount = 0;
global.fetch = async (url, opts) => {
  if (url === "https://api.anthropic.com/v1/messages") {
    claudeCallCount++;
    const body = JSON.parse(opts.body);

    if (claudeCallCount === 1) {
      assert.ok(body.tools.some((t) => t.name === "google_tasks_create"));
      assert.ok(body.mcp_servers.some((s) => s.name === "google-calendar"));

      return {
        ok: true,
        json: async () => ({
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "google_tasks_create",
              input: { list_id: "abc123", title: "Comprar presente" },
            },
          ],
        }),
      };
    }

    if (claudeCallCount === 2) {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, "user");
      assert.strictEqual(lastMsg.content[0].type, "tool_result");
      assert.strictEqual(lastMsg.content[0].tool_use_id, "tool_1");

      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Prontinho, criei a tarefa pra você!" }],
        }),
      };
    }
    throw new Error("chamada inesperada à API da Claude");
  }

  if (url === "https://oauth2.googleapis.com/token") {
    return { ok: true, json: async () => ({ access_token: "fake-token", expires_in: 3600 }) };
  }

  if (url.includes("tasks.googleapis.com")) {
    return { ok: true, json: async () => ({ id: "task_1", title: "Comprar presente" }) };
  }

  throw new Error(`chamada de fetch não esperada no teste: ${url}`);
};

const { runNinaAgent } = await import("../src/claude.js");

// Mock mínimo de um Firestore doc() usado por tasks.js
const fakeDb = {
  doc: () => ({
    get: async () => ({ exists: false, data: () => null }),
    set: async () => {},
  }),
};

const config = {
  ANTHROPIC_API_KEY: "test-key",
  MCP_CALENDAR_URL: "https://calendarmcp.googleapis.com/mcp/v1",
  MCP_GMAIL_URL: "https://gmailmcp.googleapis.com/mcp/v1",
  MCP_DRIVE_URL: "https://drivemcp.googleapis.com/mcp/v1",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "refresh",
};

const result = await runNinaAgent(fakeDb, config, [], [
  { type: "text", text: "cria uma tarefa pra comprar presente" },
]);

assert.strictEqual(result, "Prontinho, criei a tarefa pra você!");
assert.strictEqual(claudeCallCount, 2);

console.log("OK: loop de tool use funciona (versão Firestore) - 2 chamadas, resolve tool custom, retorna texto final");
