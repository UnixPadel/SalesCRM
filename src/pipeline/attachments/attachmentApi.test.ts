import { describe, expect, it } from "vitest";
import { pastedName } from "./attachmentApi";

describe("pastedName", () => {
  const at = new Date(2026, 10, 24, 14, 32);

  it("panodan yapıştırılan görüntüye tarih ve saatli ad verir", () => {
    expect(pastedName(at, "png")).toBe("ekran-goruntusu-2026-11-24-1432.png");
  });

  it("birden çok dosyada sıra eki ekler, jpeg'i jpg yapar", () => {
    expect(pastedName(at, "JPEG", 2)).toBe("ekran-goruntusu-2026-11-24-1432-2.jpg");
  });

  it("okunamayan uzantıda png kullanır", () => {
    expect(pastedName(at, "")).toBe("ekran-goruntusu-2026-11-24-1432.png");
  });
});
