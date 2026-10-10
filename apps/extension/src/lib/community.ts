import { getLocal, setLocal, watchLocal } from './storage/local';

// The Perch account: a name on a hub (app.perch.ws, or any Perch Server) for
// sharing notes. It's separate from sync: the library can sync by chain, by
// a server of your own, or not at all, and still share through this account.

export const COMMUNITY_KEY = 'perch:community';

export interface CommunityAccount {
  /** Server origin, e.g. "https://app.perch.ws". */
  server: string;
  username: string;
  token: string;
}

export const DEFAULT_HUB = 'https://app.perch.ws';

export const getCommunity = () => getLocal<CommunityAccount | null>(COMMUNITY_KEY, null);
export const saveCommunity = (account: CommunityAccount) => setLocal(COMMUNITY_KEY, account);
export const clearCommunity = () => setLocal(COMMUNITY_KEY, null);
export const watchCommunity = (fn: () => void) => watchLocal(COMMUNITY_KEY, fn);
