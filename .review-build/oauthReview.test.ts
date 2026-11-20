import { expect } from 'chai';
import harness from './reviewHarness.cjs';
const { loadTS } = harness;
const BASE = 'https://zotero.example.com';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const PREFIX = 'extensions.zotero.zotero-mcp-plugin.oauth.';
const JSON_HEADER = 'Content-Type: application/json\r\n';
const FORM_HEADER = 'Content-Type: application/x-www-form-urlencoded\r\n';

function fixture() {
  let now = Date.now();
  const module = loadTS('src/modules/oauthServer.ts', {}, { Date: { now: () => now } });
  const state = new Map<string, unknown>();
  let password = '';
  const prefs = { get: (k: string) => state.get(k), set: (k: string, v: unknown) => state.set(k, v) };
  const vault = { read: () => password, write: async (v: string) => { password = v; } };
  const server = new module.MCPAuthServer(prefs, vault);
  const restart = () => new module.MCPAuthServer(prefs, vault);
  return { server, state, restart, advance: (ms: number) => { now += ms; }, module };
}
async function setup() {
  const f = fixture();
  f.state.set(PREFIX + 'serverUrl', BASE);
  const password = await f.server.generatePassword();
  f.state.set(PREFIX + 'enabled', true);
  return { ...f, password };
}
async function call(server: any, path: string, data: object) {
  const registration = path === '/oauth/register';
  return server.handleRequest('POST', path, new URLSearchParams(),
    registration ? JSON.stringify(data) : new URLSearchParams(data as Record<string, string>).toString(),
    registration ? JSON_HEADER : FORM_HEADER);
}
async function grant(f: any) {
  const registered = await call(f.server, '/oauth/register', { redirect_uris: [CALLBACK] });
  expect(registered.status).to.equal(201);
  const id = JSON.parse(registered.body).client_id;
  const verifier = 'a'.repeat(64);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = Buffer.from(hash).toString('base64url');
  const form = { client_id: id, redirect_uri: CALLBACK, code_challenge: challenge,
    password: f.password, resource: BASE + '/mcp' };
  const accepted = await call(f.server, '/oauth/authorize', form);
  expect(accepted.status).to.equal(302);
  const code = new URL(accepted.headers.Location).searchParams.get('code');
  const exchange = { grant_type: 'authorization_code', client_id: id,
    code, redirect_uri: CALLBACK, code_verifier: verifier };
  const token = await call(f.server, '/oauth/token', exchange);
  expect(token.status).to.equal(200);
  return { id, exchange, ...JSON.parse(token.body) };
}

describe('OAuth review regressions (mocked Zotero storage)', () => {
  it('is disabled by default', () => expect(fixture().server.isEnabled()).to.equal(false));
  for (const origin of ['http://example.com', BASE + '/path', 'https://u:p@example.com', BASE + '?q=1']) {
    it('rejects unsafe origin ' + origin, () => expect(fixture().module.normalizeOAuthOrigin(origin)).to.equal(null));
  }
  it('does not persist anonymous dynamic registrations', async () => {
    const f = await setup();
    await call(f.server, '/oauth/register', { redirect_uris: [CALLBACK] });
    expect(JSON.parse(String(f.state.get(PREFIX + 'persistentState'))).clients).to.have.length(0);
  });
  it('persists only digests and survives restart with live grants', async () => {
    const f = await setup(), g = await grant(f);
    const raw = String(f.state.get(PREFIX + 'persistentState'));
    expect(raw).not.to.include(g.access_token); expect(raw).not.to.include(g.refresh_token);
    expect(await f.restart().isAuthorized('Authorization: Bearer ' + g.access_token)).to.equal(true);
  });
  it('rejects a replayed refresh and revokes that client, including after restart', async () => {
    const f = await setup(), g = await grant(f);
    const form = { grant_type: 'refresh_token', client_id: g.id, refresh_token: g.refresh_token };
    const renewed = JSON.parse((await call(f.server, '/oauth/token', form)).body);
    const restarted = f.restart();
    expect((await call(restarted, '/oauth/token', form)).status).to.equal(400);
    expect(await restarted.isAuthorized('Authorization: Bearer ' + renewed.access_token)).to.equal(false);
  });
  it('revokes issued tokens when the authorization code is replayed', async () => {
    const f = await setup(), g = await grant(f);
    expect((await call(f.server, '/oauth/token', g.exchange)).status).to.equal(400);
    expect(await f.server.isAuthorized('Authorization: Bearer ' + g.access_token)).to.equal(false);
  });
  it('recycles inactive registrations without deleting active clients', async () => {
    const f = await setup(), g = await grant(f);
    for (let i = 0; i < 170; i++) {
      if (i % 40 === 0) f.advance(60_001);
      expect((await call(f.server, '/oauth/register', { redirect_uris: [CALLBACK] })).status).to.equal(201);
    }
    expect(await f.server.isAuthorized('Authorization: Bearer ' + g.access_token)).to.equal(true);
    expect(JSON.parse(String(f.state.get(PREFIX + 'persistentState'))).clients).to.have.length(1);
  });
  it('rate-limits registration bursts with Retry-After', async () => {
    const f = await setup(); let result;
    for (let i = 0; i < 61; i++) result = await call(f.server, '/oauth/register', { redirect_uris: [CALLBACK] });
    expect(result.status).to.equal(429); expect(result.headers['Retry-After']).to.equal('60');
  });
  it('rejects too many redirect URIs', async () => {
    const f = await setup();
    expect((await call(f.server, '/oauth/register', { redirect_uris: ['a','b','c','d'].map(x => BASE + '/' + x) })).status).to.equal(400);
  });
  it('rejects oversized redirect metadata', async () => {
    const f = await setup();
    expect((await call(f.server, '/oauth/register', { redirect_uris: [BASE + '/' + 'x'.repeat(512)] })).status).to.equal(400);
  });
  it('preserves operator fixed clients without a token', async () => {
    const f = await setup(); f.server.saveFixedClient('operator', CALLBACK);
    expect(f.restart().listFixedClients().map((x: any) => x.clientID)).to.include('operator');
  });
  it('revokes grants on disable but retains fixed configuration', async () => {
    const f = await setup(), g = await grant(f); f.server.saveFixedClient('operator', CALLBACK);
    f.state.set(PREFIX + 'enabled', false); f.server.revokeSessions(); f.state.set(PREFIX + 'enabled', true);
    expect(await f.restart().isAuthorized('Authorization: Bearer ' + g.access_token)).to.equal(false);
    expect(f.restart().listFixedClients()).to.have.length(1);
  });
  it('includes anti-framing and canonical host in consent', async () => {
    const f = await setup();
    const id = JSON.parse((await call(f.server, '/oauth/register', { redirect_uris: [CALLBACK] })).body).client_id;
    const result = await f.server.handleRequest('GET', '/oauth/authorize', new URLSearchParams({
      response_type: 'code', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43),
      client_id: id, redirect_uri: CALLBACK }), '', '');
    expect(result.headers['X-Frame-Options']).to.equal('DENY');
    expect(result.body).to.include('<strong>chatgpt.com</strong>');
  });
  it('does not rotate a digest when vault write fails', async () => {
    const f = await setup(), hash = f.state.get(PREFIX + 'passwordHash');
    const broken = new f.module.MCPAuthServer({ get: (k: string) => f.state.get(k), set: (k: string, v: unknown) => f.state.set(k, v) },
      { read: () => null, write: async () => { throw new Error('storage failure'); } });
    let failed = false; try { await broken.generatePassword(); } catch { failed = true; }
    expect(failed).to.equal(true); expect(f.state.get(PREFIX + 'passwordHash')).to.equal(hash);
  });
});

describe('Fork entry-point policy', () => {
  const { resolveListenerPorts, isForwardedRequest } = loadTS('src/modules/oauthTransportPolicy.ts');
  for (const remote of [false, true]) for (const oauth of [false, true]) {
    it(`remote=${remote}, oauth=${oauth}`, () => {
      const layout = resolveListenerPorts(23120, remote, oauth);
      expect(layout.loopbackOnly).to.equal(!remote);
      expect(layout.oauthPort).to.equal(remote && oauth ? 23121 : null);
    });
  }
  it('supports a custom authenticated port', () => expect(resolveListenerPorts(23120, true, true, 24444).oauthPort).to.equal(24444));
  it('refuses colliding ports', () => expect(() => resolveListenerPorts(23120, true, true, 23120)).to.throw());
  it('refuses implicit overflow', () => expect(() => resolveListenerPorts(65535, true, true)).to.throw());
  it('permits maximum MCP port with explicit valid OAuth port', () => expect(resolveListenerPorts(65535, true, true, 24444).oauthPort).to.equal(24444));
  it('uses proxy markers only as a denial signal', () => {
    expect(isForwardedRequest('GET /mcp HTTP/1.1\r\nCF-Ray: test\r\n')).to.equal(true);
    expect(isForwardedRequest('GET /mcp HTTP/1.1\r\n\r\nCF-Ray: body')).to.equal(false);
  });
});
