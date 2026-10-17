# Salon Modern AI etkinleştirme

Bu fonksiyon varsayılan olarak Cloudflare Workers AI `@cf/zai-org/glm-4.7-flash` modelini kullanır. Ücretli API otomatik olarak açılmaz. Cloudflare Workers Free planında günlük 10.000 ücretsiz Neuron sınırı vardır; sınır aşılırsa sohbet hata gösterir ve işletme ekranları çalışmaya devam eder.

Canlıya almadan önce:

1. Cloudflare hesabında Workers AI erişimli bir API token oluşturun.
2. Supabase Edge Function sırlarına `CLOUDFLARE_ACCOUNT_ID` ve `CLOUDFLARE_API_TOKEN` ekleyin. Token'ı Git'e veya tarayıcı koduna koymayın.
3. `20261017211729_salon_modern_ai_history.sql` migrasyonunu uygulayın, ardından `salon-modern-ai` fonksiyonunu dağıtın ve yazılı Türkçe sohbeti gerçek oturumla deneyin.
4. Web uygulamasını dağıtın. Geçmiş, kullanıcı kimliğine bağlı olarak 30 gün tutulur ve günlük temizlik işi eski kayıtları siler.

Sağlayıcı değişimi için `SALON_AI_PROVIDER=openai_compatible`, `SALON_AI_ENDPOINT`, `SALON_AI_MODEL` ve `SALON_AI_API_KEY` sırları kullanılır. Ücretli sağlayıcı ancak açık onaydan sonra `SALON_AI_ALLOW_PAID=true` ile etkinleşir. Sağlayıcının kişisel veri koşulları ayrıca doğrulanmalıdır.
