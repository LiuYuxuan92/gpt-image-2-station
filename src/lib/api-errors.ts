import { NextResponse } from "next/server";

export type UserFacingErrorLike = {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
  debug?: unknown;
};

export function isUserFacingErrorLike(error: unknown): error is UserFacingErrorLike {
  if (!error || typeof error !== "object") return false;
  const value = error as UserFacingErrorLike;
  return (
    value.name === "UserFacingError" ||
    (typeof value.code === "string" &&
      typeof value.status === "number" &&
      typeof value.message === "string")
  );
}

export function userFacingErrorResponse(error: UserFacingErrorLike) {
  return NextResponse.json(
    {
      ok: false,
      code: error.code ?? "bad_request",
      message: error.message ?? "请求失败。",
      debug: error.debug ?? null,
    },
    { status: error.status ?? 400 },
  );
}

export function internalErrorResponse(message: string, error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      code: "internal_error",
      message,
      debug: error instanceof Error ? error.message : null,
    },
    { status: 500 },
  );
}
