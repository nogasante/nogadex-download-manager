import { ProxyAuthManager, USER_AGENT_PRESETS } from './proxy_auth_manager';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runProxyAuthTests() {
  console.log('=== SUITE 26: PHASE 9.8 PROXY & AUTHENTICATION SUBSYSTEM ===');

  const manager = new ProxyAuthManager();

  // Test 1: Proxy Configuration and Bypass Rules
  console.log('[Test 1] Testing Proxy Bypass Rules...');
  manager.setGlobalProxy({
    enabled: true,
    type: 'http',
    host: 'proxy.internal.corp',
    port: 3128,
    bypassHosts: ['localhost', '127.0.0.1', '*.internal.corp'],
  });

  assert(manager.shouldBypassProxy('http://localhost:5005/api') === true, 'Bypasses localhost');
  assert(manager.shouldBypassProxy('https://git.internal.corp/repo.git') === true, 'Bypasses wildcard *.internal.corp');
  assert(manager.shouldBypassProxy('https://speed.cloudflare.com/down') === false, 'Routes external cloudflare.com via proxy');

  // Test 2: Site Credential Matching (Basic Auth Header Injection)
  console.log('[Test 2] Testing Basic Auth Credential Injection...');
  manager.addCredential({
    id: 'cred_1',
    domain: 'members.example.com',
    authType: 'basic',
    username: 'nogadex_user',
    password: 'secret_password_123',
  });

  const h1 = manager.resolveHeadersForUrl('https://members.example.com/downloads/premium.zip');
  const expectedBasic = 'Basic ' + Buffer.from('nogadex_user:secret_password_123').toString('base64');
  assert(h1['Authorization'] === expectedBasic, 'Injected Basic Auth header correctly');
  assert(h1['User-Agent'] === USER_AGENT_PRESETS.chrome_windows, 'Injected default Chrome UA');

  // Test 3: Bearer Token Injection
  console.log('[Test 3] Testing Bearer Token Credential Injection...');
  manager.addCredential({
    id: 'cred_2',
    domain: 'api.storage.com',
    authType: 'bearer',
    token: 'jwt_secure_token_xyz789',
  });

  const h2 = manager.resolveHeadersForUrl('https://api.storage.com/v1/blobs/12345');
  assert(h2['Authorization'] === 'Bearer jwt_secure_token_xyz789', 'Injected Bearer token header');

  // Test 4: Cookie and Custom Header Merging
  console.log('[Test 4] Testing Cookie & Custom Header Merging...');
  manager.addCredential({
    id: 'cred_3',
    domain: 'custom.cdn.net',
    authType: 'cookie',
    cookies: 'session_id=abc1234; tier=vip',
    customHeaders: {
      'X-Custom-Client': 'Nogadex-VIP-Client',
    },
  });

  const h3 = manager.resolveHeadersForUrl('https://custom.cdn.net/stream/video.mp4', 'firefox_windows');
  assert(h3['Cookie'] === 'session_id=abc1234; tier=vip', 'Injected cookies');
  assert(h3['X-Custom-Client'] === 'Nogadex-VIP-Client', 'Injected custom headers');
  assert(h3['User-Agent'] === USER_AGENT_PRESETS.firefox_windows, 'Applied Firefox UA preset');

  console.log('=== SUITE 26 PASSED: ALL PROXY & AUTH TESTS SUCCEEDED ===');
}

runProxyAuthTests().catch(err => {
  console.error('Proxy & Auth test failed:', err);
  process.exit(1);
});
