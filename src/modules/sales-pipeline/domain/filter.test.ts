import { describe, expect, it } from "vitest";
import { filterValues } from "./filter";

describe("filterValues (çoklu değerli süzgeç)", () => {
  it("undefined ve boş liste süzgeç yok demektir", () => {
    expect(filterValues(undefined)).toBeUndefined();
    expect(filterValues([])).toBeUndefined();
  });

  it("tek değer tek elemanlı listedir; null (ortak havuz) da bir değerdir", () => {
    expect(filterValues("rep-1")).toEqual(["rep-1"]);
    expect(filterValues(null)).toEqual([null]);
  });

  it("liste olduğu gibi döner", () => {
    expect(filterValues(["rep-1", null])).toEqual(["rep-1", null]);
  });
});
