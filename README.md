# Çizgi Stüdyo

*English: [README.en.md](README.en.md)*

Claude Code için ücretsiz ve açık kaynak bir **2D çizgi film stüdyosu**. Kontrol sizde kalır: Claude senaryoyu, sesi ve storyboard'u hazırlar, ama her aşama sizin onayınız olmadan ilerlemez. Sahnede yalnızca kütüphanedeki karakterler, hareketler, kameralar ve mekânlar kullanılabilir. Yapay zekâ sahne uyduramaz.

> Durum: **v0.1.0, erken sürüm.** Motor, onay kapıları ve kontrol paneli çalışıyor. Başlangıç paketi küçük ve büyüyecek.

## Ne yapar
- **Kütüphaneye bağlı bölüm dosyası.** Her bölüm bir `bolum.json` dosyasıdır. Kütüphanede olmayan bir hareket, kamera ya da karakter yazılırsa bölüm reddedilir.
- **Onay kapıları.** Senaryo, ses, storyboard ve render sırayla ilerler. Her onay, onaylanan içeriğin parmak izine bağlıdır. İçerik değişince onay kendiliğinden düşer ve render reddedilir.
- **Sinema kuralları.** `dogrula` komutu kuralları otomatik denetler:
  - mekânı tanıtmadan açılış
  - gerekçesiz detay planı
  - jump cut
  - ekran yönünün ters dönmesi
  - önden ya da arkadan görünen karakterin yan yan yürümesi
- **Anatomi denetimi.** Her karakterin eklem sınırları var. Kolu ya da dizi kıran bir poz render'a ulaşmadan hata verir.
- **Türkçe seslendirme** (Edge TTS: Microsoft'un ücretsiz çevrimiçi sesleri, internet gerekir, yalnız replik metni gönderilir):
  - hazır sesler (kadın, erkek, kalın erkek, yaşlı, çocuk), perde ve hız ayarı, duygular
  - kelime zamanları ve ağız şekilleri otomatik çıkarılır (Edge, Rhubarb)
- **Kontrol paneli** (`cizgi panel`). Tarayıcıda shot'ları seçip açılır menülerden değiştirir, canlı önizlemede görür ve kaydedersiniz.
- **Video kontrolü** (`cizgi qa`). Render edilen videodan saniyede 4 kare çıkarır. Hiçbir video kare kare izlenmeden kimseye gösterilmez.
- **İki biçim:** YouTube için 16:9, Reels ve Shorts için 9:16. Render [HyperFrames](https://github.com/heygen-com/hyperframes) ile yapılır.
- **0-3 yaş profili.** Çocuk gelişimi araştırmalarına dayanan tempo, tekrar ve içerik kuralları.

## Başlangıç paketi (CC0)
| Tür | İçerik |
|---|---|
| Karakterler | **Ela** (6 yaşında bir kız; önden ve profil), **Pamuk** (oyuncak ayı), **Genç** (profil, önden 3/4, arkadan 3/4) |
| Hareketler | bekle, selam, alkış, zıpla, yürü, çocuk yürüyüşü, arkadan yürü, fark et, gelip fark et, eğil-al, bak, elindekine bak |
| Mekânlar | çayır, sokak (+ derinlikli sokak), oda, park |
| Nesneler | plastik şişe |
| Efektler | 20 kısa ses: adımlar (çim, beton, tahta, halı), kapı, kitap, tık, pop ve diğerleri ([kaynaklar](plugins/cizgi-studyo/library/sfx/KAYNAKLAR.md)) |
| Kameralar | geniş, orta, yakın, göğüs, detay; sabit, yaklaş, uzaklaş, kaydır, takip, ileri dolly, detaydan açılış |

Yeni karakter çizmek için [karakter şartnamesi](docs/RIG-SPEC.md) (İngilizce).

## Kurulum
Gerekenler:
- [Claude Code](https://docs.claude.com/claude-code)
- Node.js 20 veya üstü
- ffmpeg (PATH'te)

Claude Code içinde:

```
/plugin marketplace add fatihgun1/claude-video-skill
/plugin install cizgi-studyo@cizgi-studyo
```

Depoyu indirdiyseniz yerel klasörden de kurabilirsiniz:

```
/plugin marketplace add C:/yol/cizgi-studyo
```

İlk kullanımda motorun tek bağımlılığı kurulur (Claude bunu kendisi yapar):

```bash
npm install --prefix plugins/cizgi-studyo/engine
```

### Seslendirme için (isteğe bağlı)
Sessiz bölümler bunlar olmadan da çalışır. Seslendirme internet ister; GPU gerekmez.

1. **Seslendirme ortamı:** bir Python ortamında `pip install edge-tts`.
2. **Ağız şekilleri:** [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) 1.14.
3. **ffmpeg** (PATH'te ya da yolu aşağıda).
4. Yolları `~/.cizgi-studyo/config.json` dosyasına yazın:

```json
{
  "python_tts": "C:/ortamlar/tts/Scripts/python.exe",
  "rhubarb": "C:/araclar/rhubarb/rhubarb.exe",
  "ffmpeg": "ffmpeg"
}
```

Aynı değerler ortam değişkenleriyle de verilebilir: `CIZGI_PYTHON_TTS`, `CIZGI_RHUBARB`, `CIZGI_FFMPEG`.

## Kullanım
Claude'a ne istediğinizi söyleyin, örneğin: *"Ela ile Pamuk'un parkta karşılaştığı kısa bir çizgi film yapalım."* Skill'ler sırayla devreye girer:

| Adım | Skill | Sizden istenen |
|---|---|---|
| 1. Proje | `cizgi-proje` | Konu ve hedef yaş |
| 2. Senaryo | `cizgi-senaryo` | Senaryo onayı |
| 3. Ses | `cizgi-ses` | Dinleme kontrolünden geçemeyen satırlar için karar |
| 4. Storyboard | `cizgi-storyboard` | Kareler ve taslak video için onay |
| 5. Düzenleme | `cizgi-panel` | İsterseniz shot'ları panelde kendiniz ayarlayın |
| 6. Render | `cizgi-render` | Son videolar |

Motoru doğrudan da kullanabilirsiniz:

```bash
node plugins/cizgi-studyo/engine/src/cli.mjs durum ornekler/sokak/bolum.json
```

Komutlar:
- `dogrula`: şema, kütüphane ve kural denetimi
- `durum`: kapıların durumu ve sıradaki adım
- `onayla`: onayı kaydeder; yalnızca siz evet dedikten sonra
- `ses`: seslendirme
- `kabul`: dinleme kontrolünden geçemeyen bir satırı onayınızla kabul eder
- `storyboard`: shot karelerini çıkarır
- `render`: videoyu üretir
- `qa`: render edilmiş videodan kontrol sayfaları çıkarır
- `panel`: kontrol panelini açar
- `derle`: bölümü HyperFrames projesine derler

Örnek bölümler [ornekler/](ornekler/) klasöründe.

## Lisanslar
- **Kod:** [Apache-2.0](LICENSE)
- **Karakterler, mekânlar, nesneler, efektler** (`plugins/cizgi-studyo/library/`): [CC0 1.0](LICENSE-ASSETS), yani kamu malı. Ticari işlerde de serbestçe kullanılabilir.
- Dış araçların lisansları için [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Ürettiğiniz videolar sizindir.
