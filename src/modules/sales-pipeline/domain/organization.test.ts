import { describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import { parseLeadFields } from "./opportunity";
import { isUuid, parseOrganizationFields } from "./organization";

describe("parseOrganizationFields", () => {
  it("oluşturmada ad zorunlu; güncellemede yalnız verilen anahtarlar", () => {
    const r = parseOrganizationFields({}, { requireName: true });
    expect(!r.ok && r.error.code).toBe("organization.name_required");
    expect(unwrap(parseOrganizationFields({}))).toEqual({});
    expect(unwrap(parseOrganizationFields({ name: " Padel Kulübü " }, { requireName: true }))).toEqual({
      name: "Padel Kulübü",
    });
  });

  it("tür listeden; ülke iki harf ve büyük; boş ülke null; metin sınırları", () => {
    expect(unwrap(parseOrganizationFields({ type: "investor", country: "tr", website: " x.com ", notes: "" }))).toEqual(
      {
        type: "investor",
        country: "TR",
        website: "x.com",
        notes: "",
      },
    );
    expect(unwrap(parseOrganizationFields({ country: "" }))).toEqual({ country: null });
    const badType = parseOrganizationFields({ type: "club2" });
    expect(!badType.ok && badType.error.code).toBe("organization.type_unknown");
    const badCountry = parseOrganizationFields({ country: "TUR" });
    expect(!badCountry.ok && badCountry.error.code).toBe("organization.country_invalid");
    expect(parseOrganizationFields({ name: "x".repeat(201) }).ok).toBe(false);
    expect(parseOrganizationFields({ website: "x".repeat(201) }).ok).toBe(false);
    expect(parseOrganizationFields({ notes: 5 }).ok).toBe(false);
  });
});

describe("lead kuruluş bağı (parseLeadFields.organizationId)", () => {
  it("uuid kabul, küçük harfe çevrilir; boş/null bağı kaldırır; başka metin reddedilir", () => {
    const id = "6F9619FF-8B86-D011-B42D-00C04FC964FF";
    expect(isUuid(id)).toBe(true);
    expect(unwrap(parseLeadFields({ organizationId: id }))).toEqual({ organizationId: id.toLowerCase() });
    expect(unwrap(parseLeadFields({ organizationId: "" }))).toEqual({ organizationId: null });
    expect(unwrap(parseLeadFields({ organizationId: null }))).toEqual({ organizationId: null });
    const bad = parseLeadFields({ organizationId: "org1" });
    expect(!bad.ok && bad.error.code).toBe("lead.organization_invalid");
  });
});
