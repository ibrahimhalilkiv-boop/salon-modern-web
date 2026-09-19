# Salon Modern APK → PWA Envanteri

| Dosya | APK/native kodu | İşlev | Kullanım | PWA karşılığı | İşlem |
|---|---|---|---|---|---|
| `index.html`, `salon-modern.html` | `SalonAndroid` auth storage | Supabase tokenlerini Android SharedPreferences benzeri köprüde saklama | PWA için gereksiz ve oturum yarışına neden oluyordu | Supabase browser persistence (`persistSession`, `autoRefreshToken`) | **REMOVE** — kaldırıldı |
| `salon-voice-2.1.0.js` | `SalonAndroid.startSpeechRecognition` | Türkçe sesli komut | PWA'da çalışmıyordu | Web Speech API, `tr-TR`, yazılı komut fallback'i | **REPLACE WITH WEB** — değiştirildi |
| `index.html`, `salon-modern.html` | `scheduleReminder`, `cancelReminder`, `AlarmManager` köprü çağrıları | Yerel 1 saatlik hatırlatma | PWA'da çağrılmaz; eski APK uyumluluk kodu | Supabase Cron + `web-push-dispatch` + Service Worker push | **KEEP TEMPORARILY** — aktif PWA subscription doğrulanınca kaldırılacak |
| `index.html`, `salon-modern.html` | FCM cihaz kayıt köprüleri | Çalışan atama bildirimi | PWA'da çağrılmaz; eski APK uyumluluk kodu | `web_push_subscriptions` ve Web Push | **KEEP TEMPORARILY** — aktif PWA subscription doğrulanınca kaldırılacak |
| `index.html`, `salon-modern.html` | Native rehber seçimi/aktarımı | Telefon rehberinden müşteri alma | Kullanıcı arayüzünden kaldırıldı | Manuel müşteri adı/telefon girişi | **REMOVE** — erişim noktaları kaldırıldı, ölü bridge fonksiyonları sonraki temizlikte silinebilir |
| `index.html`, `salon-modern.html` | Native müşteri geri-geliş bildirimi | Cihaz içi yerel uyarı | PWA'da çağrılmaz | Uygulama içi analiz kartı mevcut; otomatik Web Push henüz doğrulanmadı | **KEEP TEMPORARILY** |
| `sw.js` | Yok (web standardı) | Cache, update, push, notification click | Aktif | Service Worker | **KEEP** |
| `salon-web-push.js` | Yok (web standardı) | Push izin/subscription/test | Aktif fakat production subscription sayısı başlangıçta 0 | Push API + Supabase Edge Function | **KEEP / COMPLETE** — ana sayfa etkinleştirme kartı eklendi |

## Production doğrulaması

- Supabase projesi: `oxuwwjsakhcqimjsfris`
- `web-push-dispatch` Edge Function: aktif
- `salon-modern-one-hour-reminders` Cron: her dakika aktif
- `salon-modern-web-push-dispatch` Cron: her dakika aktif
- İnceleme başlangıcında aktif `web_push_subscriptions`: **0**

## Güvenlik

- Frontend yalnız Supabase publishable key kullanır.
- Service role, VAPID private key ve dispatch secret frontend'e eklenmemiştir.
- Auth debug kayıtları token değerlerini yazmaz; yalnız token/session varlığı için boolean durum kaydeder.

## Kaldırma kapısı

Eski native hatırlatma ve FCM kodu ancak en az bir gerçek PWA cihazında subscription kaydı, test push, yeni randevu bildirimi ve 1 saatlik kapalı-PWA bildirimi doğrulandıktan sonra kaldırılacaktır. Bu sıra production bildirimlerini kaybetmemek için zorunludur.
