// Starter packs: a few well-known feeds per topic, offered on an empty
// library so a new reader isn't facing a blank page. Picked by hand, kept in
// the open here so anyone can see what's in them and suggest changes. They
// ship inside the apps: choosing one tells no server anything.
//
// Every address was fetched and parsed with this repository's parser when it
// was added (tests/starter-packs.test.ts checks the shape, not the network).
// The iPhone app reads apps/ios/Perch/Support/starter-packs.json, generated
// from this file by `npm run starter-packs`.

export interface StarterFeed {
  title: string;
  url: string;
  /** The language most of its articles are in. */
  lang: 'en' | 'tr';
}

export interface StarterPack {
  id: string;
  title: { en: string; tr: string };
  description: { en: string; tr: string };
  /** Who the pack is mostly for; the reader shows the viewer's language first. */
  lang: 'en' | 'tr';
  feeds: StarterFeed[];
}

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'science',
    lang: 'en',
    title: { en: 'Science', tr: 'Bilim' },
    description: {
      en: 'Research news and the journals behind it.',
      tr: 'Araştırma haberleri ve arkalarındaki dergiler.',
    },
    feeds: [
      { title: 'Nature', url: 'https://www.nature.com/nature.rss', lang: 'en' },
      { title: 'Science', url: 'https://www.science.org/rss/news_current.xml', lang: 'en' },
      {
        title: 'Scientific American',
        url: 'https://www.scientificamerican.com/platform/syndication/rss/',
        lang: 'en',
      },
      { title: 'New Scientist', url: 'https://www.newscientist.com/feed/home/', lang: 'en' },
      { title: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', lang: 'en' },
      { title: 'eLife', url: 'https://elifesciences.org/rss/recent.xml', lang: 'en' },
      { title: 'PLOS Biology', url: 'https://journals.plos.org/plosbiology/feed/atom', lang: 'en' },
    ],
  },
  {
    id: 'space',
    lang: 'en',
    title: { en: 'Space', tr: 'Uzay' },
    description: {
      en: 'Missions and discoveries from the space agencies.',
      tr: 'Uzay ajanslarından görevler ve keşifler.',
    },
    feeds: [
      { title: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', lang: 'en' },
      {
        title: 'ESA Space Science',
        url: 'https://www.esa.int/rssfeed/Our_Activities/Space_Science',
        lang: 'en',
      },
    ],
  },
  {
    id: 'bilim',
    lang: 'tr',
    title: { en: 'Science in Turkish', tr: 'Türkçe bilim' },
    description: {
      en: 'Popular science, written in Turkish.',
      tr: 'Türkçe popüler bilim.',
    },
    feeds: [
      { title: 'Evrim Ağacı', url: 'https://evrimagaci.org/rss.xml', lang: 'tr' },
      { title: 'TÜBİTAK Bilim Genç', url: 'https://bilimgenc.tubitak.gov.tr/rss.xml', lang: 'tr' },
    ],
  },
  {
    id: 'technology',
    lang: 'en',
    title: { en: 'Technology', tr: 'Teknoloji' },
    description: {
      en: 'How tech works and what it’s doing to the world.',
      tr: 'Teknolojinin nasıl çalıştığı ve dünyaya ne yaptığı.',
    },
    feeds: [
      { title: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en' },
      { title: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en' },
      { title: 'WIRED', url: 'https://www.wired.com/feed/rss', lang: 'en' },
      { title: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', lang: 'en' },
      { title: 'LWN.net', url: 'https://lwn.net/headlines/rss', lang: 'en' },
      { title: 'Hacker News', url: 'https://news.ycombinator.com/rss', lang: 'en' },
    ],
  },
  {
    id: 'teknoloji',
    lang: 'tr',
    title: { en: 'Technology in Turkish', tr: 'Türkçe teknoloji' },
    description: {
      en: 'Tech news from Turkey.',
      tr: 'Türkiye’den teknoloji haberleri.',
    },
    feeds: [
      { title: 'Webrazzi', url: 'https://webrazzi.com/feed/', lang: 'tr' },
      { title: 'ShiftDelete.Net', url: 'https://shiftdelete.net/feed', lang: 'tr' },
      { title: 'DonanımHaber', url: 'https://www.donanimhaber.com/rss/tum/', lang: 'tr' },
    ],
  },
  {
    id: 'privacy',
    lang: 'en',
    title: { en: 'Privacy and security', tr: 'Gizlilik ve güvenlik' },
    description: {
      en: 'Digital rights, surveillance and security research.',
      tr: 'Dijital haklar, gözetim ve güvenlik araştırmaları.',
    },
    feeds: [
      { title: 'EFF Deeplinks', url: 'https://www.eff.org/rss/updates.xml', lang: 'en' },
      { title: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', lang: 'en' },
      { title: 'Schneier on Security', url: 'https://www.schneier.com/feed/atom/', lang: 'en' },
      { title: 'The Markup', url: 'https://themarkup.org/feeds/rss.xml', lang: 'en' },
      { title: 'Tor Project', url: 'https://blog.torproject.org/rss.xml', lang: 'en' },
      { title: 'İfade Özgürlüğü Derneği', url: 'https://ifade.org.tr/feed/', lang: 'tr' },
    ],
  },
  {
    id: 'selfhosting',
    lang: 'en',
    title: { en: 'Self-hosting and homelab', tr: 'Self-hosting ve homelab' },
    description: {
      en: 'Running your own services, at home or on a server.',
      tr: 'Kendi servislerini evde ya da bir sunucuda çalıştırmak.',
    },
    feeds: [
      { title: 'selfh.st', url: 'https://selfh.st/rss/', lang: 'en' },
      { title: 'Noted', url: 'https://noted.lol/rss/', lang: 'en' },
      { title: 'Jeff Geerling', url: 'https://www.jeffgeerling.com/blog.xml', lang: 'en' },
      { title: 'ServeTheHome', url: 'https://www.servethehome.com/feed/', lang: 'en' },
      { title: 'r/homelab', url: 'https://www.reddit.com/r/homelab/.rss', lang: 'en' },
    ],
  },
  {
    id: 'world',
    lang: 'en',
    title: { en: 'World news', tr: 'Dünya haberleri' },
    description: {
      en: 'International public broadcasters and newsrooms.',
      tr: 'Uluslararası kamu yayıncıları ve haber merkezleri.',
    },
    feeds: [
      { title: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', lang: 'en' },
      { title: 'DW', url: 'https://rss.dw.com/xml/rss-en-all', lang: 'en' },
      { title: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', lang: 'en' },
      { title: 'France 24', url: 'https://www.france24.com/en/rss', lang: 'en' },
      { title: 'Euronews', url: 'https://www.euronews.com/rss', lang: 'en' },
    ],
  },
  {
    id: 'haberler',
    lang: 'tr',
    title: { en: 'News in Turkish', tr: 'Türkçe haberler' },
    description: {
      en: 'The Turkish services of international broadcasters.',
      tr: 'Uluslararası yayıncıların Türkçe servisleri.',
    },
    feeds: [
      { title: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkce/rss.xml', lang: 'tr' },
      { title: 'DW Türkçe', url: 'https://rss.dw.com/xml/rss-tur-all', lang: 'tr' },
      { title: 'Euronews Türkçe', url: 'https://tr.euronews.com/rss', lang: 'tr' },
    ],
  },
];

/** The packs in the order to show them: the viewer's language first. */
export function starterPacksFor(language: string | undefined): StarterPack[] {
  const tr = language?.toLowerCase().startsWith('tr') ?? false;
  const mine = tr ? 'tr' : 'en';
  return [...STARTER_PACKS].sort((a, b) => Number(b.lang === mine) - Number(a.lang === mine));
}
