import { ToolRegistry } from "../src/modules/toolRegistry";

declare const expect: Chai.ExpectStatic;

describe("external tool registry", function () {
  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
  });

  it("requires plugin identity and object JSON schema", function () {
    const registry = new ToolRegistry();
    expect(() =>
      registry.registerTool({
        name: "demo_tool",
        description: "Demo",
        inputSchema: { type: "object" },
        handler: () => ({}),
        pluginID: "",
      }),
    ).to.throw("pluginID is required");

    expect(() =>
      registry.registerTool({
        name: "demo_tool",
        description: "Demo",
        inputSchema: { type: "string" },
        handler: () => ({}),
        pluginID: "example.plugin",
      }),
    ).to.throw('inputSchema.type must be "object"');
  });

  it("reserves built-in and split-series tool names", function () {
    const registry = new ToolRegistry();
    for (const name of ["search_library", "sync_bib", "cite"]) {
      expect(() =>
        registry.registerTool({
          name,
          description: "Collision",
          inputSchema: { type: "object" },
          handler: () => ({}),
          pluginID: "example.plugin",
        }),
      ).to.throw("reserved by Zotero MCP");
    }
  });

  it("returns an ownership-bound unregister handle", function () {
    const registry = new ToolRegistry();
    const registration = registry.registerTool({
      name: "demo_tool",
      description: "Demo",
      inputSchema: { type: "object" },
      handler: () => ({ ok: true }),
      pluginID: "example.plugin",
    });

    expect(registry.hasTool("demo_tool")).to.equal(true);
    expect(() => registry.unregisterTool("demo_tool", "other.plugin")).to.throw(
      "cannot unregister",
    );
    expect(registration.unregister()).to.equal(true);
    expect(registration.unregister()).to.equal(false);
    expect(registry.hasTool("demo_tool")).to.equal(false);
  });

  it("rejects non-serializable handler results", async function () {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "cycle_tool",
      description: "Cycle",
      inputSchema: { type: "object" },
      handler: () => {
        const cycle: any = {};
        cycle.self = cycle;
        return cycle;
      },
      pluginID: "example.plugin",
    });

    let error: Error | undefined;
    try {
      await registry.invoke("cycle_tool", {});
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).to.contain("must be JSON-serializable");
  });
});
