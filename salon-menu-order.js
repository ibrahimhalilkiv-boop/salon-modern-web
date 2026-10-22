(function(){
  'use strict';
  function arrange(){
    var drawer=document.querySelector('#drawerLayer .drawer');if(!drawer)return;
    var selectors=["[onclick=\"drawerPage('home')\"]","[onclick=\"drawerPage('calendar')\"]","[onclick=\"drawerPage('statistics')\"]",'#drawerEmployeePerformance','#finance230Menu','#drawerProducts','#drawerProductSale','#drawerDebts','#drawerCustomers','#drawerSmartAnalysis','#drawerSalonAI'];
    var buttons=selectors.map(function(selector){return drawer.querySelector(selector)}).filter(Boolean);
    if(!buttons.length)return;
    var marker=document.createComment('primary menu order');drawer.insertBefore(marker,buttons[0]);
    buttons.forEach(function(button){
      // Retain permissions formerly inherited from the finance menu group.
      if(button.parentElement.closest('.manager-menu'))button.classList.add('manager-menu');
      drawer.insertBefore(button,marker);
    });
    marker.remove();
    [['drawerCashSeparator','finance230Menu'],['drawerCustomersSeparator','drawerDebts']].forEach(function(pair){
      var target=document.getElementById(pair[1]);if(!target)return;
      var separator=document.getElementById(pair[0]);
      if(!separator){separator=document.createElement('hr');separator.id=pair[0]}
      separator.className='drawer-separator manager-menu';
      // currentUser is a top-level let, not a property of window.
      separator.classList.toggle('hidden',typeof currentUser==='undefined'||currentUser?.role!=='yonetici');
      drawer.insertBefore(separator,target);
    });
    drawer.querySelectorAll('#appVersion,[data-app-version]').forEach(function(node){node.remove()});
    drawer.querySelectorAll(':scope > .manager-menu > .drawer-separator').forEach(function(separator){separator.classList.add('hidden')});
    document.getElementById('drawerRecoveryCenter')?.classList.add('hidden');
    // Restore the existing device-specific Web Push settings and test menu.
    // Available to employees as well as managers; does not send anything until tapped.
    var pushMenu=drawer.querySelector('[data-push-settings-menu]');
    if(!pushMenu){
      pushMenu=document.createElement('button');
      pushMenu.type='button';
      pushMenu.className='menu-item';
      pushMenu.setAttribute('data-push-settings-menu','');
      pushMenu.textContent='🔔  Bildirim Ayarları / Test';
      pushMenu.addEventListener('click',function(){
        if(document.getElementById('pushSettings'))drawerPage('pushSettings');
        else window.showAppToast?.('Bildirim ayarları açılmadı','Uygulamayı yenileyip tekrar deneyin.');
      });
      var adminMenu=drawer.querySelector("[onclick=\"drawerPage('admin')\"]");
      if(adminMenu)drawer.insertBefore(pushMenu,adminMenu);
      else drawer.appendChild(pushMenu);
    }
  }
  ['simplifyNavigation','enterApp','toggleDrawer'].forEach(function(name){
    var previous=window[name];if(typeof previous!=='function')return;
    window[name]=function(){var result=previous.apply(this,arguments);arrange();return result};
  });
  var drawerScrollStyle=document.createElement('style');
  drawerScrollStyle.textContent='#drawerLayer.open{overflow-y:auto;overscroll-behavior:contain}';
  document.head.appendChild(drawerScrollStyle);
  arrange();
})();
