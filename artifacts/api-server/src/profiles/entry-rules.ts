import { CreateProfileEntryBody } from "@workspace/api-zod";
// Root `zod` — the same type universe as the generated contract schemas. The
// generated CreateProfileEntryBody is a root-`zod` object, so refining it and
// inferring its output must use the same universe: `zod/v4`'s `infer` sees
// root-`zod` types as `unknown`.
import { z } from "zod";

/**
 * Evidence rules for the learning record (spec §6.2), layered on top of the
 * generated contract body — these shapes are imported from @workspace/api-zod,
 * never hand-rolled.
 *
 * Two rules hold here and nowhere else may they be weaker:
 * 1. Evidence-only tracking: `gap` and `misconception` entries must cite at
 *    least one evidence reference (a sourceAssessmentId or a sourceTurnId).
 *    An entry with nothing behind it is a fabricated judgment, and this
 *    schema is where fabrication stops. Existence and ownership of the
 *    referenced rows are checked against the database by the service layer.
 * 2. Strategy transparency: a `strategy_change` entry must carry a
 *    human-readable `whyChanged` note — the learner gets to know why the
 *    teaching changed (spec §6.2, surfaced in the UI).
 */
export const CreateProfileEntryInput = CreateProfileEntryBody.superRefine(
  (value, ctx) => {
    const hasEvidenceRef =
      value.sourceAssessmentId !== undefined ||
      value.sourceTurnId !== undefined;

    if (
      (value.kind === "gap" || value.kind === "misconception") &&
      !hasEvidenceRef
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["detail"],
        message:
          `A "${value.kind}" entry must reference assessment evidence — ` +
          "provide sourceAssessmentId or sourceTurnId. The learning record is " +
          "written from evidence, never from vibes (spec §6.2).",
      });
    }

    if (
      value.kind === "strategy_change" &&
      (value.whyChanged === undefined || value.whyChanged.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["whyChanged"],
        message:
          "A strategy change must say why in words the learner can read. " +
          "Provide whyChanged (spec §6.2).",
      });
    }
  },
);

export type CreateProfileEntryData = z.infer<typeof CreateProfileEntryInput>;
