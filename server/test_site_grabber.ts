import { SiteGrabberEngine, SiteGrabberConfig } from './site_grabber_engine';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runSiteGrabberTests() {
  console.log('=== SUITE 25: PHASE 9.7 SITE GRABBER SUBSYSTEM ===');

  const engine = new SiteGrabberEngine();

  const mockHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Sample Gallery</title></head>
      <body>
        <header>
          <a href="/about.html">About Us</a>
          <a href="https://blog.example.com/posts">Blog</a>
          <a href="https://external.com/ad.html">External Ad</a>
        </header>
        <main>
          <h1>Downloads</h1>
          <img src="/assets/hero.png" alt="Hero" />
          <img src="https://example.com/assets/logo.svg" alt="Logo" />
          <a href="/downloads/archive_2026.zip">Download Archive</a>
          <a href="/media/video_intro.mp4">Watch Intro</a>
          <a href="/docs/guide.pdf">Read Guide</a>
          <a href="/logout">Logout</a>
        </main>
      </body>
    </html>
  `;

  // Test 1: Extract Pictures & Documents with same_host scope
  console.log('[Test 1] Testing Asset Extraction & Same-Host Scope...');
  const config1: SiteGrabberConfig = {
    startUrl: 'https://example.com/index.html',
    maxDepth: 2,
    domainScope: 'same_host',
    fileCategories: ['pictures', 'documents', 'archives'],
    ignorePatterns: ['/logout'],
  };

  const res1 = engine.extractAssetsFromHtml(mockHtml, 'https://example.com/index.html', 1, config1);
  assert(res1.assets.length === 4, 'Should extract hero.png, logo.svg, archive_2026.zip, guide.pdf');
  assert(res1.assets.some(a => a.filename === 'hero.png' && a.category === 'pictures'), 'Found hero.png picture');
  assert(res1.assets.some(a => a.filename === 'archive_2026.zip' && a.category === 'archives'), 'Found archive_2026.zip');
  assert(res1.assets.some(a => a.filename === 'guide.pdf' && a.category === 'documents'), 'Found guide.pdf');

  // Test 2: Subdomain scope resolution
  console.log('[Test 2] Testing Subdomain Scope Traversal...');
  const config2: SiteGrabberConfig = {
    startUrl: 'https://example.com/index.html',
    maxDepth: 2,
    domainScope: 'subdomains',
    fileCategories: ['all'],
  };

  const res2 = engine.extractAssetsFromHtml(mockHtml, 'https://example.com/index.html', 1, config2);
  assert(res2.nextPages.includes('https://blog.example.com/posts'), 'Subdomain blog.example.com allowed for crawl');
  assert(!res2.nextPages.includes('https://external.com/ad.html'), 'External domain external.com filtered out');

  // Test 3: Relative URL resolution
  console.log('[Test 3] Testing Relative to Absolute URL Resolution...');
  const heroAsset = res1.assets.find(a => a.filename === 'hero.png');
  assert(heroAsset?.url === 'https://example.com/assets/hero.png', 'Resolved /assets/hero.png to absolute URL');

  console.log('=== SUITE 25 PASSED: ALL SITE GRABBER TESTS SUCCEEDED ===');
}

runSiteGrabberTests().catch(err => {
  console.error('Site grabber test failed:', err);
  process.exit(1);
});
