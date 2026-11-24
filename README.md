# Filtre Robotu

Kullanıcının yüklediği maç CSV dosyalarını dinamik kolon kataloğuyla filtreleyen web uygulaması.

## Özellikler
- Supabase e-posta/şifre hesabı
- CSV içe aktarma; kolon adları ve türleri otomatik algılanır
- Tekrarlanan veya benzer başlıklı kolonlar benzersiz alan anahtarlarıyla korunur
- Maç bilgisi, oran/market, gerçekleşen sonuç ve diğer alanların ayrımı
- VE / VEYA koşul mantığı, koşul bazında NOT, metin ve sayısal operatörler
- Filtreleri kaydetme, sonuçlarda arama ve CSV dışa aktarma
- RLS ile kullanıcıya ait veri seti ve filtre izolasyonu

## Geliştirme
1. Node.js 20+ kur.
2. `npm install`
3. `.env.example` dosyasını `.env.local` olarak kopyala.
4. Supabase proje URL'sini ve yalnızca publishable/anon istemci anahtarını tanımla.
5. `npm run dev`

## Build
`npm run build`

## Güvenlik ve maliyet
Tarayıcıya service-role anahtarı koyma. Supabase Free plan limitleri aşılırsa ücretli plana otomatik geçiş yapılmaz. Büyük veri dosyaları için 50.000 satır sınırı uygulanır. Bu sınır, ücretsiz veritabanı kotasını korumaya yönelik koruyucu bir üst sınırdır.

## İlk sürüm sınırları
- İlk içe aktarma biçimi CSV'dir.
- Tek dosyada en fazla 50.000 satır aktarılır.
- Sonuç tablosu ekranda ilk 500 eşleşmeyi gösterir; dışa aktarma tüm eşleşmeleri içerir.
- Tarih/saat alanları ilk sürümde metin operatörleriyle filtrelenebilir; tarih aralığı operatörleri sonraki sürüme bırakılmıştır.
