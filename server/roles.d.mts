// Tip bildirimi: server/roles.mjs (testler bu bildirimi kullanır).
import type { NextFunction, Request, Response } from "express";

export type SessionRole = "admin" | "rep" | "viewer" | "marketing";
export function marketingUsers(env?: Record<string, string | undefined>): Set<string>;
export function sessionRole(
  baseRole: string,
  ids: { id?: unknown; login?: unknown; email?: unknown },
  marketing: Set<string>,
): string;
export function campaignViewers(env?: Record<string, string | undefined>): Set<string>;
export function logViewers(env?: Record<string, string | undefined>): Set<string>;
export function seesCampaign(ids: { id?: unknown; login?: unknown; email?: unknown }, viewers: Set<string>): boolean;
export function sessionSees(
  role: string | undefined,
  ids: { id?: unknown; login?: unknown; email?: unknown },
  viewers: Set<string>,
): boolean;
export function isReadOnlyRole(role: string | undefined): boolean;
export function canReadAdmin(role: string | undefined): boolean;
export function canWriteAdmin(role: string | undefined): boolean;
export function canSeeReports(role: string | undefined): boolean;
export function canReadDirectory(role: string | undefined): boolean;
export function adminAccess(req: Request, res: Response, next: NextFunction): void;
export function reportsAccess(req: Request, res: Response, next: NextFunction): void;
