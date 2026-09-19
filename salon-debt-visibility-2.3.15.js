(function(){
'use strict';

window.SALON_APP_VERSION='2.3.15';

/* A customer is marked only while a positive debt is still outstanding.
   customer_id is the primary match; appointment_id remains supported for
   legacy debt rows. Phone and customer name are deliberately not identities. */
function debtIsOutstanding(debt){
  if(!debt||Number(debt.amount||0)<=0)return false;
  var status=String(debt.status||'open').trim().toLocaleLowerCase('tr-TR');
  return !['paid','closed','cancelled','canceled','void','voided','deleted'].includes(status);
}

window.appointmentHasOpenDebt=function(item){
  if(!item||!Array.isArray(remoteDebts))return false;
  var appointmentId=String(item.id||''),clientId=String(item.clientId||'');
  return remoteDebts.some(function(debt){
    if(!debtIsOutstanding(debt))return false;
    if(appointmentId&&String(debt.appointment_id||'')===appointmentId)return true;
    return !!clientId&&String(debt.client_id||'')===clientId;
  });
};

function repaintDebtNames(){
  if(typeof renderCalendar==='function')renderCalendar();
  if(typeof renderStatistics==='function')renderStatistics();
  if(typeof renderCustomers==='function')renderCustomers();
  if(typeof renderCustomerDetail==='function')renderCustomerDetail();
}

/* Payment used to refresh only payment history. Refresh the debt rows too so
   a fully paid name becomes normal immediately, without waiting for Realtime. */
if(typeof saveDebtPayment==='function'){
  var saveDebtPaymentBeforeDebtVisibility=saveDebtPayment;
  window.saveDebtPayment=async function(event){
    var result=await saveDebtPaymentBeforeDebtVisibility.apply(this,arguments);
    if(currentUser&&currentUser.role==='yonetici'&&typeof loadV151Supplement==='function'){
      await loadV151Supplement();
      repaintDebtNames();
    }
    return result;
  };
}

/* Keep manual paid/deletion flows deterministic even when the Realtime event
   arrives late or the phone briefly loses connectivity. */
['markDebtPaid','confirmDebtDeletion'].forEach(function(name){
  if(typeof window[name]!=='function')return;
  var previous=window[name];
  window[name]=async function(){
    var result=await previous.apply(this,arguments);
    if(currentUser&&currentUser.role==='yonetici'&&typeof loadV151Supplement==='function'){
      await loadV151Supplement();
      repaintDebtNames();
    }
    return result;
  };
});

document.querySelectorAll('#appVersion,[data-app-version]').forEach(function(node){node.textContent='v2.3.15'});
document.querySelectorAll('.auth small').forEach(function(node){if(/^v\d+\.\d+\.\d+$/.test(node.textContent.trim()))node.textContent='v2.3.15'});
})();
