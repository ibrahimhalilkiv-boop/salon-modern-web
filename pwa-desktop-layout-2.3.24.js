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
    '#calendar .content{padding-top:14px;padding-bottom:14px}'+
    '#calendar .calendar-date-nav,#calendar .section,#calendar .team-calendar-wrap,#calendar .calendar-hint{max-width:1180px;margin-left:auto;margin-right:auto}'+
    '#calendar .team-calendar.duration-hour-grid{min-width:0!important;height:calc(100vh - 235px)!important;min-height:560px!important;max-height:820px!important}'+
    '#calendar .team-calendar.duration-hour-grid .team-head{font-size:12px!important}'+
    '#calendar .team-calendar.duration-hour-grid .duration-time{font-size:10px!important}'+
    '#calendar .team-calendar.duration-hour-grid .duration-event{font-size:11px!important;padding:2px 5px!important}'+
    '#calendar .team-calendar.duration-hour-grid .duration-event strong{font-size:12px!important}'+
    '.booking-global-card,.booking-schedule-card{max-width:920px}'+
    '.booking-global-times{grid-template-columns:repeat(2,minmax(220px,1fr))}'+
  '}';
  document.head.appendChild(style);
})();
