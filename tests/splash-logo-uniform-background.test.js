const assert=require('node:assert/strict');
const fs=require('node:fs');

const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
const html=fs.readFileSync('salon-modern.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const splashCss=html.slice(html.indexOf('/* Match the white artwork canvas'),html.indexOf('</style>',html.indexOf('/* Match the white artwork canvas')));
const shell=html.slice(html.indexOf('<body>'),html.indexOf('<section class="auth"',html.indexOf('<body>')));

assert.equal(manifest.background_color,'#ffffff','Native Android splash must exactly match white icon artwork');
assert.equal(manifest.theme_color,'#0d2925','Keep the established dark-green browser UI theme');
assert.ok(manifest.icons.some(icon=>icon.src==='salon-icon-512.png'&&icon.type==='image/png'),'Keep the supported 512px native splash icon');
assert.ok(manifest.icons.some(icon=>icon.src==='salon-icon-192.png'&&icon.type==='image/png'),'Keep the supported 192px PWA icon');

assert.match(splashCss,/html\[data-auth-state="INITIALIZING"\] body\s*\{\s*background:#fff!important/);
assert.match(splashCss,/#salonStartupSplash\s*\{[^}]*position:fixed;[^}]*inset:0;[^}]*display:none;[^}]*align-items:center;[^}]*justify-content:center;[^}]*background:#fff;/s);
assert.match(splashCss,/html\[data-auth-state="INITIALIZING"\] #salonStartupSplash\s*\{\s*display:flex;/);
assert.match(splashCss,/#salonStartupSplash img\s*\{[^}]*width:min\(62vw,260px\);[^}]*object-fit:contain;[^}]*background:#fff;/s);
assert.match(splashCss,/#auth\s*\{background:#fff!important;/);
assert.match(splashCss,/#auth \.salon-auth-logo\s*\{[^}]*width:min\(68vw,265px\)!important;[^}]*border-radius:0!important;[^}]*object-fit:contain;[^}]*background:#fff!important;/s);

assert.match(shell,/<div id="salonStartupSplash" role="status" aria-label="Salon Modern açılıyor">/);
assert.match(shell,/<img src="salon-icon-512\.png" width="512" height="512" alt="Salon Modern" decoding="async" fetchpriority="high">/);
assert.ok(html.indexOf('id="salonStartupSplash"')<html.indexOf('<section class="auth"'), 'Startup image precedes the app login');
assert.ok(html.includes('html[data-auth-state="INITIALIZING"] #auth{display:none!important}') ||
          /html\[data-auth-state="INITIALIZING"\] #auth\s*\{\s*display:none!important;\s*\}/.test(html),
          'Login remains hidden only during auth initialization');
assert.ok(!/setTimeout\([^)]*salonStartupSplash/.test(html),'Splash is controlled by auth state, not a fixed delay');
assert.match(sw,/salon-modern-shell-pwa-v195/);
assert.ok(sw.includes("'./manifest.webmanifest'"));
assert.ok(sw.includes("'./salon-icon-512.png'"));
console.log('PASS white native splash, full-screen responsive logo, auth-state disappearance, and PWA cache');
