/*
 * Class-feature caps — config, not magic numbers. Mirrors lib/auth/quota.ts's
 * env-overridable `capFor()`: each cap reads an env var and falls back to a
 * default. Bump these on a bigger deployment via the env; the store enforces
 * them with the atomic guarded-insert idiom so the last-seat race is closed
 * (design report §2.4).
 *
 * Defaults:
 *   CLASS_MAX_STUDENTS               50   — a large classroom / two sections
 *   CLASS_MAX_CLASSES_PER_TEACHER    10   — a full teaching load with headroom
 *   CLASS_MAX_MEMBERSHIPS           100   — safety bound on one account
 */

const envInt = (name: string, dflt: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

export const classCaps = () => ({
  studentsPerClass: envInt("CLASS_MAX_STUDENTS", 50),
  classesPerTeacher: envInt("CLASS_MAX_CLASSES_PER_TEACHER", 10),
  membershipsPerAccount: envInt("CLASS_MAX_MEMBERSHIPS", 100),
});

/** Which cap was hit. */
export type ClassCap = "students" | "classes" | "memberships";

const CAP_MESSAGE: Record<ClassCap, string> = {
  students: "This class is full.",
  classes: "You've reached the maximum number of classes you can create.",
  memberships: "You've reached the maximum number of classes you can be in.",
};

/**
 * Thrown by the store when a guarded insert is rejected because a cap is
 * reached. The API wrapper (lib/api.ts) maps it to 409 by NAME, exactly like
 * ForbiddenError → 403, so the wrapper needs no hard import of this module.
 */
export class ClassCapError extends Error {
  constructor(public cap: ClassCap) {
    super(CAP_MESSAGE[cap]);
    this.name = "ClassCapError";
  }
}
