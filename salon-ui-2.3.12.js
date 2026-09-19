(function(){
'use strict';

window.SALON_APP_VERSION='2.3.14';

var style=document.createElement('style');
style.textContent=
  '.appointment-debt-name{color:#b42318!important}'+
  '#calendar>.content{padding:4px 7px 3px!important}'+
  '#calendar>.content>div:first-child{min-height:36px;gap:8px!important;margin-bottom:1px!important}'+
  '#calendar .page-title{font-size:21px!important;margin:0!important;line-height:1.1}'+
  '#calendar .calendar-date-nav{margin:0 0 2px!important;min-height:35px}'+
  '#calendar .calendar-date-nav button{padding:5px 9px}'+
  '#calendar .section{margin:2px 0 3px!important;min-height:25px}'+
  '#calendar .section h2{font-size:15px!important;line-height:1.15}'+
  '#calendar .team-calendar-wrap{overflow-x:auto!important;overflow-y:visible!important;padding:0!important;overscroll-behavior-x:contain}'+
  '#calendar .team-calendar.duration-hour-grid{min-width:360px;margin-top:0!important;grid-template-rows:auto repeat(64,clamp(8px,calc(1.470588vh - 2.794px),10.5px)) clamp(32px,calc(5.882353vh - 11.176px),42px)!important;grid-template-rows:auto repeat(64,clamp(8px,calc(1.470588svh - 2.794px),10.5px)) clamp(32px,calc(5.882353svh - 11.176px),42px)!important}'+
  '#calendar .team-calendar.duration-hour-grid>.duration-end,#calendar .team-calendar.duration-hour-grid>.duration-end-cell{height:100%!important;min-height:32px!important}'+
  '#calendar .calendar-hint{font-size:9px!important;line-height:1.2;margin:2px 0 0!important;padding:0 1px}'+
  '.finance230-single-cash>div{display:none!important}'+
  '.page.salon-page-slide{animation:salonPageSlide .14s ease-out}'+
  '@keyframes salonPageSlide{from{opacity:.72;transform:translateX(var(--salon-slide-x,10px))}to{opacity:1;transform:translateX(0)}}';
document.head.appendChild(style);

function syncVersion(){
  var value='v'+window.SALON_APP_VERSION;
  document.querySelectorAll('#appVersion,[data-app-version]').forEach(function(node){node.textContent=value});
  document.querySelectorAll('.auth small').forEach(function(node){if(/^v\d+\.\d+\.\d+$/.test(node.textContent.trim()))node.textContent=value});
}

var swipeRouteKey='';
var routes=[
  {key:'home',page:'home',open:function(){showPage('home')}},
  {key:'calendar',page:'calendar',open:function(){showPage('calendar')}},
  {key:'statistics',page:'statistics',open:function(){showPage('statistics')}},
  {key:'analysis',page:'smartAnalysis',open:function(){showPage('smartAnalysis')}},
  {key:'recovery',page:'recoveryCenter',manager:true,open:function(){showPage('recoveryCenter')}},
  {key:'performance',page:'employeePerformance',manager:true,open:function(){showPage('employeePerformance')}},
  {key:'customers',page:'customers',manager:true,open:function(){showPage('customers')}},
  {key:'debts',page:'debts',manager:true,open:function(){showPage('debts')}},
  {key:'accounting',page:'finance',manager:true,open:function(){showPage('finance')}},
  {key:'cash',page:'salonFinance',manager:true,open:function(){openFinance230('closing')}},
  {key:'products',page:'salonProducts',manager:true,open:function(){openFinance230Products()}},
  {key:'sale',page:'salonFinance',manager:true,open:function(){openFinance230('sale')}},
  {key:'admin',page:'admin',manager:true,open:function(){showPage('admin')}}
];

function availableRoutes(){
  var isManager=currentUser&&currentUser.role==='yonetici';
  return routes.filter(function(route){return (!route.manager||isManager)&&document.getElementById(route.page)});
}

function inferRoute(id){
  if(id==='salonFinance')return swipeRouteKey==='sale'?'sale':'cash';
  var route=routes.find(function(item){return item.page===id});
  return route?route.key:'';
}

var previousShowPage=showPage;
showPage=function(id){
  var result=previousShowPage.apply(this,arguments);
  var active=document.querySelector('.page.active');
  if(active){var inferred=inferRoute(active.id);if(inferred)swipeRouteKey=inferred}
  syncVersion();
  return result;
};
window.showPage=showPage;

if(typeof openFinance230==='function'){
  var previousOpenFinance230=openFinance230;
  openFinance230=function(tab){swipeRouteKey=tab==='sale'?'sale':'cash';return previousOpenFinance230.apply(this,arguments)};
  window.openFinance230=openFinance230;
}
if(typeof openFinance230Products==='function'){
  var previousOpenFinance230Products=openFinance230Products;
  openFinance230Products=function(){swipeRouteKey='products';return previousOpenFinance230Products.apply(this,arguments)};
  window.openFinance230Products=openFinance230Products;
}
if(typeof finance230Tab==='function'){
  var previousFinance230Tab=finance230Tab;
  finance230Tab=function(tab){if(tab==='sale')swipeRouteKey='sale';else if(tab==='closing'||tab==='reserve')swipeRouteKey='cash';return previousFinance230Tab.apply(this,arguments)};
  window.finance230Tab=finance230Tab;
}

function isInteractiveTarget(target){
  if(!target||!target.closest)return true;
  if(target.closest('input,select,textarea,button,a,label,[contenteditable="true"],.modal,.finance230-confirm,.drawer'))return true;
  var horizontal=target.closest('.team-calendar-wrap,.smart-scroll,.assistant-examples,.phase2-occupancies,.phase2-chips,.finance230-tabs,.finance230-accounting-nav');
  if(horizontal&&horizontal.scrollWidth>horizontal.clientWidth+2)return true;
  return false;
}

function navigateBySwipe(direction){
  var active=document.querySelector('.page.active');
  if(!active||active.id==='calendar')return;
  var list=availableRoutes(),key=swipeRouteKey||inferRoute(active.id),index=list.findIndex(function(route){return route.key===key});
  if(index<0)return;
  var next=index+direction;
  if(next<0||next>=list.length)return;
  document.documentElement.style.setProperty('--salon-slide-x',direction>0?'12px':'-12px');
  list[next].open();
  var nextPage=document.querySelector('.page.active');
  if(nextPage){nextPage.classList.remove('salon-page-slide');void nextPage.offsetWidth;nextPage.classList.add('salon-page-slide')}
}

function installPageSwipe(){
  var app=document.getElementById('app');
  if(!app||app.dataset.pageSwipe==='1')return;
  app.dataset.pageSwipe='1';
  var startX=0,startY=0,blocked=true;
  app.addEventListener('touchstart',function(event){
    var active=document.querySelector('.page.active'),touch=event.touches&&event.touches[0];
    blocked=!touch||!active||active.id==='calendar'||document.querySelector('.modal.show,.drawer-layer.open,.finance230-confirm:not(.hidden)')||isInteractiveTarget(event.target);
    if(touch){startX=touch.clientX;startY=touch.clientY}
  },{passive:true});
  app.addEventListener('touchend',function(event){
    if(blocked)return;
    var touch=event.changedTouches&&event.changedTouches[0];if(!touch)return;
    var dx=touch.clientX-startX,dy=touch.clientY-startY;
    if(Math.abs(dx)<64||Math.abs(dx)<=Math.abs(dy)*1.4)return;
    app.dataset.pageSwipedUntil=String(Date.now()+450);
    navigateBySwipe(dx<0?1:-1);
  },{passive:true});
  app.addEventListener('click',function(event){
    if(Number(app.dataset.pageSwipedUntil||0)>Date.now()){event.preventDefault();event.stopPropagation()}
  },true);
}

syncVersion();
installPageSwipe();
setTimeout(function(){syncVersion();installPageSwipe()},200);
})();
