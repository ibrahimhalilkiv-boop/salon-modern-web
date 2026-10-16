-- Update only the four customer-facing appointment drafts. Preserve failed,
-- queued and sent delivery logs; no messages are enqueued by this migration.
insert into public.message_templates(template_key,title,content)
values
('appointment_confirmation','Yeni randevu onayı',$message$Merhaba {musteri_adi} 👋

💈 Salon Modern randevunuz oluşturuldu.

📅 Tarih: {randevu_tarihi}
🕒 Saat: {randevu_saati}
✂️ Hizmet: {islem_adi}
👤 Berber: {calisan_adi}

Sizi bekliyoruz.
Salon Modern$message$),
('appointment_update','Randevu güncelleme bildirimi',$message$Merhaba {musteri_adi},

Salon Modern randevunuzun bilgileri güncellendi.

📅 Yeni tarih: {randevu_tarihi}
🕒 Yeni saat: {randevu_saati}
👤 Berber: {calisan_adi}

Güncel randevu bilgileriniz yukarıdaki gibidir.

Salon Modern$message$),
('appointment_reminder','1 saatlik randevu hatırlatması',$message$Merhaba {musteri_adi} 👋

⏰ Salon Modern randevunuzu hatırlatmak isteriz.

Randevu saatiniz yaklaşıyor.

📅 Tarih: {randevu_tarihi}
🕒 Saat: {randevu_saati}
👤 Berber: {calisan_adi}

📍 Yol Tarifi: https://salonmodern.com.tr/konum

Görüşmek üzere! 💈
Salon Modern$message$),
('appointment_cancelled','Randevu iptal bildirimi',$message$Merhaba {musteri_adi},

Salon Modern randevunuz iptal edilmiştir.

📅 Tarih: {randevu_tarihi}
🕒 Saat: {randevu_saati}
👤 Berber: {calisan_adi}

Bilginize sunarız.

Salon Modern$message$)
on conflict(template_key) do update set
  title=excluded.title,content=excluded.content,updated_at=now();

-- The replacements are under Meta review. An old approved hash must not
-- authorize the new text or send an old template through the Meta fallback.
insert into public.whatsapp_meta_template_mappings
  (template_key,meta_template_name,language_code,placeholder_order,approval_status,approved_content_hash,approved_at)
values
('appointment_confirmation','salon_modern_randevu_onayi_v2','tr','["{musteri_adi}","{randevu_tarihi}","{randevu_saati}","{islem_adi}","{calisan_adi}"]'::jsonb,'pending',null,null),
('appointment_update','salon_modern_randevu_guncelleme_v3','tr','["{musteri_adi}","{randevu_tarihi}","{randevu_saati}","{calisan_adi}"]'::jsonb,'pending',null,null),
('appointment_reminder','salon_modern_randevu_hatirlatma_v2','tr','["{musteri_adi}","{randevu_tarihi}","{randevu_saati}","{calisan_adi}"]'::jsonb,'pending',null,null),
('appointment_cancelled','salon_modern_randevu_iptal_v2','tr','["{musteri_adi}","{randevu_tarihi}","{randevu_saati}","{calisan_adi}"]'::jsonb,'pending',null,null)
on conflict(template_key) do update set
  meta_template_name=excluded.meta_template_name,
  language_code=excluded.language_code,
  placeholder_order=excluded.placeholder_order,
  approval_status='pending',
  approved_content_hash=null,
  approved_at=null,
  updated_at=now();
