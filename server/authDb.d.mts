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
export function checkTable(): Promise<number>;
export function checkLogin(
  login: string,
  password: string,
): Promise<
  | { ok: false; inactive?: boolean }
  | { ok: true; id: string; name: string; email: string; role: string; isAdmin: boolean }
>;
