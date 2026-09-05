declare let ztoolkit: ZToolkit;

export interface ExternalToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  pluginID?: string;
  enabled?: boolean;
}

interface RegisteredTool extends ExternalToolDefinition {
  registeredAt: Date;
}

export interface RegisteredToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  pluginID?: string;
  enabled: boolean;
  registeredAt: string;
}


type ChangeListener = () => void;

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_PLUGIN_ID_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_EXTERNAL_TOOLS = 64;

// Reserve current built-ins plus citation/file tools from the split PR series so
// external plugins cannot squat on names before those tools land upstream.
const BUILTIN_TOOL_NAMES = new Set([
  "get_libraries",
  "search_library",
  "search_libraries",
  "search_annotations",
  "get_item_details",
  "get_annotations",
  "get_content",
  "get_collections",
  "search_collections",
  "get_collection_details",
  "get_collection_items",
  "get_subcollections",
  "create_collection",
  "update_collection",
  "delete_collection",
  "add_items_to_collection",
  "remove_items_from_collection",
  "search_fulltext",
  "get_item_abstract",
  "semantic_search",
  "find_similar",
  "semantic_status",
  "fulltext_database",
  "write_note",
  "write_tag",
  "write_metadata",
  "write_item",
  "add_by_identifier",
  "export_bibliography",
  "get_citation",
  "list_citation_styles",
  "sync_bib",
  "cite",
]);

function cloneJsonObject<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertJsonSerializable(value: unknown, label: string): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("value serializes to undefined");
    }
  } catch (error) {
    throw new Error(
      `${label} must be JSON-serializable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private listeners = new Set<ChangeListener>();

  registerTool(definition: ExternalToolDefinition): boolean {
    this.validateDefinition(definition);
    if (this.tools.size >= MAX_EXTERNAL_TOOLS) {
      throw new Error(
        `External tool limit reached (${MAX_EXTERNAL_TOOLS}). Unregister a tool before adding another.`,
      );
    }
    if (BUILTIN_TOOL_NAMES.has(definition.name)) {
      throw new Error(`Tool name "${definition.name}" is reserved by Zotero MCP`);
    }
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }

    const registered: RegisteredTool = {
      ...definition,
      description: definition.description.trim(),
      pluginID: definition.pluginID?.trim(),
      inputSchema: cloneJsonObject(definition.inputSchema),
      enabled: definition.enabled !== false,
      registeredAt: new Date(),
    };
    this.tools.set(registered.name, registered);
    ztoolkit.log(
      `[ToolRegistry] Registered ${registered.name}` +
        (registered.pluginID ? ` from ${registered.pluginID}` : ''),
    );
    this.notifyListeners();
    return true;
  }

  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) this.notifyListeners();
    return removed;
  }

  unregisterAllTools(pluginID: string): number {
    const normalized = pluginID.trim();
    if (!normalized) throw new Error("pluginID is required");
    let removed = 0;
    for (const [name, tool] of this.tools) {
      if (tool.pluginID === normalized) {
        this.tools.delete(name);
        removed += 1;
      }
    }
    if (removed) this.notifyListeners();
    return removed;
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [...this.tools.values()]
      .filter((tool) => tool.enabled !== false)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: cloneJsonObject(tool.inputSchema),
      }));
  }

  getRegisteredTools(): RegisteredToolInfo[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: cloneJsonObject(tool.inputSchema),
      pluginID: tool.pluginID,
      enabled: tool.enabled !== false,
      registeredAt: tool.registeredAt.toISOString(),
    }));
  }

  async invoke(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool || tool.enabled === false) {
      throw new Error(`External tool "${name}" is not available`);
    }
    const normalizedArgs = args ?? {};
    if (
      typeof normalizedArgs !== "object" ||
      normalizedArgs === null ||
      Array.isArray(normalizedArgs)
    ) {
      throw new Error(
        `Arguments for external tool "${name}" must be an object`,
      );
    }

    let result: unknown;
    try {
      result = await tool.handler(normalizedArgs as Record<string, unknown>);
    } catch (error) {
      throw new Error(
        `External tool "${name}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    assertJsonSerializable(result, `Result from external tool "${name}"`);
    return result;
  }

  onToolListChanged(listener: ChangeListener): () => void {
    if (typeof listener !== "function") {
      throw new Error("Tool-list listener must be a function");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.tools.clear();
    this.listeners.clear();
  }

  private validateDefinition(definition: ExternalToolDefinition): void {
    if (!definition || typeof definition !== "object") {
      throw new Error("Tool definition must be an object");
    }
    if (
      typeof definition.name !== "string" ||
      definition.name.length > MAX_TOOL_NAME_LENGTH ||
      !TOOL_NAME_PATTERN.test(definition.name)
    ) {
      throw new Error(
        `Invalid tool name "${definition.name}". Use lowercase letters, digits and underscores, starting with a letter (max ${MAX_TOOL_NAME_LENGTH}).`,
      );
    }
    if (
      definition.pluginID !== undefined &&
      (typeof definition.pluginID !== "string" ||
        !definition.pluginID.trim() ||
        definition.pluginID.length > MAX_PLUGIN_ID_LENGTH)
    ) {
      throw new Error(
        `pluginID, when provided, must be a non-empty string of at most ${MAX_PLUGIN_ID_LENGTH} characters`,
      );
    }
    if (
      typeof definition.description !== "string" ||
      !definition.description.trim() ||
      definition.description.length > MAX_DESCRIPTION_LENGTH
    ) {
      throw new Error(
        `description must contain 1-${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    if (
      !definition.inputSchema ||
      typeof definition.inputSchema !== "object" ||
      Array.isArray(definition.inputSchema)
    ) {
      throw new Error("inputSchema must be a JSON Schema object");
    }
    if (definition.inputSchema.type !== "object") {
      throw new Error('inputSchema.type must be "object"');
    }
    assertJsonSerializable(definition.inputSchema, "inputSchema");
    if (typeof definition.handler !== "function") {
      throw new Error("handler must be a function");
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        ztoolkit.log(`[ToolRegistry] Listener failed: ${error}`, "warn");
      }
    }
  }
}

let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) registryInstance = new ToolRegistry();
  return registryInstance;
}

export function resetToolRegistry(): void {
  registryInstance?.clear();
  registryInstance = null;
}
