import { ToolRegistry } from "../src/modules/toolRegistry";

declare const expect: Chai.ExpectStatic;

describe("external tool registry", function () {
  beforeEach(function () {
    (globalThis as any).ztoolkit = { log: () => undefined };
  });

  it("preserves the original optional pluginID API while validating schemas", function () {
    const registry = new ToolRegistry();
    expect(registry.registerTool({
      name: "demo_tool",
      description: "Demo",
      inputSchema: { type: "object" },
      handler: () => ({}),
    })).to.equal(true);
    expect(registry.unregisterTool("demo_tool")).to.equal(true);

    expect(() =>
      registry.registerTool({
        name: "bad_schema",
        description: "Demo",
        inputSchema: { type: "string" },
        handler: () => ({}),
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
        }),
      ).to.throw("reserved by Zotero MCP");
    }
  });

  it("keeps unregisterTool(name) compatible with cloneorcopy's API", function () {
    const registry = new ToolRegistry();
    expect(registry.registerTool({
      name: "demo_tool",
      description: "Demo",
      inputSchema: { type: "object" },
      handler: () => ({ ok: true }),
      pluginID: "example.plugin",
    })).to.equal(true);

    expect(registry.unregisterTool("demo_tool")).to.equal(true);
    expect(registry.unregisterTool("demo_tool")).to.equal(false);
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
