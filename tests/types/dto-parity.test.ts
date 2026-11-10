// DTO ↔ domain eşliği (Faz 7g, iş emri §4.5 [M-I10]). Arayüz yalnız api/dto.ts'yi bilir; kod listeleri ve alan
// adları domain'den kayarsa burada yakalanır. Tip denetimi `npm run typecheck` (tsconfig.modules.json `tests`'i kapsar)
// sırasında yapılır; çalışma zamanındaki karşılaştırmalar aynı listeleri değer olarak da doğrular.
// S4: `Jsonify<TrackingReport>` → `TrackingReportDto` denetimi dto.tracking.ts ile birlikte buraya eklenir.
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ActivityDto,
  ActivityOutcomeDto,
  ActivityTypeDto,
  CourtCountBandDto,
  CustomerProfileDto,
  CustomerStatusDto,
  InstallSiteDto,
  InstallTimelineDto,
  LeadDto,
  LeadListDto,
  ProductPrefsDto,
  StageCodeDto,
} from "../../src/modules/sales-pipeline/api/dto";
import type { LeadListItem } from "../../src/modules/sales-pipeline/application/queries";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  COURT_COUNT_BANDS,
  CUSTOMER_PROFILES,
  CUSTOMER_STATUSES,
  INSTALL_SITES,
  INSTALL_TIMELINES,
  STAGE_CODES,
  type Activity,
  type ActivityOutcome,
  type ActivityType,
  type CourtCountBand,
  type CustomerProfile,
  type CustomerStatus,
  type InstallSite,
  type InstallTimeline,
  type Lead,
  type ProductPrefs,
  type StageCode,
} from "../../src/modules/sales-pipeline/domain";

/** JSON gidiş-dönüşü: Date → ISO metin; diziler ve nesneler özyineli. */
type Jsonify<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

/** Kod listesinin her DTO kodunu tam bir kez taşıdığını derleme anında zorlar; anahtarlar çalışma anında karşılaştırılır. */
const codes = <T extends string>(all: Record<T, true>): string[] => Object.keys(all).sort();

describe("DTO ↔ domain eşliği", () => {
  it("kod listeleri birebir aynı (tip ve değer)", () => {
    expectTypeOf<ActivityTypeDto>().toEqualTypeOf<ActivityType>();
    expectTypeOf<ActivityOutcomeDto>().toEqualTypeOf<ActivityOutcome>();
    expectTypeOf<StageCodeDto>().toEqualTypeOf<StageCode>();
    expectTypeOf<CustomerStatusDto>().toEqualTypeOf<CustomerStatus>();
    expectTypeOf<InstallSiteDto>().toEqualTypeOf<InstallSite>();
    expectTypeOf<InstallTimelineDto>().toEqualTypeOf<InstallTimeline>();
    expectTypeOf<CustomerProfileDto>().toEqualTypeOf<CustomerProfile>();
    expectTypeOf<CourtCountBandDto>().toEqualTypeOf<CourtCountBand>();

    expect(
      codes<ActivityTypeDto>({
        call: true,
        email: true,
        whatsapp: true,
        meeting: true,
        proposal_sent: true,
        site_visit: true,
        other: true,
      }),
    ).toEqual([...ACTIVITY_TYPES].sort());
    expect(
      codes<ActivityOutcomeDto>({
        reply_received: true,
        awaiting_reply: true,
        proposal_sent: true,
        follow_up: true,
        negative: true,
        agreed: true,
      }),
    ).toEqual([...ACTIVITY_OUTCOMES].sort());
    expect(
      codes<StageCodeDto>({ NEW: true, CONTACTED: true, QUALIFIED: true, PROPOSAL: true, WON: true, LOST: true }),
    ).toEqual([...STAGE_CODES].sort());
    expect(
      codes<CustomerStatusDto>({
        interested: true,
        not_interested: true,
        project_phase: true,
        collecting_prices: true,
        buyer_ready: true,
      }),
    ).toEqual([...CUSTOMER_STATUSES].sort());
    expect(
      codes<InstallSiteDto>({
        covered_court: true,
        no_site_yet: true,
        indoor_hall: true,
        beach_windy: true,
        rooftop: true,
        existing_ground: true,
        other: true,
      }),
    ).toEqual([...INSTALL_SITES].sort());
    expect(codes<InstallTimelineDto>({ m0_3: true, m3_6: true, m6_12: true, researching: true })).toEqual(
      [...INSTALL_TIMELINES].sort(),
    );
    expect(
      codes<CustomerProfileDto>({
        investor: true,
        club_operator: true,
        private_home: true,
        public_facility: true,
        hospitality_residential: true,
        distributor: true,
      }),
    ).toEqual([...CUSTOMER_PROFILES].sort());
    expect(codes<CourtCountBandDto>({ "1": true, "2_3": true, "4_6": true, "7_plus": true })).toEqual(
      [...COURT_COUNT_BANDS].sort(),
    );
  });

  it("LeadDto = Jsonify<Lead>: aynı alan adları, JSON'da aynı tipler", () => {
    expectTypeOf<keyof LeadDto>().toEqualTypeOf<keyof Lead>();
    // İki yönlü: DTO alanı genişlerse (ör. customerStatus: string) ya da daralırsa tip denetimi kırılır.
    expectTypeOf<LeadDto>().toEqualTypeOf<Jsonify<Lead>>();
    expectTypeOf<ProductPrefsDto>().toEqualTypeOf<Jsonify<ProductPrefs>>();
    expectTypeOf<LeadDto["checkedWarnings"]>().toEqualTypeOf<string[]>();
  });

  it("LeadListDto ← Jsonify<LeadListItem> (Date → string)", () => {
    expectTypeOf<Jsonify<LeadListItem>>().toExtend<LeadListDto>();
    expectTypeOf<Exclude<keyof LeadListDto, keyof LeadListItem>>().toEqualTypeOf<never>();
  });

  it("ActivityDto, Activity'nin JSON alt kümesi (temas alanları dahil)", () => {
    expectTypeOf<Pick<Jsonify<Activity>, keyof ActivityDto>>().toEqualTypeOf<ActivityDto>();
    expectTypeOf<
      Extract<
        keyof ActivityDto,
        "outcome" | "customerReplied" | "resultNote" | "doneByUserId" | "dateEstimated" | "logId" | "nextOfLogId"
      >
    >().toEqualTypeOf<
      "outcome" | "customerReplied" | "resultNote" | "doneByUserId" | "dateEstimated" | "logId" | "nextOfLogId"
    >();
  });
});
