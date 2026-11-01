import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared PostgreSQL enums for the PRIMER platform (spec §5).
 *
 * Spec-fixed vocab (roles, mastery levels, evidence kinds) lives in enums;
 * open-ended vocab (subjects, strategy ids, audit actions) is stored as text
 * so engines can grow it without a migration.
 */

export const userRole = pgEnum("user_role", [
  "student",
  "parent",
  "educator",
  "admin",
]);

/**
 * What an assessment's evidence actually demonstrates.
 *
 * `recall` (a correct answer) can only support memorization/recognition.
 * `comprehension` and above require independent evidence: application,
 * explanation, or transfer (spec §6.3). Enforced by a CHECK constraint on
 * `assessments` and mirrored in `insertAssessmentSchema`.
 */
export const assessmentEvidenceKind = pgEnum("assessment_evidence_kind", [
  "recall",
  "application",
  "explanation",
  "transfer",
]);

export const masteryLevel = pgEnum("mastery_level", [
  "memorization",
  "recognition",
  "comprehension",
  "application",
  "mastery",
]);

export const consentType = pgEnum("consent_type", [
  "guardian_access",
  "learning_data",
]);

export const consentStatus = pgEnum("consent_status", [
  "pending",
  "granted",
  "revoked",
]);

export const sessionStatus = pgEnum("session_status", [
  "active",
  "completed",
]);

export const turnAuthor = pgEnum("turn_author", ["student", "tutor"]);

export const profileEntryKind = pgEnum("profile_entry_kind", [
  "gap",
  "misconception",
  "successful_approach",
  "preference",
  "strategy_change",
]);

export const progressEventKind = pgEnum("progress_event_kind", [
  "assessment_recorded",
  "mastery_changed",
  "strategy_changed",
  "session_completed",
  "milestone_reached",
]);

export const auditDecision = pgEnum("audit_decision", ["allowed", "denied"]);

export const textSize = pgEnum("text_size", [
  "small",
  "medium",
  "large",
  "xlarge",
]);
