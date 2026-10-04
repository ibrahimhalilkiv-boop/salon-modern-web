(function(){
  'use strict';
  function arrange(){
    var drawer=document.querySelector('#drawerLayer .drawer');if(!drawer)return;
    var selectors=["[onclick=\"drawerPage('home')\"]","[onclick=\"drawerPage('calendar')\"]","[onclick=\"drawerPage('statistics')\"]",'#drawerEmployeePerformance','#finance230Menu','#drawerProducts','#drawerProductSale','#drawerDebts','#drawerCustomers','#drawerSmartAnalysis'];
    var buttons=selectors.map(function(selector){return drawer.querySelector(selector)}).filter(Boolean);
    if(!buttons.length)return;
    var marker=document.createComment('primary menu order');drawer.insertBefore(marker,buttons[0]);
    buttons.forEach(function(button){
      // Retain permissions formerly inherited from the finance menu group.
      if(button.parentElement.closest('.manager-menu'))button.classList.add('manager-menu');
      drawer.insertBefore(button,marker);
    });
    marker.remove();
    drawer.querySelectorAll(':scope > .manager-menu > .drawer-separator').forEach(function(separator){separator.classList.add('hidden')});
    document.getElementById('drawerRecoveryCenter')?.classList.add('hidden');
    drawer.querySelectorAll('[data-push-settings-menu]').forEach(function(button){button.remove()});
  }
  ['simplifyNavigation','enterApp','toggleDrawer'].forEach(function(name){
    var previous=window[name];if(typeof previous!=='function')return;
    window[name]=function(){var result=previous.apply(this,arguments);arrange();return result};
  });
  arrange();
})();
