-- Marketing automation is disabled; this is the manual return-message draft.
-- Keep the booking URL on its own line immediately above the signature.
update public.message_templates
set content=E'Merhaba {musteri_adi},\n\nDüzenli bakım alışkanlığınıza göre tıraş zamanınız gelmiştir. Yeni randevu planlamak için aşağıdaki bağlantıyı kullanabilirsiniz. Bizimle de iletişime geçebilirsiniz.\n\nhttps://app.salonmodern.com.tr/randevu/\n\nSalon Modern',
    updated_at=now()
where template_key='customer_return_reminder'
  and content is distinct from E'Merhaba {musteri_adi},\n\nDüzenli bakım alışkanlığınıza göre tıraş zamanınız gelmiştir. Yeni randevu planlamak için aşağıdaki bağlantıyı kullanabilirsiniz. Bizimle de iletişime geçebilirsiniz.\n\nhttps://app.salonmodern.com.tr/randevu/\n\nSalon Modern';
