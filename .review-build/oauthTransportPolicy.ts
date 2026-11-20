/** Fork policy: authentication is attached to an entry point, never to IP headers. */
export function resolveListenerPorts(port: number, remote: boolean, oauth: boolean, configured = 0) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MCP port");
  const active = remote && oauth;
  const oauthPort = configured || port + 1;
  if (active && (!Number.isInteger(oauthPort) || oauthPort < 1 || oauthPort > 65535 || oauthPort === port)) {
    throw new Error("OAuth port must be distinct and between 1 and 65535; set an explicit port when MCP uses 65535");
  }
  return { port, loopbackOnly: !remote, oauthPort: active ? oauthPort : null };
}

/** Denial-only mitigation for an accidentally misrouted proxy. Absence is NOT proof of locality. */
export function isForwardedRequest(headers: string): boolean {
  return /^(?:cf-ray|cf-connecting-ip|cdn-loop|x-forwarded-for|forwarded):/im
    .test(headers.split("\r\n\r\n", 1)[0]);
}
