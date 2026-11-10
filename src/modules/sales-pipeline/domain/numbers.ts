/** Sayı yardımcıları (domain içi; dizinden dışa açılmaz). Para, oran ve m² aynı yuvarlamayı kullanır. */

/** 2 ondalığa yuvarlar (rapor tutarları, oranlar, çatı alanı). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;
