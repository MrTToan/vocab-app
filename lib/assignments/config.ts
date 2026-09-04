/*
 * Assignment caps + typed errors — config, not magic numbers (mirrors
 * lib/classes/config.ts). The API wrapper (lib/api.ts) maps these BY NAME
 * (AssignmentCapError → 409, AssignmentInputError → 400), exactly like
 * ClassCapError, so the wrapper needs no hard import of this module.
 */

const envInt = (name: string, dflt: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

export const assignmentCaps = () => ({
  /** Active (un-archived) assignments per class. */
  perClass: envInt("ASSIGNMENT_MAX_PER_CLASS", 200),
});

/** Thrown when a class is at its assignment cap. Mapped to 409 by NAME. */
export class AssignmentCapError extends Error {
  constructor() {
    super("This class has reached its assignment limit. Archive an old one first.");
    this.name = "AssignmentCapError";
  }
}

/** Thrown for bad create input (unknown/invisible content ref, or no targeted
 *  student is actually in the class). Mapped to 400 by NAME; message is
 *  user-facing. */
export class AssignmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentInputError";
  }
}
