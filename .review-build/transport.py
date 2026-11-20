from pathlib import Path
import shutil
root = Path('zotero-mcp-plugin')
shutil.copyfile(Path(__file__).with_name('oauthTransportPolicy.ts'), root/'src/modules/oauthTransportPolicy.ts')
p = root/'src/modules/httpServer.ts'
s = p.read_text().replace('import { oauthServer } from "./oauthServer";', 'import { oauthServer } from "./oauthServer";\nimport { resolveListenerPorts, isForwardedRequest } from "./oauthTransportPolicy";')
a=s.index('    if (!port || isNaN(port)')
b=s.index('\n    try {',a)
s=s[:a]+'''    const layout = resolveListenerPorts(port, serverPreferences.isRemoteAccessAllowed(),
      oauthServer.isEnabled(), serverPreferences.getOAuthPort() || 0);
''' + s[b:]
s=s.replace('const loopbackOnly = !serverPreferences.isRemoteAccessAllowed();', 'const loopbackOnly = layout.loopbackOnly;')
a=s.index('      if (oauthServer.isEnabled() && serverPreferences.isRemoteAccessAllowed()) {')
b=s.index('\n      Zotero.debug(',a)
s=s[:a]+'''      if (layout.oauthPort !== null) {
        try {
          this.oauthSocket = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
          const current = this.oauthSocket;
          current.init(layout.oauthPort, false, -1);
          current.asyncListen({
            onSocketAccepted: (socket: any, transport: any) => this.listener.onSocketAccepted(socket, transport, true),
            onStopListening: (socket: any, status: any) => {
              if (this.oauthSocket === socket) this.oauthSocket = null;
              ztoolkit.log(`[HttpServer] OAuth listener stopped: ${status}`);
            },
          });
          ztoolkit.log(`[HttpServer] OAuth endpoint: 0.0.0.0:${layout.oauthPort}/mcp`);
        } catch (error) {
          try { this.oauthSocket?.close(); } catch { /* best-effort cleanup */ }
          this.oauthSocket = null;
          const message = `OAuth port ${layout.oauthPort} could not bind. Local MCP remains running. ${error}`;
          ztoolkit.log(`[HttpServer] ${message}`, "error");
          Zotero.getMainWindow()?.alert(message);
        }
      }
''' + s[b:]
a=s.index('    if (!this.isRunning || !this.serverSocket) {')
b=s.index('    // Close the Cloudflare/OAuth socket',a)
s=s[:a]+s[b:]
s=s.replace('      this.serverSocket.close();', '      this.serverSocket?.close();\n      this.serverSocket = null;')
s=s.replace('["Location", "WWW-Authenticate", "Cache-Control", "Allow"]', '["Location", "WWW-Authenticate", "Cache-Control", "Allow", "Retry-After", "X-Frame-Options", "Content-Security-Policy", "Referrer-Policy"]')
a=s.index('          const oauthResult = requiresOAuth')
s=s[:a]+'''          if (!requiresOAuth && oauthServer.isEnabled() && isForwardedRequest(headerText)) {
            const body = JSON.stringify({ error: "wrong_entry_point", message: "Point your public tunnel at the OAuth port, not the unauthenticated MCP port." });
            const headers = this.buildHttpHeaders({ status: 403, statusText: "Forbidden" }, false) +
              `Content-Length: ${getByteLength(body)}\\r\\n\\r\\n`;
            output.write(headers, headers.length);
            writeStringToStream(output, body);
            return;
          }
''' + s[a:]
s=s.replace('!path.startsWith("/ping")', 'path !== "/ping"')
p.write_text(s)
p=root/'src/modules/preferenceScript.ts'
s=p.read_text().replace('import { oauthServer, normalizeOAuthOrigin }', 'import { resolveListenerPorts } from "./oauthTransportPolicy";\nimport { oauthServer, normalizeOAuthOrigin }')
s=s.replace('      const parsed = Number(raw);', '''      const parsed = Number(raw);
      const mcpPort = Number(Zotero.Prefs.get("extensions.zotero.zotero-mcp-plugin.mcp.server.port", true)) || 23120;
      try { resolveListenerPorts(mcpPort, true, true, raw === "" ? 0 : parsed); }
      catch (error) {
        addon.data.prefs!.window.alert(String(error));
        oauthPortInput.value = String(Zotero.Prefs.get(`${prefix}.port`, true) || "");
        return;
      }''')
s=s.replace('      const port = parseInt(portInput.value, 10);', '''      const port = Number(portInput.value);
      try {
        resolveListenerPorts(port, true, oauthServer.isEnabled(),
          Number(Zotero.Prefs.get("extensions.zotero.zotero-mcp-plugin.oauth.port", true)) || 0);
      } catch (error) {
        addon.data.prefs!.window.alert(String(error));
        portInput.value = String(Zotero.Prefs.get("extensions.zotero.zotero-mcp-plugin.mcp.server.port", true) || 23120);
        return;
      }''')
s=s.replace('    if (!enabled.checked) oauthServer.revokeSessions();', '''    if (enabled.checked) {
      try {
        resolveListenerPorts(Number(Zotero.Prefs.get("extensions.zotero.zotero-mcp-plugin.mcp.server.port", true)) || 23120,
          true, true, Number(Zotero.Prefs.get(`${prefix}.port`, true)) || 0);
      } catch (error) { enabled.checked = false; addon.data.prefs!.window.alert(String(error)); return; }
    }
    if (!enabled.checked) oauthServer.revokeSessions();''')
p.write_text(s)

p = root / "src/modules/preferenceScript.ts"
s = p.read_text().replace('const prefix = "extensions.zotero.zotero-mcp-plugin.oauth";', 'const prefix: string = "extensions.zotero.zotero-mcp-plugin.oauth";')
p.write_text(s)
