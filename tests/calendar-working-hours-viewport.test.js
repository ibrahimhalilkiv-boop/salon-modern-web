const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('salon-calendar-working-hours-2.4.9.js','utf8');
new Function(source); // Syntax check before exercising the calendar.

function fixture(role='personel'){
  let date='2026-11-07',viewportHeight=980,gridTop=270;
  let appointments=[],renders=0;
  const requests=[],listeners={};
  const endLabel={textContent:'24.00',setAttribute(){}};
  const heading={getBoundingClientRect(){return {height:36}}};
  const style={values:{},setProperty(name,value){this.values[name]=value}};
  const grid={
    style,dataset:{},
    getBoundingClientRect(){return {top:gridTop}},
    querySelector(selector){
      if(selector===':scope > .team-head')return heading;
      if(selector==='.duration-end')return endLabel;
      return null;
    },
    querySelectorAll(){return []},
    appendChild(){}
  };
  const document={
    head:{appendChild(){}},
    querySelector(){return grid},
    createElement(){return {style:{},setAttribute(){}}},
    addEventListener(){}
  };
  const user={id:'staff-1',name:'Cengiz',role};
  const rows={
    '2026-11-08':{schedule_date:'2026-11-08',open_time:'08:30',close_time:'23:00',is_closed:false}
  };
  const db={from(table){
    let lookup;
    return {
      select(){return this},
      eq(field,value){lookup=value;return this},
      maybeSingle(){
        requests.push({table,lookup});
        return Promise.resolve({
          data:table==='booking_settings'
            ?{default_open_time:'09:00',default_close_time:'20:00'}
            :(rows[lookup]||null)
        });
      }
    };
  }};
  const window={
    innerHeight:980,visualViewport:{offsetTop:0,height:980,addEventListener(kind,fn){listeners['viewport-'+kind]=fn}},
    salonDb:db,renderCalendar(){renders++},
    addEventListener(kind,fn){listeners['window-'+kind]=fn}
  };
  const sandbox={
    window,document,currentUser:user,teamCalendarMode:'day',teamCalendarMember:undefined,
    get appts(){return appointments},
    appointmentDate(item){return item.date},
    selectedTeamDate(){return date},
    remoteClosedSlots:[],salonDb:db,
    Intl,Date,console
  };
  vm.runInNewContext(source,sandbox);
  async function render(){
    window.renderCalendar();
    await new Promise(resolve=>setImmediate(resolve));
    await new Promise(resolve=>setImmediate(resolve));
    return {rows:style.values['grid-template-rows'],height:style.values.height,
      end:endLabel.textContent,density:grid.dataset.density};
  }
  return {
    render,requests,
    get renders(){return renders},
    setDate(next){date=next},
    setAppointments(next){appointments=next},
    resize(nextHeight,nextTop){
      window.visualViewport.height=nextHeight;
      gridTop=nextTop;
      listeners['viewport-resize']();
      return {rows:style.values['grid-template-rows'],height:style.values.height};
    }
  };
}

(async()=>{
  const employee=fixture();
  const normal=await employee.render();
  assert.equal(normal.height,'705px','Calendar must occupy the remaining viewport (980 - 270 - 5)');
  assert.match(normal.rows,/repeat\(44,minmax\(0,1fr\)\)/,'Eleven working hours stretch to the viewport');
  assert.equal(normal.end,'20.00');
  assert(!normal.rows.includes('19px'),'Do not cap individual calendar rows');

  employee.setDate('2026-11-08');
  const holiday=await employee.render();
  assert.equal(holiday.height,'705px','A longer future workday still fills the same viewport');
  assert.match(holiday.rows,/repeat\(58,minmax\(0,1fr\)\)/,'08:30 to 23:00 has 58 quarter-hour rows');
  assert.equal(holiday.end,'23.00','Date override must load right after date selection');
  assert(employee.requests.some(request=>request.table==='booking_schedule_overrides'&&request.lookup==='2026-11-08'));

  const rotated=employee.resize(610,170);
  assert.equal(rotated.height,'435px','Viewport rotation recalculates the available height');
  assert.match(rotated.rows,/repeat\(58,minmax\(0,1fr\)\)/,'Rotation preserves special-day hours');

  employee.setDate('2026-11-07');
  employee.setAppointments([{date:'2026-11-07',time:'21:30',duration:60,employeeId:'staff-1',staff:'Cengiz'}]);
  const late=await employee.render();
  assert.equal(late.end,'22.30','Existing after-hours appointment remains visible');
  assert.equal(late.height,'435px','Late appointment must not reintroduce blank space');

  const manager=fixture('yonetici');
  const managerNormal=await manager.render();
  assert.equal(managerNormal.rows,normal.rows,'Manager and employee use the same working-hour layout');
  assert.equal(managerNormal.height,normal.height);

  console.log('PASS employee/manager full-height calendars, future overrides, rotation and after-hours appointments');
})().catch(error=>{console.error(error);process.exitCode=1});
