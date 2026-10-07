import { Hlc, compareHlc, formatHlc, parseHlc, parseStateRecordId } from '../src/sync';

describe('Hlc', () => {
  it('formats fixed-width so string order is time order', () => {
    expect(formatHlc(1700000000000, 5, 'a')).toBe('1700000000000-0005-a');
    expect(compareHlc(formatHlc(9, 0, 'z'), formatHlc(10, 0, 'a'))).toBe(-1);
    expect(parseHlc('1700000000000-000z-node')).toEqual({
      ms: 1700000000000,
      counter: 35,
      node: 'node',
    });
    expect(parseHlc('nope')).toBeNull();
  });

  it('is monotonic even when the wall clock stalls or goes back', () => {
    let wall = 1000;
    const h = new Hlc('a', () => wall);
    const a = h.now();
    const b = h.now();
    wall = 500;
    const c = h.now();
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, c)).toBe(-1);
  });

  it('orders after a remote clock that runs ahead', () => {
    const behind = new Hlc('slow', () => 1000);
    const ahead = new Hlc('fast', () => 5000);
    const remote = ahead.now();
    behind.receive(remote);
    expect(compareHlc(behind.now(), remote)).toBe(1);
  });

  it('rejects bad node ids', () => {
    expect(() => new Hlc('has space')).toThrow();
  });
});

describe('parseStateRecordId', () => {
  it('splits on the first colon', () => {
    expect(parseStateRecordId('abc:def')).toEqual({ feedId: 'abc', articleId: 'def' });
    expect(parseStateRecordId('abc')).toBeNull();
    expect(parseStateRecordId(':x')).toBeNull();
  });
});
