export interface MCPExternalToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  pluginID?: string;
  enabled?: boolean;
}

export interface MCPRegisteredToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  pluginID?: string;
  enabled: boolean;
  registeredAt: string;
}

export interface ZoteroMCPExternalToolAPI {
  registerTool(definition: MCPExternalToolDefinition): boolean;
  unregisterTool(name: string): boolean;
  unregisterAllTools(pluginID: string): number;
  getRegisteredTools(): MCPRegisteredToolInfo[];
  isToolRegistered(name: string): boolean;
  onToolListChanged(listener: () => void): () => void;
}
