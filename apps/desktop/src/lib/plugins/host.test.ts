/**
 * What the runtime lets a plugin do, and what it does not.
 *
 * The interesting question here is not "does a tool work" but "does an
 * *undeclared* tool work" — because ADR-0022 rests on the manifest being an
 * honest account of what a plugin adds, and a manifest is only honest if
 * something refuses to go past it.
 *
 * Rust refuses it as well, and Rust is the copy that counts (ADR-0006). This
 * one is the copy a plugin author meets: it fires at the call site, in
 * development, instead of leaving them wondering why their tool never appears.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginList = vi.fn();
const mcpSetPluginTools = vi.fn();
const mcpToolResult = vi.fn();
const listeners = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("../ipc", () => ({
  pluginList: (...args: unknown[]) => pluginList(...args),
  mcpSetPluginTools: (...args: unknown[]) => mcpSetPluginTools(...args),
  mcpToolResult: (...args: unknown[]) => mcpToolResult(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  },
}));

vi.mock("../i18n", () => ({
  t: (key: string) => key,
  locale: () => "en-US",
}));

import { PluginRuntime } from "./host";

/** A plugin that registers whatever it is told to. */
function pluginRegistering(
  tools: { name: string; descriptionKey: string; run: () => unknown }[],
) {
  return class {
    registerTool!: (tool: unknown) => void;
    onload(): void {
      for (const tool of tools) this.registerTool(tool);
    }
  } as unknown as new () => never;
}

/** A runtime with just enough context to load something. */
function runtimeFor(): PluginRuntime {
  return new PluginRuntime({
    project: () => null,
    compile: () => Promise.resolve({ succeeded: true, diagnostics: [] }),
  } as never);
}

beforeEach(() => {
  pluginList.mockReset();
  mcpSetPluginTools.mockReset().mockResolvedValue({
    running: false,
    address: null,
    token: null,
    tools: 0,
  });
  mcpToolResult.mockReset().mockResolvedValue(undefined);
  listeners.clear();
});

describe("a tool the manifest declares", () => {
  it("is registered and published", async () => {
    pluginList.mockResolvedValue([
      {
        id: "com.example.p",
        name: "P",
        description: "",
        capabilities: [],
        tools: ["search"],
        updates: null,
        version: "1.0.0",
      },
    ]);
    const runtime = runtimeFor();
    await runtime.start({
      "com.example.p": pluginRegistering([
        { name: "search", descriptionKey: "p-search", run: () => "found" },
      ]),
    });

    expect(runtime.tools.map((tool) => tool.name)).toEqual(["search"]);
    expect(mcpSetPluginTools).toHaveBeenCalledWith("com.example.p", [
      expect.objectContaining({ name: "search" }),
    ]);
  });

  it("runs when an agent calls it, and the answer goes back", async () => {
    pluginList.mockResolvedValue([
      {
        id: "com.example.p",
        name: "P",
        description: "",
        capabilities: [],
        tools: ["search"],
        updates: null,
        version: "1.0.0",
      },
    ]);
    await runtimeFor().start({
      "com.example.p": pluginRegistering([
        { name: "search", descriptionKey: "p-search", run: () => "found" },
      ]),
    });

    await listeners.get("mcp://invoke")?.({
      payload: {
        id: "1",
        pluginId: "com.example.p",
        tool: "search",
        arguments: {},
      },
    });
    await vi.waitFor(() => expect(mcpToolResult).toHaveBeenCalled());
    expect(mcpToolResult).toHaveBeenCalledWith("1", "found", null);
  });

  it("reports a throw as an error rather than as a result", async () => {
    // An agent has to be able to tell "it did not work" from "it worked and
    // the answer is the word error".
    pluginList.mockResolvedValue([
      {
        id: "com.example.p",
        name: "P",
        description: "",
        capabilities: [],
        tools: ["search"],
        updates: null,
        version: "1.0.0",
      },
    ]);
    await runtimeFor().start({
      "com.example.p": pluginRegistering([
        {
          name: "search",
          descriptionKey: "p-search",
          run: () => {
            throw new Error("the library is closed");
          },
        },
      ]),
    });

    await listeners.get("mcp://invoke")?.({
      payload: {
        id: "7",
        pluginId: "com.example.p",
        tool: "search",
        arguments: {},
      },
    });
    await vi.waitFor(() => expect(mcpToolResult).toHaveBeenCalled());
    const [id, result, error] = mcpToolResult.mock.calls[0]!;
    expect(id).toBe("7");
    expect(result).toBeNull();
    expect(String(error)).toContain("the library is closed");
  });
});

describe("a tool the manifest does not declare", () => {
  it("is refused", async () => {
    // The whole of ADR-0022's argument. Without this the declaration is a
    // comment, free to say less than the plugin does — and a registry reading
    // manifests could not answer "what does this add to yaz?" without running
    // the plugin.
    pluginList.mockResolvedValue([
      {
        id: "com.example.p",
        name: "P",
        description: "",
        capabilities: [],
        tools: ["search"],
        updates: null,
        version: "1.0.0",
      },
    ]);
    const runtime = runtimeFor();
    await runtime.start({
      "com.example.p": pluginRegistering([
        { name: "search", descriptionKey: "p-search", run: () => "found" },
        {
          name: "delete-everything",
          descriptionKey: "p-delete",
          run: () => "done",
        },
      ]),
    });

    expect(runtime.tools.map((tool) => tool.name)).toEqual(["search"]);
    expect(mcpSetPluginTools).toHaveBeenCalledWith("com.example.p", [
      expect.objectContaining({ name: "search" }),
    ]);
  });

  it("is still answered when an agent asks for it", async () => {
    // Rather than left hanging. Rust holds a waiting agent against a timeout,
    // and a silence here spends the whole of it for a question with a
    // one-word answer.
    pluginList.mockResolvedValue([
      {
        id: "com.example.p",
        name: "P",
        description: "",
        capabilities: [],
        tools: [],
        updates: null,
        version: "1.0.0",
      },
    ]);
    await runtimeFor().start({ "com.example.p": pluginRegistering([]) });

    await listeners.get("mcp://invoke")?.({
      payload: {
        id: "9",
        pluginId: "com.example.p",
        tool: "ghost",
        arguments: {},
      },
    });
    await vi.waitFor(() => expect(mcpToolResult).toHaveBeenCalled());
    const [id, result, error] = mcpToolResult.mock.calls[0]!;
    expect(id).toBe("9");
    expect(result).toBeNull();
    expect(String(error)).toContain("ghost");
  });
});
