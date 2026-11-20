import { expect } from 'chai';
import harness from './reviewHarness.cjs';
const { loadTS } = harness;
function fixture(remote: boolean, enabled: boolean, failOAuth = false) {
  const sockets: any[] = [], alerts: string[] = [];
  const policy = loadTS('src/modules/oauthTransportPolicy.ts');
  const module = loadTS('src/modules/httpServer.ts', {
    './mcpTest': { testMCPIntegration() {} },
    '../../package.json': { version: '1.7.0' },
    './streamableMCPServer': { StreamableMCPServer: class {} },
    './serverPreferences': { serverPreferences: { isRemoteAccessAllowed: () => remote, getOAuthPort: () => 0 } },
    './httpRequestReader': { getByteLength: (v: string) => Buffer.byteLength(v) },
    './oauthServer': { oauthServer: { isEnabled: () => enabled } },
    './oauthTransportPolicy': policy,
  }, {
    Cc: {
      '@mozilla.org/network/server-socket;1': { createInstance() {
        const socket = { port: 0, loopback: false, closed: false,
          init(port: number, loopback: boolean) { if (failOAuth && port === 23121) throw new Error('address in use'); this.port = port; this.loopback = loopback; },
          asyncListen() {}, close() { this.closed = true; } };
        sockets.push(socket); return socket;
      } },
    }, Ci: {}, Zotero: { debug() {}, getMainWindow: () => ({ alert: (v: string) => alerts.push(v) }) },
    ztoolkit: { log() {} },
  });
  const server = new module.HttpServer();
  server.startSessionCleanup = () => {}; server.stopSessionCleanup = () => {};
  return { server, sockets, alerts };
}
describe('HTTP listener lifecycle review', () => {
  for (const remote of [false, true]) for (const oauth of [false, true]) {
    it(`binds actual sockets for remote=${remote}, oauth=${oauth}`, () => {
      const f = fixture(remote, oauth); f.server.start(23120);
      expect(f.sockets[0].loopback).to.equal(!remote);
      expect(f.sockets.length).to.equal(remote && oauth ? 2 : 1);
      if (remote && oauth) expect(f.sockets[1].port).to.equal(23121);
      f.server.stop(); expect(f.sockets.every(s => s.closed)).to.equal(true);
    });
  }
  it('keeps the unauthenticated listener alive if OAuth cannot bind', () => {
    const f = fixture(true, true, true); f.server.start(23120);
    expect(f.server.isServerRunning()).to.equal(true); expect(f.sockets[0].closed).to.equal(false);
    expect(f.sockets[1].closed).to.equal(true); expect(f.alerts).to.have.length(1); f.server.stop();
  });
  it('closes OAuth even after the primary running flag is cleared', () => {
    const f = fixture(true, true); f.server.start(23120); f.server.isRunning = false; f.server.stop();
    expect(f.sockets.every(s => s.closed)).to.equal(true);
  });
  it('closes OAuth even without a primary socket reference', () => {
    const f = fixture(true, true); f.server.start(23120); f.server.serverSocket = null; f.server.stop();
    expect(f.sockets[1].closed).to.equal(true);
  });
  it('forwards security headers and refuses CRLF injection', () => {
    const f = fixture(false, false);
    const output = f.server.buildHttpHeaders({ status: 200, statusText: 'OK', headers: {
      'X-Frame-Options': 'DENY', 'Retry-After': '60', Location: 'x\r\nInjected: yes' } }, false);
    expect(output).to.include('X-Frame-Options: DENY'); expect(output).to.include('Retry-After: 60');
    expect(output).not.to.include('Injected');
  });
  it('shutdown is idempotent', () => { const f = fixture(true, true); f.server.start(23120); f.server.stop(); expect(() => f.server.stop()).not.to.throw(); });
});
