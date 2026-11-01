import { relations } from "drizzle-orm";
import { users, guardianLinks, consents } from "./users";
import { learningProfiles } from "./learning-profiles";
import { tutoringSessions, assessments } from "./tutoring";
import { progressEvents } from "./progress";
import { accessibilityPrefs } from "./accessibility";
import { educatorLinks, educatorAssignments, educatorSupports } from "./educator";

/**
 * The reverse side of the query graph — everything reachable FROM a user.
 * Lives in its own file so the table modules stay cycle-free (relations.ts
 * imports them all; nothing imports relations.ts except the barrel).
 */
export const usersRelations = relations(users, ({ many, one }) => ({
  learningProfile: one(learningProfiles, {
    fields: [users.id],
    references: [learningProfiles.studentId],
  }),
  tutoringSessions: many(tutoringSessions),
  assessments: many(assessments),
  progressEvents: many(progressEvents),
  accessibilityPrefs: many(accessibilityPrefs),
  guardianLinksAsParent: many(guardianLinks, {
    relationName: "guardian_link_parent",
  }),
  guardianLinksAsStudent: many(guardianLinks, {
    relationName: "guardian_link_student",
  }),
  consentsAsGuardian: many(consents),
  educatorLinksAsEducator: many(educatorLinks, {
    relationName: "educator_link_educator",
  }),
  educatorLinksAsStudent: many(educatorLinks, {
    relationName: "educator_link_student",
  }),
  educatorAssignmentsAsEducator: many(educatorAssignments, {
    relationName: "educator_assignment_educator",
  }),
  educatorAssignmentsAsStudent: many(educatorAssignments),
  educatorSupportsAsStudent: many(educatorSupports),
  educatorSupportsUpdated: many(educatorSupports, {
    relationName: "educator_supports_updater",
  }),
}));
