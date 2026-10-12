// perch.ws: English or Turkish, sections easing in as they scroll into view,
// and a firmer navigation bar once the page moves. No cookies, no requests.

const TR = {
  'nav.features': 'Özellikler',
  'nav.sync': 'Senkron',
  'nav.privacy': 'Gizlilik',
  'nav.open': 'Perch’ü edinin',
  'hero.eyebrow': 'Açık kaynak · Hesap gerekmez',
  'hero.title1': 'Feed’leriniz, sakin bir köşede.',
  'hero.title2': 'Ve yalnızca sizin.',
  'hero.lede':
    'Perch; RSS, Atom ve JSON feed’leri için gizliliği önceleyen bir okuyucu: tarayıcınızda, iPhone’da ve Android’de. Varsayılan olarak cihazınızda, isterseniz senkron; ne okuduğunuzu asla izlemez.',
  'hero.open': 'Perch’ü edinin',
  'hero.github': 'GitHub’da incele',
  'hero.p1': 'Chrome, Edge, Brave ve Firefox',
  'hero.p2': 'iPhone ve iPad',
  'hero.p3': 'Android',
  'hero.soon': 'Mağaza sürümleri yolda; kod bugünden derlenmeye hazır.',
  'features.eyebrow': 'Okumak için yapıldı',
  'features.title': 'Bir feed okuyucunun olması gereken her şey. Olmaması gereken hiçbir şey.',
  'f1.t': 'Kitap gibi okunur',
  'f1.d':
    'Makalelerin tamamı kendiliğinden yüklenir; sakin, sade bir düzende, düz ya da tırnaklı yazıyla. Değiştirilecek mod, basılacak düğme yok.',
  'f2.t': 'Varsayılan olarak cihazınızda',
  'f2.d':
    'Feed’ler, okuduklarınız, notlarınız ve ayarlarınız cihazınızda durur. Telemetri yok, reklam yok; okumak için hesap gerekmez.',
  'f3.t': 'Korkutucu izin yok',
  'f3.d':
    'Eklenti kurulurken hiçbir siteye erişim istemez. Yalnızca eklediğiniz sitelere, tek tek erişir.',
  'f4.t': 'Feed’i sizin için bulur',
  'f4.d':
    'Herhangi bir sitede Perch’ü açın: sayfanın gösterdiği feed bağlantılarını okur ya da olağan yerlere bakar. RSS, Atom ve JSON Feed’in hepsi çalışır.',
  'f5.t': 'Size göre şekillenir',
  'f5.d':
    'Açık ve koyu temalar, kendi vurgu ve düğme renkleriniz, buzlu cam ve seçtiğiniz bir arka plan resmi.',
  'f6.t': 'Açık kaynak, kendi sunucunuzda',
  'f6.d':
    'MIT lisanslı. Kendi Perch Sunucunuzu tek bir betikle çalıştırın — ya da hiç sunucu çalıştırmayın.',
  'sync.eyebrow': 'Senkron zincirleri',
  'sync.title': 'Hesapsız senkron.',
  'sync.lede':
    'Bir cihazda zincir başlatın, diğerinde QR kodunu okutun. Her şey cihazlarınızda, yalnızca onların bildiği bir anahtarla şifrelenir; aradaki aktarıcı okuyamadığı şeyleri iletir.',
  's1.t': 'Zincir başlatın',
  's1.d': 'Herhangi bir cihazda: Ayarlar → Senkron → Zincir başlat.',
  's2.t': 'Kodu okutun ya da yazın',
  's2.d':
    'iPhone ya da Android telefonunuzdaki Perch uygulamasıyla QR kodunu okutun ya da 28 karakterlik kodu başka bir tarayıcıda girin.',
  's3.t': 'Her yerde okuyun',
  's3.d':
    'Abonelikler, okunan ve yıldızlı makaleler, notlar, tema ve renkler sizinle gelir. Zincirdeki cihazlar birbirini listeler.',
  'sync.account':
    'Bizimkini kullanmak istemiyor musunuz? Kendi aktarıcınızı çalıştırın: küçük bir sunucuda relay modunda aynı Perch Server, sonra Ayarlar → Senkron → Aktarıcı’dan seçin. QR kodu onu diğer cihazlarınıza taşır.',
  'sync.relay': 'yalnızca şifreli veri görür',
  'privacy.eyebrow': 'Doğrulayabileceğiniz gizlilik',
  'privacy.title': 'Olabildiğince az şey bilmek için yapıldı.',
  'privacy.code': 'Kodu okuyun',
  pv1: 'Analitik yok, reklam yok, izleyici yok — bu sayfa dahil.',
  pv2: 'Hesap işletmiyoruz: kaydolunacak bir şey, kullanıcı adı, şifre ya da e-posta yok.',
  pv3: 'Senkron zincirleri uçtan uca şifrelidir; feed adresleri bile aktarıcıdan gizlenir.',
  pv4: 'Site simgeleri indirilmez — her siteye neyi takip ettiğinizi söylerlerdi.',
  pv5: 'Makaleler betikler kapalıyken gösterilir.',
  pv6: 'perch.ws, Cloudflare Pages üzerinden sunulur; Cloudflare her ziyareti herhangi bir web barındırıcısı gibi işler. Senkron aktarıcısı (sync.perch.ws) Cloudflare’den geçmez: cihazlarınız doğrudan ona bağlanır ve aktarıcı erişim kaydı tutmaz.',
  'f7.t': 'Paylaşmaya değer notlar',
  'f7.d':
    'Herhangi bir makaleye markdown ile not yazın. Kendi sayfası olarak paylaşana kadar gizli kalır.',
  'f8.t': 'İstediğinde kilitli',
  'f8.d':
    'Eklentide PIN, telefonlarda PIN ile Face ID ya da parmak izi; yoldan geçen biri okuduklarınızı açamaz.',
  'f9.t': 'E-posta yok, hiç',
  'f9.d':
    'Hesaplar bir kullanıcı adı, bir şifre ve sakladığınız bir kurtarma kodundan ibaret. Şifrenizi mi unuttunuz? Kod yenisini belirler.',
  pv7: 'İşlettiğimiz tek şey aktarıcıdır ve orada yalnızca şifreli kayıtlar durur: çalınan bir diskte kimsenin okuyamayacağı ve kime ait olduğunu söylemeyen veriden başka bir şey bulunmaz.',
  pv8: 'Sunucu imajlarımız herkesin gözü önünde derlenir ve imzalanır; sunucu hangi commit’i çalıştırdığını söyler. Bkz. perch.ws/transparency.',
  'end.title': 'Okumak için sakin bir köşe bulun.',
  'end.star': 'GitHub’da yıldızla',
  'footer.line': '© 2026 Perch katkıcıları · MIT Lisansı',
  'get.eyebrow': 'Perch’ü edinin',
  'get.title': 'Okuduğunuz her cihazda, ücretsiz.',
  'get.ext.t': 'Chrome, Edge ve Brave',
  'get.soon': 'Yakında mağazada.',
  'get.ios.t': 'iPhone ve iPad',
  'get.self.t': 'Kendi sunucunuz',
  'get.self.d':
    'Perch Server’ı kendiniz çalıştırın: kendi senkron aktarıcınız ya da web okuyuculu, hesaplı ve paylaşılan notlu bir sunucu. Küçük bir VPS’te tek betikle, depodan.',
  'get.self.a': 'Kurulum rehberi',
  'get.talk.t': 'Sorular ve fikirler',
  'get.talk.d': 'GitHub’da açıkça soru sorun, öneride bulunun, hata bildirin.',
  'get.talk.a': 'Tartışmalar',
  'footer.app': 'Topluluk',
  'footer.privacy': 'Gizlilik',
  'footer.terms': 'Koşullar',
  'footer.transparency': 'Şeffaflık',
  'legal.home': 'Ana sayfa',
};

const META_TR = {
  title: 'Perch — sakin ve gizli bir feed okuyucu',
  description:
    'Perch; RSS, Atom ve JSON feed’leri için gizliliği önceleyen bir okuyucu: tarayıcınızda, iPhone’da ve Android’de.',
};

document.documentElement.classList.add('js');

// English is in the page; remember each node's original text to switch back.
const nodes = [...document.querySelectorAll('[data-i18n]')];
const english = new Map(nodes.map((n) => [n, n.textContent]));
const description = document.querySelector('meta[name="description"]');
const englishMeta = { title: document.title, description: description?.content };
// Pages with long text (privacy, terms) carry both languages in blocks, and
// their Turkish title and description on <html>.
const blocks = document.querySelectorAll('[data-lang]');
const pageTr = document.documentElement.dataset;

function storedLanguage() {
  try {
    return localStorage.getItem('perch-lang');
  } catch {
    return null;
  }
}

function apply(lang) {
  const tr = lang === 'tr';
  for (const node of nodes) {
    const key = node.dataset.i18n;
    node.textContent = tr && TR[key] ? TR[key] : english.get(node);
  }
  for (const block of blocks) block.hidden = block.dataset.lang !== lang;
  document.documentElement.lang = lang;
  document.title = tr ? (pageTr.titleTr ?? META_TR.title) : englishMeta.title;
  if (description) {
    description.content = tr
      ? (pageTr.descriptionTr ?? META_TR.description)
      : englishMeta.description;
  }
  for (const button of document.querySelectorAll('[data-lang-toggle]')) {
    button.textContent = tr ? 'EN' : 'TR';
    button.setAttribute('aria-label', tr ? 'English' : 'Türkçe');
  }
}

let lang = storedLanguage() ?? (navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en');
apply(lang);

for (const button of document.querySelectorAll('[data-lang-toggle]')) {
  button.addEventListener('click', () => {
    lang = lang === 'tr' ? 'en' : 'tr';
    apply(lang);
    try {
      localStorage.setItem('perch-lang', lang);
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
  });
}

// Sections ease in once, as they come into view.
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  reveals.forEach((el, i) => {
    // Cards in a row follow one another a beat apart.
    el.style.transitionDelay = `${(i % 3) * 70}ms`;
    seen.observe(el);
  });
} else {
  reveals.forEach((el) => el.classList.add('in'));
}

// A firmer glass bar once the page has scrolled.
const navWrap = document.querySelector('.nav-wrap');
if (navWrap) {
  const onScroll = () => navWrap.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
