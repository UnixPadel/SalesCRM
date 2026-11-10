/**
 * Lead listesi süzgecinin değer yardımcısı (Faz 7g). Postgres deposu ve bellek içi sahte aynı anlamı paylaşır:
 * tek değer ya da liste → liste ("bunlardan biri"); boş liste ve undefined → undefined (süzgeç yok).
 */
export function filterValues<T>(v: T | readonly T[] | undefined): readonly T[] | undefined {
  if (v === undefined) return undefined;
  const list = Array.isArray(v) ? (v as readonly T[]) : [v as T];
  return list.length ? list : undefined;
}
