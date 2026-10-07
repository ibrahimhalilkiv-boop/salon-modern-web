const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('pwa-stability-2.3.20.js','utf8');
const workerSource=fs.readFileSync('sw.js','utf8');
const htmlSource=fs.readFileSync('salon-modern.html','utf8');
const snippet=source.slice(source.indexOf('  function showUpdate(registration)'),source.lastIndexOf('})();'));

const installBlock=workerSource.slice(workerSource.indexOf("self.addEventListener('install'"),workerSource.indexOf("self.addEventListener('message'"));
assert.doesNotMatch(installBlock,/skipWaiting/,'A new worker must wait for the explicit update action');
assert.match(workerSource,/type === 'SKIP_WAITING'\) self\.skipWaiting\(\)/,'Update action must still activate the waiting worker');
assert.match(workerSource,/salon-modern-shell-pwa-v111/,'The corrected lifecycle must publish through a fresh shell cache');
assert.match(workerSource,/pwa-stability-2\.3\.20\.js\?v=104/);
assert.match(htmlSource,/pwa-stability-2\.3\.20\.js\?v=104/);

let click,reloads=0,posted=0,removed=false,appended=0;
const controllerChanges=[];
const worker={state:'installed',postMessage(message){assert.equal(message.type,'SKIP_WAITING');posted++},addEventListener(event,fn){if(event==='statechange')this.stateChange=fn}};
const button={disabled:false,textContent:'Güncelle',addEventListener:(_,fn)=>click=fn};
const span={textContent:''};
const banner={style:{},innerHTML:'',querySelector:s=>s==='button'?button:span,remove(){removed=true}};
const registration={waiting:worker,installing:null,addEventListener(){},update:()=>Promise.resolve()};
const sw={controller:{},ready:Promise.resolve(registration),addEventListener(event,fn){if(event==='controllerchange')controllerChanges.push(fn)},removeEventListener(){}};
const document={
  getElementById:id=>id==='pwaUpdateBanner'&&!removed&&appended?banner:null,
  createElement:()=>banner,
  body:{appendChild(){appended++}}
};
const context={
  document,navigator:{serviceWorker:sw},location:{protocol:'https:',reload(){reloads++}},
  window:{confirm:()=>true},formIsBusy:()=>false,updateRequested:false,updateReloading:false,
  setTimeout:()=>1,clearTimeout(){}
};
vm.runInNewContext(snippet+';showUpdate(registration);',Object.assign(context,{registration}));
assert.equal(appended,1,'Banner appears only for a real waiting worker');
click();
assert.equal(posted,1,'Update click activates the waiting worker');
controllerChanges.slice().forEach(fn=>fn());
controllerChanges.slice().forEach(fn=>fn());
assert.equal(removed,true,'Controller replacement removes the banner');
assert.equal(reloads,1,'Controller replacement reloads exactly once');

removed=false;appended=0;registration.waiting=null;
assert.doesNotThrow(()=>click(),'A worker that already activated must not leave a stale banner');
assert.equal(removed,true,'Stale banner is removed when no worker is waiting');

removed=false;appended=0;registration.waiting={state:'activated'};
vm.runInNewContext('showUpdate(registration);',Object.assign(context,{registration}));
assert.equal(appended,0,'Activated workers must not show an update banner');
console.log('PASS update banner: waiting-only display, click activation, dismissal and single reload');
