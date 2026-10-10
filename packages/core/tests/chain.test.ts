import {
  chainLink,
  chainSlot,
  deriveChainKeys,
  formatChainCode,
  newChainSecret,
  normalizeChainCode,
  openRecord,
  parseChainCode,
  parseChainLink,
  sealRecord,
  type ChainStoredRecord,
} from '../src/chain';

// Secret 00 01 02 … 0f. The Swift port (ChainTests.swift) checks the same values.
const SECRET = Uint8Array.from({ length: 16 }, (_, i) => i);
const VECTOR = {
  code: '000G-40R4-0M30-E209-185G-R38E-1X0G',
  token: 'Y7Wa6yDxEtxEAWukDZMuf1kN_qolwFQsyKiC0HFs4yc',
  feedSlot: 'Oa4CSVR2mEEhKd_BDVYZIg', // feed:abc123
  sealed: {
    key: 'U4YedoXC32m-kxquAb7kPw',
    hlc: '1700000000000-0000-dev',
    blob: 'AAAAAAAAAAAAAAAAYN2WqZ-YeQEmyPspk5ypEYB_wPPazHR7zD85Frue6sX_1tx6Sm5aBKUglkS7EoZ12nv9pEHyBWOggu34aEjDNetU_QF_oCpPFG1zctf-QYbUP0zndg4WgCbTL3W44zKOIw',
  },
};

describe('chain codes', () => {
  it('formats the known vector', () => {
    expect(formatChainCode(SECRET)).toBe(VECTOR.code);
  });

  it('round-trips random secrets', () => {
    for (let i = 0; i < 50; i++) {
      const secret = newChainSecret();
      const code = formatChainCode(secret);
      expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(parseChainCode(code)).toEqual(secret);
    }
  });

  it('forgives case, spacing and look-alike letters', () => {
    const typed = VECTOR.code
      .toLowerCase()
      .replace(/-/g, ' ')
      .replace(/0/g, 'o')
      .replace(/1/g, 'l');
    expect(parseChainCode(typed)).toEqual(SECRET);
    expect(normalizeChainCode(`  ${typed} `)).toBe(VECTOR.code);
  });

  it('rejects typos, swaps and the wrong length', () => {
    const chars = VECTOR.code.replace(/-/g, '');
    const typo = `${chars.slice(0, 5)}${chars[5] === 'A' ? 'B' : 'A'}${chars.slice(6)}`;
    const swap = `${chars.slice(0, 6)}${chars[7]}${chars[6]}${chars.slice(8)}`;
    expect(parseChainCode(typo)).toBeNull();
    expect(chars[6] === chars[7] || parseChainCode(swap) === null).toBe(true);
    expect(parseChainCode(chars.slice(1))).toBeNull();
    expect(parseChainCode(`${chars}0`)).toBeNull();
    expect(parseChainCode('not a code at all, sorry!!')).toBeNull();
  });
});

describe('chain links', () => {
  it('round-trips server and code', () => {
    const link = chainLink('https://sync.example.com', VECTOR.code);
    expect(link.startsWith('perch://chain?')).toBe(true);
    expect(parseChainLink(link)).toEqual({ server: 'https://sync.example.com', code: VECTOR.code });
  });

  it('defaults the server and refuses bad links', () => {
    expect(parseChainLink(`perch://chain?code=${VECTOR.code}`)?.server).toBe(
      'https://sync.perch.ws',
    );
    expect(parseChainLink('perch://chain?code=nope')).toBeNull();
    expect(parseChainLink(`perch://chain?server=ftp://x&code=${VECTOR.code}`)).toBeNull();
    expect(parseChainLink('https://example.com')).toBeNull();
  });
});

describe('chain keys and records', () => {
  it('derives the known token and slot', async () => {
    const keys = await deriveChainKeys(SECRET);
    expect(keys.token).toBe(VECTOR.token);
    expect(await chainSlot(keys, 'feed', 'abc123')).toBe(VECTOR.feedSlot);
  });

  it('seals the known vector', async () => {
    const keys = await deriveChainKeys(SECRET);
    const sealed = await sealRecord(
      keys,
      {
        type: 'category',
        id: 'c1',
        hlc: VECTOR.sealed.hlc,
        data: { name: 'Tech', order: 10, collapsed: false },
      },
      new Uint8Array(12),
    );
    expect(sealed).toEqual(VECTOR.sealed);
  });

  it('opens what it sealed, including tombstones', async () => {
    const keys = await deriveChainKeys(newChainSecret());
    const feed = {
      type: 'feed' as const,
      id: 'feed-id-that-must-not-leak',
      hlc: '1700000000000-0001-a',
      data: { url: 'https://e.com/feed', categoryId: 'uncategorized', addedAt: 1 },
    };
    const sealed = await sealRecord(keys, feed);
    // A long id, so a random 22-character key can't contain it by chance.
    expect(sealed.key).not.toContain('feed-id-that-must-not-leak');
    expect(await openRecord(keys, { ...sealed, version: 3 })).toEqual({ ...feed, version: 3 });

    const gone = await sealRecord(keys, {
      type: 'feed',
      id: 'feed-id-that-must-not-leak',
      hlc: feed.hlc,
      deleted: true,
    });
    expect(gone.deleted).toBe(true);
    expect(gone.key).toBe(sealed.key);
    expect(await openRecord(keys, { ...gone, version: 4 })).toEqual({
      type: 'feed',
      id: 'feed-id-that-must-not-leak',
      hlc: feed.hlc,
      version: 4,
      deleted: true,
    });
  });

  it('marks read, unstarred state as ephemeral', async () => {
    const keys = await deriveChainKeys(newChainSecret());
    const state = (read: boolean, starred: boolean) =>
      sealRecord(keys, {
        type: 'state',
        id: 'f:a',
        hlc: '1700000000000-0000-a',
        data: { read, starred },
      });
    expect((await state(true, false)).ephemeral).toBe(true);
    expect((await state(true, true)).ephemeral).toBeUndefined();
    expect((await state(false, false)).ephemeral).toBeUndefined();
  });

  it('opens what the Swift port sealed', async () => {
    // ChainTests.swift seals the same record with the same IV and expects this blob.
    const keys = await deriveChainKeys(SECRET);
    const record = await openRecord(keys, {
      key: VECTOR.feedSlot,
      hlc: '1700000000001-0000-phone',
      blob: 'AQEBAQEBAQEBAQEBPaHL4o_tfYn1ebpF8jOaB5YioDRDvrgJN7GHEprFa_tleg_mTSkhmyjYrxnHTScX4TLyC-G-cZzvBWVlzGDel6Ex5JIAStHvCBZuXQVCA-FN7P756Ob3RJCjC-nwWeuwsrkBBADJZqBpxgmKiSs1-Wl_xxXvevQJXkSLttMZ7piijWe-Bonv2s9mSntSLOegDw',
      version: 7,
    });
    expect(record).toEqual({
      type: 'feed',
      id: 'abc123',
      hlc: '1700000000001-0000-phone',
      version: 7,
      data: {
        url: 'https://blog.example/feed.xml',
        categoryId: 'uncategorized',
        addedAt: 1700000000000,
      },
    });
  });

  it('refuses another chain’s records and anything tampered with', async () => {
    const keys = await deriveChainKeys(SECRET);
    const other = await deriveChainKeys(newChainSecret());
    const stored: ChainStoredRecord = { ...VECTOR.sealed, version: 1 };
    expect(await openRecord(keys, stored)).not.toBeNull();
    expect(await openRecord(other, stored)).toBeNull();
    // The relay moving a blob to another slot, re-dating it, or flipping deleted.
    expect(await openRecord(keys, { ...stored, key: VECTOR.feedSlot })).toBeNull();
    expect(await openRecord(keys, { ...stored, hlc: '1800000000000-0000-dev' })).toBeNull();
    expect(await openRecord(keys, { ...stored, deleted: true })).toBeNull();
    expect(await openRecord(keys, { ...stored, blob: `${stored.blob.slice(0, -2)}AA` })).toBeNull();
  });
});
