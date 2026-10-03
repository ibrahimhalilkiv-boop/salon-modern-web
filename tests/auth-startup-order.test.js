const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('salon-modern.html','utf8');
const boot=html.match(/document\.addEventListener\('DOMContentLoaded',function\(\)\{startRemoteApp\(\)\},\{once:true\}\);/);
assert(boot,'Cold startup must wait for parser-blocking auth scripts');
assert(!/setTimeout\(function\(\)\{startRemoteApp\(\)\},0\)/.test(html),'Old zero-delay startup races external script downloads');
let listener,legacyCalls=0,safeCalls=0;
const context={document:{addEventListener:(event,fn,options)=>{assert.equal(event,'DOMContentLoaded');assert.equal(options.once,true);listener=fn}},startRemoteApp:()=>legacyCalls++};
vm.runInNewContext(boot[0],context);
assert.equal(legacyCalls,0,'No legacy startup while external scripts load');
// The final auth override finishes downloading before DOMContentLoaded.
context.startRemoteApp=()=>safeCalls++;
listener();assert.equal(legacyCalls,0);assert.equal(safeCalls,1);
assert(html.indexOf('pwa-stability-2.3.20.js')>html.indexOf(boot[0]),'Test covers actual late auth override');
console.log('PASS cold startup order: delayed auth script cannot invoke legacy login fallback');
