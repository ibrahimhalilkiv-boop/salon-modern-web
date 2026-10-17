# MORİ etkinleştirme

Bu fonksiyon varsayılan olarak Cloudflare Workers AI `@cf/zai-org/glm-4.7-flash` modelini kullanır. Cloudflare hesabı token oluşturmayı engelliyorsa `SALON_AI_PROVIDER=groq_free` ile GroqCloud Free üzerindeki sabit `openai/gpt-oss-120b` modeline geçilebilir. Kota aşılırsa sohbet hata gösterir; ücretli sağlayıcıya otomatik geçiş yoktur ve işletme ekranları çalışmaya devam eder.

Canlıya almadan önce:

1. Seçilen hesabın ücretsiz planda olduğunu doğrulayın. Groq kullanılıyorsa hesap Data Controls ekranında Zero Data Retention'ı açın.
2. Supabase Edge Function sırlarına Cloudflare için `CLOUDFLARE_ACCOUNT_ID` ve `CLOUDFLARE_API_TOKEN`; Groq için `SALON_AI_PROVIDER=groq_free` ve `GROQ_API_KEY` ekleyin. Anahtarları Git'e veya tarayıcı koduna koymayın.
3. `20261017212822_salon_modern_ai_history.sql` migrasyonunu uygulayın, ardından `salon-modern-ai` fonksiyonunu dağıtın ve yazılı Türkçe sohbeti gerçek oturumla deneyin.
4. Web uygulamasını dağıtın. Geçmiş, kullanıcı kimliğine bağlı olarak 30 gün tutulur ve günlük temizlik işi eski kayıtları siler.

Ücretli veya başka bir OpenAI uyumlu sağlayıcı için `SALON_AI_PROVIDER=openai_compatible`, `SALON_AI_ENDPOINT`, `SALON_AI_MODEL` ve `SALON_AI_API_KEY` sırları kullanılır. Bu yol yalnızca açık onaydan sonra `SALON_AI_ALLOW_PAID=true` ile etkinleşir. Groq Free yolu bu kilide bağlı değildir ve ücretli yola düşmez. Modele gönderilen telefon ve e-posta bilgileri maskelenir; salt okunur araçlar yalnızca toplu veriler döndürür.
