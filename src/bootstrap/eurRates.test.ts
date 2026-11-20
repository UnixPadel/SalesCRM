import { describe, expect, it } from "vitest";
import { createLogger } from "../modules/shared/kernel";
import { parseLeadFields } from "../modules/sales-pipeline/domain";
import { currencyList } from "../modules/sales-pipeline/api/router";
import { createEurRatesStore, fxRatesJob, parseTcmbXml, type FetchLike } from "./eurRates";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="19.11.2026" Date="11/19/2026" Bulten_No="2026/218">
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><ForexBuying>50.0000</ForexBuying></Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexBuying>55.0000</ForexBuying></Currency>
  <Currency CrossOrder="11" Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit><ForexBuying>33.0000</ForexBuying></Currency>
  <Currency CrossOrder="19" Kod="AED" CurrencyCode="AED"><Unit>1</Unit><ForexBuying>13.7500</ForexBuying></Currency>
  <Currency CrossOrder="20" Kod="XDR" CurrencyCode="XDR"><Unit>1</Unit><ForexBuying></ForexBuying></Currency>
</Tarih_Date>`;

function memorySettings() {
  const rows = new Map<string, { value: string; updatedAt: Date }>();
  return {
    rows,
    async get(provider: string, key: string) {
      return rows.get(`${provider}/${key}`);
    },
    async set(provider: string, key: string, value: string, now: Date) {
      rows.set(`${provider}/${key}`, { value, updatedAt: now });
    },
  };
}

const logger = createLogger({}, () => {});
const clock = { now: () => new Date("2026-11-20T12:00:00Z") };
const okFetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => XML });

describe("TCMB kurları (2026-11-20)", () => {
  it("bülten → '1 birim = X EUR'; birim ve boş kur hesaba katılır", () => {
    const r = parseTcmbXml(XML);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rateDate).toBe("2026-11-19");
    expect(r.value.rates).toEqual({
      EUR: 1,
      TRY: Number((1 / 55).toPrecision(6)),
      USD: Number((50 / 55).toPrecision(6)),
      JPY: Number((0.33 / 55).toPrecision(6)),
      AED: Number((13.75 / 55).toPrecision(6)),
    });
    expect(parseTcmbXml("<html>bakım</html>").ok).toBe(false);
  });

  it("refresh kurları yazar, kaynak TCMB; elle kayıt kaynağı değiştirir; anahtar kapalıysa iş çekmez", async () => {
    const settings = memorySettings();
    let calls = 0;
    const fetchImpl: FetchLike = async (...a) => {
      calls += 1;
      return okFetch(...a);
    };
    const store = createEurRatesStore({ settings, envJson: "", clock, logger, fetchImpl });
    expect((await store.describe()).auto).toBe(true);

    const fresh = await store.refresh();
    expect(fresh.ok && fresh.value.source).toBe("tcmb");
    expect(fresh.ok && fresh.value.rateDate).toBe("2026-11-19");
    expect(fresh.ok && fresh.value.rates["AED"]).toBeCloseTo(0.25, 6);
    // Varsayılan tablodaki GBP bültende yok: korunur.
    expect(fresh.ok && fresh.value.rates["GBP"]).toBe(1.17);

    const manual = await store.save({ USD: 0.9 }, { auto: false });
    expect(manual.ok && manual.value).toMatchObject({ source: "setting", auto: false, rateDate: null });

    await fxRatesJob(store, logger, 60_000).run();
    expect(calls).toBe(1);

    const on = await store.save(undefined, { auto: true });
    expect(on.ok && on.value).toMatchObject({ auto: true, rates: { USD: 0.9 } });
    await fxRatesJob(store, logger, 60_000).run();
    expect(calls).toBe(2);
    expect((await store.describe()).source).toBe("tcmb");
  });

  it("TCMB'ye ulaşılamazsa hata döner, eski kurlar kalır", async () => {
    const settings = memorySettings();
    const store = createEurRatesStore({
      settings,
      envJson: "",
      clock,
      logger,
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }),
    });
    const r = await store.refresh();
    expect(!r.ok && r.error.code).toBe("eur_rates.tcmb_unreachable");
    expect((await store.describe()).source).toBe("default");
  });

  it("para birimi listesi: önce EUR, USD, TRY, GBP ve Körfez, sonra kalanlar alfabetik", () => {
    expect(currencyList({ EUR: 1, JPY: 0.006, AED: 0.25, USD: 0.9, TRY: 0.018, GBP: 1.17, CHF: 1.06 })).toEqual([
      "EUR",
      "USD",
      "TRY",
      "GBP",
      "AED",
      "CHF",
      "JPY",
    ]);
  });
});

describe("lead çalışma para birimi", () => {
  it("3 harfli kod büyük harfe çevrilir; boş değer temizler; geçersiz kod reddedilir", () => {
    const a = parseLeadFields({ currency: " usd " });
    expect(a.ok && a.value).toEqual({ currency: "USD" });
    const b = parseLeadFields({ currency: "" });
    expect(b.ok && b.value).toEqual({ currency: null });
    const c = parseLeadFields({ currency: "dollar" });
    expect(!c.ok && c.error.code).toBe("lead.currency_invalid");
  });
});
