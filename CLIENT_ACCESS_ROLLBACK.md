# Müşteri erişimi geçişi: yayın ve geri alma

Bu plan `20261027201412_staff_client_lookup_api.sql` ve `20261027201419_restrict_staff_client_select.sql` geçişleri içindir. Yayın onayı 2026-10-27 tarihinde verildi. Önceki dört müşteri politikası `ops/clients-policy-backup-20261027.sql` içinde kayıtlıdır. Geçişler mevcut müşteri veya randevu satırlarını değiştirmez; yalnızca yeni kota kayıtları oluşturur.

## Yayın sırası

1. İlk migration'ı uygula. RPC'ler eklenir, mevcut `clients` okuma politikası aynı kalır. Yeni RPC'lerin izinlerini doğrula.
2. Güncel `main` tabanlı uygulama dosyalarını GitHub Pages'e yayınla (`salon-modern.html`, `appointment-form-actions-2.3.30.js`, `smart-customer-analysis-1.7.0.js`, `salon-phase2-1.8.0.js`, `sw.js`). Bu aşamada eski ve yeni istemciler çalışır.
3. Yayınlanan dosyaları ve PWA sürümünü HTTP üzerinden doğrula, ardından ikinci migration ile yalnız `clients` SELECT politikasını yöneticiye daralt.
4. Çalışan ve yönetici test hesaplarıyla arama, randevu oluşturma/düzenleme/silme, müşteri analizi ve doğrudan API erişimi kontrol edilir. Gerçek müşteri değerleri test çıktılarına yazılmaz.

## Acil geri alma

İkinci migration'dan önce sorun çıkarsa uygulamayı önceki GitHub `main` commit'ine döndür; eklenen RPC'ler kullanılmadan kalır. İkinci migration'dan sonra temel işlev bozulursa aşağıdaki SQL'i tek işlemde uygula; ardından uygulamayı önceki commit'e döndür. **Bu geri alma, doğrulanmış toplu müşteri okuma açığını yeniden açar; yalnızca kısa süreli acil kurtarma için kullanılmalıdır.**

```sql
begin;
drop policy if exists clients_read_by_manager on public.clients;
create policy clients_read_by_active_users on public.clients for select to authenticated
  using ((select private.is_active_salon_user()));
commit;
```

RPC'ler acil geri alma sırasında yerinde bırakılır; böylece henüz güncellenmemiş PWA istemcileri çalışır. Müşteri ve randevu kayıtları korunur. Sonraki bakımda kullanılmayan RPC'ler ve kota tablosu ayrı migration ile temizlenebilir.
