import { describe, expect, it } from 'vitest';
import { parseDate, resolvePublishedAt } from '../src/parser/dates';
import { fixture } from './fixtures';

describe('parseDate', () => {
  // The same list FeedParserTest.kt and LocalLibraryTests.swift read, so every
  // app reads a feed's dates (and so its article ids) the same way.
  it.each(JSON.parse(fixture('dates.json')) as [string, number | null][])(
    'reads %j as %s, like the apps',
    (input, expected) => {
      expect(parseDate(input)).toBe(expected);
    },
  );

  it('parses RFC 822 (RSS)', () => {
    expect(parseDate('Wed, 03 Jan 2024 08:00:00 GMT')).toBe(Date.parse('2024-01-03T08:00:00Z'));
  });

  it('parses RFC 3339 / ISO 8601 (Atom, JSON Feed)', () => {
    expect(parseDate('2024-05-01T12:00:00Z')).toBe(Date.parse('2024-05-01T12:00:00Z'));
    expect(parseDate('2024-06-10T15:00:00-04:00')).toBe(Date.parse('2024-06-10T19:00:00Z'));
  });

  it('parses "DD Mon YYYY HH:MM:SS" with no weekday or zone, as UTC', () => {
    expect(parseDate('5 Jun 2018 10:00:00')).toBe(Date.UTC(2018, 5, 5, 10, 0, 0));
  });

  it('parses RFC 822 with an alphabetic timezone abbreviation', () => {
    expect(parseDate('Tue, 05 Jun 2018 10:00:00 EST')).toBe(Date.UTC(2018, 5, 5, 15, 0, 0));
  });

  it('returns null for junk', () => {
    expect(parseDate('yesterday-ish')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe('resolvePublishedAt', () => {
  it('uses the first parseable candidate', () => {
    expect(resolvePublishedAt(['nope', '2024-05-01T12:00:00Z'])).toBe(
      Date.parse('2024-05-01T12:00:00Z'),
    );
  });

  it('ignores far-future dates and falls back to now', () => {
    const now = Date.parse('2024-01-01T00:00:00Z');
    const future = '2099-01-01T00:00:00Z';
    expect(resolvePublishedAt([future], now)).toBe(now);
  });

  it('falls back to now when nothing parses', () => {
    const now = 1_700_000_000_000;
    expect(resolvePublishedAt([null, undefined, 'bad'], now)).toBe(now);
  });
});
