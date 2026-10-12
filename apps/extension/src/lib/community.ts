import { getLocal, setLocal, watchLocal } from './storage/local';

// The Perch account: a name on a Perch Server someone runs (yours, a friend's) for
// sharing notes. It's separate from sync: the library can sync by chain, by
// a server of your own, or not at all, and still share through this account.

export const COMMUNITY_KEY = 'perch:community';

export interface CommunityAccount {
  /** Server origin, e.g. "https://perch.example.com". */
  server: string;
  username: string;
  token: string;
}

// The web reader once kept a token-less record that leaned on a same-origin
// cookie; it signs in with a token now, so such a record counts as signed out.
export const getCommunity = async () => {
  const account = await getLocal<CommunityAccount | null>(COMMUNITY_KEY, null);
  return account?.token ? account : null;
};
export const saveCommunity = (account: CommunityAccount) => setLocal(COMMUNITY_KEY, account);
export const clearCommunity = () => setLocal(COMMUNITY_KEY, null);
export const watchCommunity = (fn: () => void) => watchLocal(COMMUNITY_KEY, fn);
