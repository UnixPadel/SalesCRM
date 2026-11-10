import type { Clock, IdGenerator, Logger } from "../../shared/kernel";
import type { DomainEventPublisher, EurRates, PlatformRegistry, UnitOfWork } from "../domain";

/** İsteği yapan kişi; oturumdan gelir (api katmanı çevirir). */
export interface Actor {
  userId: string;
  isAdmin: boolean;
}

export interface UseCaseDeps {
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  platforms: PlatformRegistry;
  events: DomainEventPublisher;
  logger: Logger;
  /** Dağıtıcı bekleme süresi = geri al penceresi (Genel plan). */
  undoWindowMs: number;
  /** Satış ekibinin takvimi ("bugün", otomatik takip saati); verilmezse Europe/Istanbul. */
  timeZone?: string | undefined;
  /** Pano toplamları için para birimi → EUR çarpanları; verilmezse DEFAULT_EUR_RATES. */
  eurRates?: EurRates | undefined;
  /** Ekip dizini (Faz 7g): rapor satırları ve bölge atamasında pasif kullanıcı. Yoksa ya da null dönerse süzme yok. */
  team?: TeamDirectory | undefined;
  /** Yetki anahtarları (Faz 7g, D4); verilmezse hepsi kapalı. */
  policy?: { repsEditProducts: boolean } | undefined;
}

/** Kullanıcı tablosundan okunan ekip bilgisi; hata ya da kapalı DB'de null (fail-open). */
export interface TeamDirectory {
  /** Aktif satış kullanıcıları (yönetici + temsilci). */
  activeSalesUserIds(): Promise<string[] | null>;
  /** Pasif kullanıcılar (bölge kuralında atlanır). */
  inactiveUserIds?(): Promise<ReadonlySet<string> | null>;
}
