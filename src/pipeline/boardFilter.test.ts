import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterCount, filterFromParams, filterToParams, hasFilterParams } from "./boardFilter";

describe("boardFilter", () => {
  it("hızlı çipler URL'de: contact=never, hot=1, warning=1; gidiş-dönüş", () => {
    const f = { ...EMPTY_FILTER, owner: "me", rotting: true, never: true, hot: true, warning: true };
    const p = filterToParams(f);
    expect(p.toString()).toBe("owner=me&rotting=1&contact=never&hot=1&warning=1");
    expect(filterFromParams(p)).toEqual(f);
    expect(filterCount(f)).toBe(5);
  });
  it("görünüm anahtarları filtre sayılmaz; from varken hatırlanan uygulanmaz", () => {
    expect(hasFilterParams(new URLSearchParams("view=board&sort=x"))).toBe(false);
    expect(hasFilterParams(new URLSearchParams("from=report"))).toBe(true);
    expect(hasFilterParams(new URLSearchParams("hot=1"))).toBe(true);
  });
});
