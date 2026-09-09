import { type Category, UNCATEGORIZED_ID } from '../types';
import { idFrom } from '../util/hash';
import { getLocal, setLocal, watchLocal, KEYS } from './local';

const DEFAULT_CATEGORIES: Category[] = [
  { id: UNCATEGORIZED_ID, name: 'Uncategorized', order: 1000 },
];

export async function getCategories(): Promise<Category[]> {
  const stored = await getLocal<Category[]>(KEYS.categories, []);
  const list = stored.length ? stored : DEFAULT_CATEGORIES;
  // Guarantee the fallback category always exists.
  if (!list.some((c) => c.id === UNCATEGORIZED_ID)) {
    list.push({ id: UNCATEGORIZED_ID, name: 'Uncategorized', order: 1000 });
  }
  return [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function saveCategories(categories: Category[]): Promise<void> {
  await setLocal(KEYS.categories, categories);
}

export async function addCategory(name: string): Promise<Category> {
  const trimmed = name.trim() || 'New category';
  const categories = await getCategories();
  const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;

  const category: Category = {
    id: idFrom('cat', trimmed, Date.now()),
    name: trimmed,
    order: Math.max(0, ...categories.map((c) => c.order).filter((o) => o < 1000)) + 10,
  };
  await saveCategories([...categories, category]);
  return category;
}

export async function renameCategory(id: string, name: string): Promise<void> {
  if (id === UNCATEGORIZED_ID) return;
  const categories = await getCategories();
  await saveCategories(
    categories.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)),
  );
}

export async function deleteCategory(id: string): Promise<void> {
  if (id === UNCATEGORIZED_ID) return;
  const categories = await getCategories();
  await saveCategories(categories.filter((c) => c.id !== id));
}

export async function setCollapsed(id: string, collapsed: boolean): Promise<void> {
  const categories = await getCategories();
  await saveCategories(categories.map((c) => (c.id === id ? { ...c, collapsed } : c)));
}

export function watchCategories(onChange: (categories: Category[]) => void): () => void {
  return watchLocal<Category[]>(KEYS.categories, () => {
    void getCategories().then(onChange);
  });
}
