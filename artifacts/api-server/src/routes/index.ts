import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { createTutorRoutes } from "./tutor";
import { createAuthRoutes } from "./auth";
import { createGuardianRoutes } from "./guardian";
import { createProfileRoutes } from "./profiles";
import { createAccessibilityRoutes } from "./accessibility";
import { createSessionRoutes } from "../sessions/routes";
import { createProgressRoutes } from "./progress";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/tutor", createTutorRoutes());
router.use("/auth", createAuthRoutes());
router.use("/guardian", createGuardianRoutes());
router.use("/profiles", createProfileRoutes());
// Accessibility preferences are served by the canonical PR #13
// implementation (GET/PUT /me/accessibility); this lane adds only the
// dashboard's progress and session reads.
router.use("/me", createAccessibilityRoutes());
router.use("/progress", createProgressRoutes());
router.use("/sessions", createSessionRoutes());

export default router;
