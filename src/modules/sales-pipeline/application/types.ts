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
}
