// mail-activity/application: Gönderilmiş klasörü taraması ve haftalık rapor sorgusu.
export * from "./scanSentFolders";
export * from "./weeklyReport";
export type * from "../domain/ports";
export { parseWeek, shiftWeek, weekOf, weekRangeOf, type WeekRange } from "../domain/week";
