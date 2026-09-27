const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('salon-modern.html', 'utf8');
const swipe = html.match(/function installCalendarDaySwipe\(\)\{[\s\S]*?\n\}/)?.[0] || '';

assert.match(swipe, /touchAction='pan-y'/, 'Takvim yatay hareketi dikey sayfa kaydırmasından ayrılmalı');
assert.match(swipe, /touchmove/, 'Yatay hareket tarayıcı kaydırmasından erken ayrılmalı');
assert.doesNotMatch(swipe, /teamCalendarMode==='month'\)return/, 'Aylık görünüm kaydırmayı engellememeli');
assert.match(swipe, /teamCalendarMode==='month'\)moveTeamMonth\(dx<0\?1:-1\)/, 'Ay görünümünde kaydırma önceki veya sonraki aya geçmeli');
assert.match(swipe, /else moveTeamCalendar\(dx<0\?1:-1\)/, 'Gün görünümünde kaydırma yerel takvim gününü değiştirmeli');
assert.doesNotMatch(swipe, /closest\('button,/, 'Ay gün düğmeleri kaydırma başlangıcını engellememeli');
assert.doesNotMatch(swipe, /reloadRemoteData/, 'Gün kaydırma sırasında ağdan tam veri yenilemesi yapılmamalı');

console.log('PASS month and fast day calendar swipe');
