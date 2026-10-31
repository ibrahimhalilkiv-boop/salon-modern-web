const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');

const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
const html=fs.readFileSync('salon-modern.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const auth=fs.readFileSync('pwa-stability-2.3.20.js','utf8');
const cream='#f7f6f1';

function readIndexedLogo(path,side){
  const buf=fs.readFileSync(path);
  assert.equal(buf.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Valid PNG');
  const chunks={};
  for(let p=8;p<buf.length;){
    const n=buf.readUInt32BE(p),name=buf.toString('ascii',p+4,p+8);
    (chunks[name] ||= []).push(buf.subarray(p+8,p+8+n));p+=n+12;
    if(name==='IEND')break;
  }
  const ihdr=chunks.IHDR[0];
  assert.equal(ihdr.readUInt32BE(0),side);
  assert.equal(ihdr.readUInt32BE(4),side);
  assert.equal(ihdr[8],8,'8-bit palette indexing');
  assert.equal(ihdr[9],3,'Indexed color suitable for Android/PWA');
  assert.equal(chunks.PLTE[0].length,768);
  const alpha=chunks.tRNS[0];
  assert.equal(alpha.length,256,'Transparent antialiased palette');
  assert.equal(alpha[0],0);
  assert.equal(alpha[255],255);
  const data=zlib.inflateSync(Buffer.concat(chunks.IDAT));
  assert.equal(data.length,side*(side+1));
  let transparent=0,count=0,minX=side,minY=side,maxX=0,maxY=0;
  for(let y=0;y<side;y++){
    assert.equal(data[y*(side+1)],0,'Rows use lossless no-filter encoding');
    for(let x=0;x<side;x++){
      const pixelAlpha=alpha[data[y*(side+1)+x+1]];
      if(pixelAlpha===0)transparent++;
      if(pixelAlpha>22){
        count++;
        minX=Math.min(minX,x);minY=Math.min(minY,y);
        maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      }
    }
  }
  assert.ok(transparent/side/side>0.8,'The background is genuinely transparent, not opaque white');
  assert.ok(count>side*side*0.04,'Lettering and circular outline are retained');
  assert.ok(minX>=Math.floor(side*0.05)&&maxX<=Math.ceil(side*0.95),
    'Enlarged lettering does not clip or leave excessive margins');
  assert.ok(minY>=Math.floor(side*0.05)&&maxY<=Math.ceil(side*0.95));
  return {count,minX,minY,maxX,maxY};
}
const icon512=readIndexedLogo('salon-launch-v2-512.png',512);
const icon192=readIndexedLogo('salon-launch-v2-192.png',192);
assert.ok(icon512.maxX-icon512.minX>405,'Bigger logo artwork than the previous 357px shape');

assert.equal(manifest.background_color,cream);
assert.equal(manifest.theme_color,cream,'Readable dark status icons on light OS splash');
assert.ok(manifest.icons.some(x=>x.src==='salon-launch-v2-512.png'&&x.sizes==='512x512'&&x.purpose==='any'));
assert.ok(manifest.icons.some(x=>x.src==='salon-launch-v2-192.png'&&x.sizes==='192x192'));
const css=html.slice(html.indexOf('/* The native Android splash'),html.indexOf('</style>',html.indexOf('/* The native Android splash')));
assert.match(css,/background:#f7f6f1!important/);
assert.match(css,/#salonStartupSplash\{[^}]*background:#f7f6f1;/s);
assert.match(css,/#salonStartupSplash img\{[^}]*width:min\(66vw,285px\);[^}]*object-fit:contain;background:transparent;/s);
assert.match(css,/#auth\{background:#f7f6f1!important;/);
assert.match(css,/#auth \.salon-auth-logo\{[^}]*width:min\(74vw,310px\)!important;[^}]*object-fit:contain;[^}]*background:transparent!important;/s);
assert.match(html,/<img src="salon-launch-v2-512\.png" width="512" height="512" alt="Salon Modern"/);
assert.match(html,/<link rel="apple-touch-icon" href="salon-launch-v2-512\.png">/);
assert.match(html,/logo\.src='salon-launch-v2-512\.png'/);
assert.match(html,/<meta name="theme-color" content="#f7f6f1">/);
assert.match(auth,/appVisible \? '#0d2925' : '#f7f6f1'/);
assert.match(sw,/salon-modern-shell-pwa-v196/);
assert.match(sw,/\.\/salon-launch-v2-512\.png/);
assert.match(sw,/\.\/salon-launch-v2-192\.png/);
assert.match(html,/pwa-stability-2\.3\.20\.js\?v=105/);
assert.match(sw,/pwa-stability-2\.3\.20\.js\?v=105/);
console.log('PASS native indexed-transparent icon geometry, bigger black lettering, exact splash color, dynamic status bar, and PWA icons');
