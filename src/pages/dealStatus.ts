import { fmtDate, fmtTime, relDays, type Tone } from "../components/ui";
import { isRotting, isWon, nextActivity } from "../domain/rules";
import type { Activity, Deal } from "../domain/types";

export interface DealStatus {
  tone: Tone;
  icon: string;
  text: string;
}

/** One status line per customer, highest priority wins: icon + text, never colour alone. */
export function dealStatus(deal: Deal, activities: Activity[]): DealStatus | null {
  if (deal.stage === "lost") return null; // the reason line carries the message
  if (isWon(deal)) return { tone: "ok", icon: "trophy", text: `Satıldı · ${fmtDate(deal.won_at)}` };
  if (isRotting(deal, activities)) return { tone: "bad", icon: "flame", text: "Takipsiz · planlı adım yok" };
  const { next, status } = nextActivity(deal.id, activities);
  if (!next) return null;
  if (status === "overdue") return { tone: "bad", icon: "alarm", text: `Gecikti (${relDays(next.due_at)}): ${next.subject}` };
  if (status === "today") return { tone: "ok", icon: "clock", text: `Bugün ${fmtTime(next.due_at)}: ${next.subject}` };
  return { tone: "neutral", icon: "calendar", text: `${fmtDate(next.due_at)}: ${next.subject}` };
}
