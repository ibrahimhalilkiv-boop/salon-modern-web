const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('salon-modern.html','utf8');
const helper=html.match(/function customerTitleName\(value\)\{[\s\S]*?\n\}/);
assert.ok(helper,'customerTitleName helper');
const context={};
vm.createContext(context);
vm.runInContext(helper[0],context);
for(const [raw,expected] of [
  ['mehmet uncu','Mehmet Uncu'],
  ['ibrahim yaylacık','İbrahim Yaylacık'],
  ['IŞIK  ılgaz','Işık Ilgaz'],
  ['ayşe-nur şEN','Ayşe-Nur Şen'],
]) assert.equal(context.customerTitleName(raw),expected);
assert.match(html,/var name=customerTitleName\(document\.getElementById\('newCustomerName'\)/);
assert.match(html,/name=customerTitleName\(name\);/);
assert.match(html,/customer=registeredClient\?\.full_name\|\|customerTitleName\(customer\)/);

const sql=fs.readFileSync('supabase/migrations/20261104144237_normalize_customer_names.sql','utf8');
assert.match(sql,/create trigger clients_normalize_full_name before insert or update of full_name/);
assert.match(sql,/private\.customer_name_key\(full_name\)=private\.customer_name_key\(request\.client_name\)/);
assert.match(sql,/private\.normalize_tr_phone\(phone\)=private\.normalize_tr_phone\(request\.phone_normalized\)/);
console.log('PASS Turkish customer names: UI, database trigger, and online match');
