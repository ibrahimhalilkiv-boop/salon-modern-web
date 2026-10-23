// Browser fixture: product removal keeps stock and sales history, without touching live data.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const root=process.cwd(),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg'};

(async()=>{
  const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const width of [360,1280]){
      const page=await browser.newPage({viewport:{width,height:800},isMobile:width<600,hasTouch:width<600,serviceWorkers:'block'});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://oxuwwjsakhcqimjsfris.supabase.co/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
      await page.goto(`http://127.0.0.1:${server.address().port}/salon-modern.html`,{waitUntil:'networkidle'});
      await page.evaluate(async()=>{
        currentUser={id:'manager-fixture',role:'yonetici',name:'Halil Kıv'};
        window.salonHistoryState='ready';window.salonCalendarLoadState={status:'ready'};
        document.getElementById('app').classList.remove('hidden');document.getElementById('auth').classList.add('hidden');
        document.getElementById('finance230Closing')?.remove();document.getElementById('finance230Reserve')?.remove();document.getElementById('summaryCard')?.remove();
        window.__fixtureProducts=[{id:'p0',name:'Stoğu biten',stock_quantity:0,sale_price:100,active:true},{id:'p5',name:'Satıştan kalkacak',stock_quantity:5,sale_price:200,active:true},{id:'old',name:'Önceden kaldırılan',stock_quantity:0,sale_price:300,active:false}];
        window.__fixtureWrites=[];
        salonDb={from(table){const query={table,payload:null,id:null,select(){return this},order(){return this},limit(){return this},eq(field,value){if(field==='id')this.id=value;return this},update(payload){this.payload=payload;return this},single(){const row=window.__fixtureProducts.find(p=>p.id===this.id);if(this.table!=='products'||!row)return Promise.resolve({data:null,error:{message:'fixture row missing'}});window.__fixtureWrites.push({table:this.table,id:this.id,payload:this.payload});Object.assign(row,this.payload);return Promise.resolve({data:{...row},error:null})},then(resolve,reject){return Promise.resolve({data:this.table==='products'?window.__fixtureProducts.map(p=>({...p})):[],error:null}).then(resolve,reject)}};return query}};
        await loadFinance230(true);
        document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
        document.getElementById('salonProducts').classList.add('active');
      });
      assert.equal(await page.locator('#finance230ActiveProducts .finance230-product-entry').count(),2);
      assert.equal(await page.locator('#finance230ActiveProducts .finance230-product-remove').count(),2);
      assert.doesNotMatch(await page.locator('#finance230ActiveProducts').innerText(),/Önceden kaldırılan/);
      assert.match(await page.locator('.finance230-archived-products summary').innerText(),/1/);
      assert.equal(await page.locator('#finance230Sale .finance230-product').count(),2);
      assert.deepEqual(await page.locator('#f230UsageProduct option').allTextContents(),['Satıştan kalkacak · stok 5 · ₺200,00'],'Zero-stock products are excluded from usage selection');
      if(process.env.SALON_PRODUCT_SCREENSHOT&&width===360)await page.screenshot({path:process.env.SALON_PRODUCT_SCREENSHOT,fullPage:true});
      await page.locator('#finance230ActiveProducts .finance230-product-entry').first().locator('.finance230-product-remove').click();
      assert.match(await page.locator('#finance230ProductActionForm').textContent(),/Mevcut stok: 0 adet/);
      await page.locator('#finance230ProductActionForm button.save').click();
      await page.waitForFunction(()=>window.__fixtureProducts.find(p=>p.id==='p0').active===false);
      assert.equal(await page.locator('#finance230ActiveProducts .finance230-product-entry').count(),1);
      assert.equal(await page.locator('#finance230Sale .finance230-product').count(),1);
      assert.equal(await page.evaluate(()=>window.__fixtureProducts.length),3,'No product record was deleted');
      await page.locator('.finance230-archived-products summary').click();
      await page.locator('#finance230ArchivedProducts .finance230-open-row').filter({hasText:'Stoğu biten'}).click();
      await page.locator('#finance230ProductActionForm button').filter({hasText:'yeniden etkinleştir'}).click();
      await page.locator('#finance230ProductActionForm button.save').click();
      await page.waitForFunction(()=>window.__fixtureProducts.find(p=>p.id==='p0').active===true);
      assert.equal(await page.locator('#finance230ActiveProducts .finance230-product-entry').count(),2);
      await page.evaluate(()=>addFinance230Cart('p5'));
      assert.equal(await page.locator('#finance230Cart .fab').count(),1,'Product is in the cart before removal');
      await page.locator('#finance230ActiveProducts .finance230-product-entry').filter({hasText:'Satıştan kalkacak'}).locator('.finance230-product-remove').click();
      await page.locator('#finance230ProductActionForm button.save').click();
      await page.waitForFunction(()=>window.__fixtureProducts.find(p=>p.id==='p5').active===false);
      assert.equal(await page.locator('#finance230Cart .fab').count(),0,'Removing a product clears it from an open cart');
      const changes=await page.evaluate(()=>({writes:window.__fixtureWrites,stock:window.__fixtureProducts.find(p=>p.id==='p0').stock_quantity,otherStock:window.__fixtureProducts.find(p=>p.id==='p5').stock_quantity,scrollWidth:document.documentElement.scrollWidth}));
      assert.deepEqual(changes.writes.map(w=>w.payload),[{active:false},{active:true},{active:false}]);
      assert.equal(changes.stock,0,'Removal and restore leave stock unchanged');
      assert.equal(changes.otherStock,5,'Removal does not erase remaining stock');
      assert(changes.scrollWidth<=width+1,'Product actions fit the viewport');
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('PASS product removal: zero-stock and active products can be archived and restored; active/sale lists, stock, history and mobile layout remain safe');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
