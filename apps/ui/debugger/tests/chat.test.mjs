import { test } from "node:test";
import assert from "node:assert/strict";
import { converse } from "../src/chat/conversation.ts";
import {
  loadConfig,
  persistConfig,
  configKey,
  rememberKey,
  rememberApiKey,
} from "../src/chat/config.ts";
import { executeRunResponse, exportRun } from "../src/client.ts";
const options = {
  inference: "https://inference",
  mcp: "https://mcp",
  namespace: "test ns",
  apiKey: "provider",
  model: "test",
  systemPrompt: "help",
  parameters: {},
  tools: [{ name: "lookup" }],
  signal: new AbortController().signal,
  update() {},
};
test("model content and consecutive tool rounds preserve complete tool responses and IDs", async () => {
  const requests = [];
  let completion = 0;
  const history = await converse([{ role: "user", content: "hello" }], {
    ...options,
    send: async (spec) => {
      requests.push(spec);
      if (spec.url.includes("/mcp"))
        return {
          result: {
            content: [
              { type: "text", text: "first" },
              { type: "text", text: "second" },
            ],
            structuredContent: { token: "original" },
          },
        };
      completion++;
      return {
        choices: [
          {
            message:
              completion < 3
                ? {
                    content: "thinking",
                    tool_calls: [
                      {
                        id: `id-${completion}`,
                        function: {
                          name: "lookup",
                          arguments: '{"token":"original"}',
                        },
                      },
                    ],
                  }
                : { content: "done" },
          },
        ],
      };
    },
  });
  assert.equal(completion, 3);
  assert.equal(history.at(-1).content, "done");
  assert.equal(history[2].tool_call_id, "id-1");
  assert.match(history[2].content, /second/);
  assert.match(history[2].content, /original/);
  assert.match(requests[1].url, /test%20ns\/mcp$/);
  const next = JSON.parse(requests[2].body);
  assert.equal(next.messages[0].role, "system");
  assert.equal(next.messages[3].tool_call_id, "id-1");
});
test("unselected tools cannot execute and cancellation prevents follow-up requests", async () => {
  await assert.rejects(
    converse([], {
      ...options,
      send: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                { id: "1", function: { name: "forbidden", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    }),
    /unselected tool/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    converse([], {
      ...options,
      signal: controller.signal,
      send: async () => assert.fail("request after abort"),
    }),
    { name: "AbortError" },
  );
});
test("API key persistence requires independent opt-in and strips legacy payload key", () => {
  const map = new Map();
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
  const config = {
    model: "test",
    apiKey: "secret",
    systemPrompt: "help",
    parameters: "",
  };
  persistConfig(storage, config);
  assert.equal(map.has(configKey), false);
  storage.setItem(rememberKey, "true");
  persistConfig(storage, config);
  assert.ok(!storage.getItem(configKey).includes("secret"));
  storage.setItem(rememberApiKey, "true");
  persistConfig(storage, config);
  assert.equal(loadConfig(storage).apiKey, "secret");
  storage.removeItem(rememberApiKey);
  assert.equal(loadConfig(storage).apiKey, "");
  persistConfig(storage, config);
  assert.ok(!storage.getItem(configKey).includes("secret"));
  storage.removeItem(rememberKey);
  persistConfig(storage, config);
  assert.equal(map.has(configKey), false);
});
test("raw response is private to protocol consumer while history redacts credentials", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      if (url.includes("/audit/"))
        return Response.json({ data: { events: [{ echo: "management" }] } });
      assert.equal(init.headers.get("Authorization"), "Bearer provider");
      return Response.json({
        result: { token: "tool-data", content: "provider" },
      });
    };
    const { run, response } = await executeRunResponse(
      { method: "GET", url: "https://inference", token: "provider" },
      "management",
    );
    assert.equal(JSON.parse(response).result.token, "tool-data");
    assert.ok(!exportRun(run).includes("provider"));
    assert.ok(!exportRun(run).includes("management"));
    assert.ok(!exportRun(run).includes("tool-data"));
    globalThis.fetch = async (url, init) =>
      url.includes("/audit/")
        ? Response.json({ data: {} })
        : (assert.equal(init.headers.has("Authorization"), false),
          Response.json({}));
    await executeRunResponse(
      {
        method: "GET",
        url: "https://inference",
        token: "",
        headers: { Authorization: "Bearer management" },
      },
      "management",
    );
  } finally {
    globalThis.fetch = original;
  }
});
