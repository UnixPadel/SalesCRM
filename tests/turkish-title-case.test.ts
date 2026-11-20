import { describe, expect, it } from "vitest";
import { dotTurkishI } from "../src/i18n/turkishI";

describe("dotTurkishI", () => {
  it("kelime başındaki i harfini noktalı İ yapar", () => {
    expect(dotTurkishI("Kazanıldı olarak işaretle")).toBe("Kazanıldı olarak İşaretle");
    expect(dotTurkishI("ilk eşitleme")).toBe("İlk eşitleme");
    expect(dotTurkishI("Teklif tutarı (isteğe bağlı)")).toBe("Teklif tutarı (İsteğe bağlı)");
    expect(dotTurkishI("Lead/iletişim")).toBe("Lead/İletişim");
  });

  it("kelime içindeki i harflerine dokunmaz", () => {
    expect(dotTurkishI("Bilgiler")).toBe("Bilgiler");
    expect(dotTurkishI("Excel'den içe aktar")).toBe("Excel'den İçe aktar");
    expect(dotTurkishI("x'ig 3ih x_ik")).toBe("x'ig 3ih x_ik");
  });

  it("önceki karakter harfse metnin ilk i harfini kelime içi sayar", () => {
    expect(dotTurkishI("içe", "n")).toBe("içe");
    expect(dotTurkishI("içe", " ")).toBe("İçe");
  });
});
