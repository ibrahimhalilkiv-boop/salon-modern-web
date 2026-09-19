(function () {
  'use strict';
  var style = document.createElement('style');
  style.id = 'salonDesktopLayout';
  style.textContent = '@media (min-width:900px){'+
    'html,body{min-width:100%;background:#f7f5ef}'+
    '.app{width:100%;max-width:none;min-height:100vh;margin:0;padding-bottom:30px}'+
    '.auth{width:100%;max-width:none;min-height:100vh;padding-left:max(24px,calc((100vw - 520px)/2));padding-right:max(24px,calc((100vw - 520px)/2))}'+
    '.top{border-radius:0 0 32px 32px;padding-left:clamp(28px,4vw,72px);padding-right:clamp(28px,4vw,72px)}'+
    '.content{width:100%;max-width:none;padding:28px clamp(28px,4vw,72px)}'+
    '.team-calendar-wrap{width:100%;overflow-x:auto}'+
    '.team-calendar{width:100%;min-width:820px}'+
    '.drawer{width:min(380px,34vw)}'+
    '.sheet{width:min(680px,100%);max-height:92vh;overflow:auto}'+
    '.stats-grid,.customer-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}'+
    '.actions{grid-template-columns:repeat(4,minmax(140px,1fr))}'+
  '}';
  document.head.appendChild(style);
})();
