import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Article, FullText } from '@perch/core/types';

// IndexedDB holds the data that can grow large: cached articles and the
// full-text extraction cache. Everything here stays on the device.

const DB_NAME = 'perch';
const DB_VERSION = 1;

interface PerchDB extends DBSchema {
  articles: {
    key: string; // Article.id
    value: Article;
    indexes: {
      'by-feed': string;
      'by-published': number;
      'by-feed-published': [string, number];
      'by-feed-read': [string, number];
      'by-read': number;
    };
  };
  fulltext: {
    key: string; // FullText.articleId
    value: FullText;
    indexes: { 'by-extracted': number };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<PerchDB>> | null = null;

/** Test-only: drop the memoised connection so a fresh `indexedDB` is picked up. */
export function __resetDbForTests(): void {
  dbPromise = null;
}

export function getDB(): Promise<IDBPDatabase<PerchDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PerchDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const articles = db.createObjectStore('articles', { keyPath: 'id' });
        articles.createIndex('by-feed', 'feedId');
        articles.createIndex('by-published', 'publishedAt');
        articles.createIndex('by-feed-published', ['feedId', 'publishedAt']);
        articles.createIndex('by-feed-read', ['feedId', 'read']);
        articles.createIndex('by-read', 'read');

        const fulltext = db.createObjectStore('fulltext', { keyPath: 'articleId' });
        fulltext.createIndex('by-extracted', 'extractedAt');

        db.createObjectStore('meta');
      },
    });
  }
  return dbPromise;
}

export type { PerchDB };
