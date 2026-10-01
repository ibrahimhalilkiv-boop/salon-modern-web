const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const own='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
let handler,active=true,actorRole='employee',reads=[];
function client(privileged,token){return {auth:{getUser:async value=>({data:{user:value==='valid'?{id:'employee1'}:null},error:null})},from(table){let ids=[],filters={};return {select(fields){reads.push({table,fields,privileged});return this},eq(key,value){filters[key]=value;return this},in(key,values){ids=values;reads.push({table,ids:values,privileged});return this},maybeSingle(){return Promise.resolve({data:active&&(!filters.role||filters.role===actorRole)?{id:'employee1'}:null})},then(resolve,reject){let data=table==='appointments'?ids.filter(id=>actorRole==='manager'||id===own).map(id=>({id})):table==='online_booking_requests'?ids.map(id=>({appointment_id:id})):[];return Promise.resolve({data,error:null}).then(resolve,reject)}}}}}
const service=client(true);
const ctx=vm.createContext({createClient:(_url,key,options)=>key==='service'?service:client(false,options.global.headers.Authorization),Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service':'anon'},serve:fn=>handler=fn},Request,Response,URL,Intl,Date,crypto,TextEncoder,console});
const code=fs.readFileSync('supabase/functions/customer-booking-request/index.ts','utf8').replace(/^import[^\n]+\n/,'');
vm.runInContext(stripTypeScriptTypes(code,{mode:'transform'}),ctx);
const call=(ids,token='valid')=>handler(new Request('https://test/?action=admin-list&sourceIds='+encodeURIComponent(ids),{headers:{Authorization:'Bearer '+token,Origin:'https://app.salonmodern.com.tr'}}));
(async()=>{
 let response=await call(own+','+other);assert.equal(response.status,200);assert.deepEqual(await response.json(),{sourceAppointmentIds:[own]});
assert(reads.some(r=>r.table==='appointments'&&!r.privileged));assert.deepEqual(Array.from(reads.find(r=>r.table==='online_booking_requests'&&r.ids).ids),[own]);
 assert.equal(reads.find(r=>r.table==='online_booking_requests'&&r.fields).fields,'appointment_id','Do not expose private request columns');
 reads=[];response=await call(other);assert.deepEqual(await response.json(),{sourceAppointmentIds:[]});assert(!reads.some(r=>r.table==='online_booking_requests'));
 response=await call(own,'invalid');assert.equal(response.status,401);
 active=false;response=await call(own);assert.equal(response.status,403);active=true;
 response=await call('bad-id');assert.equal(response.status,400);
 response=await call(Array(201).fill(own).join(','));assert.equal(response.status,400);
 actorRole='manager';response=await call(own+','+other);assert.deepEqual(await response.json(),{sourceAppointmentIds:[own,other]});
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://app.salonmodern.com.tr');
 console.log('PASS appointment source endpoint authentication, active profile, RLS-scoped IDs, minimal disclosure, manager access and CORS');
})().catch(error=>{console.error(error);process.exitCode=1});
