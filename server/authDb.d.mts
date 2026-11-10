// Tip bildirimi: server/authDb.mjs Faz 1'de TypeScript'e taşınana kadar (ADR-0001) betikler bu bildirimi kullanır.
export interface TeamRow {
  id: string;
  login: string;
  email: string;
  first: string;
  last: string;
  role: "admin" | "rep" | "viewer";
}
export function authDbEnabled(): boolean;
export function authDbLabel(): string;
export function listTeam(): Promise<TeamRow[]>;
/** Faz 7g: pasifler dahil bütün kullanıcı tablosu (ad gösterimi, Excel sorumlu eşlemesi); parola ve telefon yok. */
export interface DirectoryRow extends TeamRow {
  roleLabel: string;
  active: boolean;
}
export function listDirectory(): Promise<DirectoryRow[]>;
export function checkTable(): Promise<number>;
export function checkLogin(
  login: string,
  password: string,
): Promise<
  | { ok: false; inactive?: boolean }
  | { ok: true; id: string; name: string; email: string; role: string; isAdmin: boolean }
>;
