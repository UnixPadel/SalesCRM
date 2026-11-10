import { describe, expect, it } from "vitest";
import { labelParts, matchTeamLabel, type DirectoryEntry } from "./teamMatch";

/** Sentetik dizin (gerçek kişi yok). */
const DIR: DirectoryEntry[] = [
  { id: "32", first: "Yuşa", last: "Bedir", email: "yusa.bedir@example.test", role: "rep", active: true },
  { id: "26", first: "Ali", last: "A", email: "satis@example.test", role: "rep", active: true },
  { id: "51", first: "Veli", last: "B", email: "satis@example.test", role: "rep", active: true },
  { id: "45", first: "Beyza", last: "C", email: "beyza@example.test", role: "rep", active: false },
  { id: "47", first: "Ahlem", last: "D", email: "export2@example.test", role: "rep", active: true },
  { id: "22", first: "Eski", last: "E", email: "export2@example.test", role: "rep", active: false },
  { id: "9", first: "Muhasebe", last: "F", email: "muhasebe@example.test", role: "viewer", active: true },
];

describe("labelParts", () => {
  it("ad ve e-posta; 'email bekleniyor' e-posta değildir", () => {
    expect(labelParts("Yusa Bedir (yusa.bedir@example.test)")).toEqual({
      name: "Yusa Bedir",
      email: "yusa.bedir@example.test",
    });
    expect(labelParts("Faruk (email bekleniyor)")).toEqual({ name: "Faruk", email: null });
    expect(labelParts("Almanya Distribütörü")).toEqual({ name: "Almanya Distribütörü", email: null });
  });
});

describe("matchTeamLabel", () => {
  it("tam e-posta; pasif kopya ayıklanır", () => {
    expect(matchTeamLabel("Ahlem (export2@example.test)", DIR)).toEqual({ kind: "user", userId: "47", via: "email" });
  });
  it("ortak posta kutusu iki aktifte → ambiguous", () => {
    expect(matchTeamLabel("Enes (satis@example.test)", DIR)).toEqual({
      kind: "unresolved",
      reason: "ambiguous",
      candidates: ["26", "51"],
    });
  });
  it("yalnız pasif → inactive_only; tabloda yok → not_in_directory", () => {
    expect(matchTeamLabel("Beyza (sales@example.test)", DIR)).toMatchObject({
      kind: "unresolved",
      reason: "inactive_only",
    });
    expect(matchTeamLabel("Mehmet (mehmet@example.test)", DIR)).toMatchObject({
      kind: "unresolved",
      reason: "not_in_directory",
    });
  });
  it("Yusa/Yuşa katlama ad soyadla; ATANMADI havuz; dış ortak çözülmez; override öncelikli", () => {
    expect(matchTeamLabel("Yusa Bedir", DIR)).toEqual({ kind: "user", userId: "32", via: "name" });
    expect(matchTeamLabel("ATANMADI", DIR)).toEqual({ kind: "pool", via: "unassigned" });
    expect(matchTeamLabel("Almanya Distribütörü", DIR)).toMatchObject({ kind: "unresolved" });
    expect(matchTeamLabel("Enes (satis@example.test)", DIR, { Enes: "26" })).toEqual({
      kind: "user",
      userId: "26",
      via: "override",
    });
    expect(matchTeamLabel("Almanya Distribütörü", DIR, { "Almanya Distribütörü": null })).toEqual({
      kind: "pool",
      via: "override",
    });
  });
  it("görüntüleyici rolü eşlenmez", () => {
    expect(matchTeamLabel("Muhasebe (muhasebe@example.test)", DIR)).toMatchObject({ kind: "unresolved" });
  });
});
