/**
 * Ürün listesi (yönetim → "Ürün listesi"): herkes okur; yalnız yönetici ürün dosyasından günceller. Güncelleme önce
 * kuru çalıştırılır (eklenecek, adı değişecek, kullanımdan kalkacak ürünler gösterilir), onaydan sonra uygulanır.
 * Ürün numarası dosyadaki numaradır; dosyada olmayan ürün silinmez, kullanımdan kalkar.
 */
import type { RuleError, Result } from "../../shared/kernel";
import { ok } from "../../shared/kernel";
import { parseCatalogRows, planCatalogImport, type CatalogImportPlan, type CatalogProduct } from "../domain";
import { requireAdmin } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";

export interface CatalogImportInput {
  actor: Actor;
  rows: readonly { id: unknown; name: unknown }[];
  /** Dosyada olup listeye alınmayacak yeni ürün numaraları. */
  skip?: readonly number[];
  dryRun: boolean;
}

export class ProductCatalog {
  constructor(private readonly deps: UseCaseDeps) {}

  list(): Promise<CatalogProduct[]> {
    return this.deps.uow.run((repos) => repos.products.list());
  }

  async import(input: CatalogImportInput): Promise<Result<CatalogImportPlan & { applied: boolean }, RuleError>> {
    const admin = requireAdmin(input.actor, "product_catalog");
    if (!admin.ok) return admin;
    const rows = parseCatalogRows(input.rows);
    if (!rows.ok) return rows;
    const skip = (input.skip ?? []).filter((n) => Number.isInteger(n));
    // Atlanan yeni ürünler dosya sırasından da düşer (listede yer tutmasınlar).
    const order = rows.value.filter((r) => !skip.includes(r.id));
    return this.deps.uow.run(async (repos) => {
      const plan = planCatalogImport(await repos.products.list(), rows.value, skip);
      if (input.dryRun) return ok({ ...plan, applied: false });
      await repos.products.apply(plan, order, this.deps.clock.now());
      this.deps.logger.info("ürün listesi güncellendi", {
        added: plan.added.length,
        renamed: plan.renamed.length,
        deactivated: plan.deactivated.length,
        reactivated: plan.reactivated.length,
        actorUserId: input.actor.userId,
      });
      return ok({ ...plan, applied: true });
    });
  }
}
