import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { createTutorRoutes } from "./tutor";
import { createAuthRoutes } from "./auth";
import { createGuardianRoutes } from "./guardian";
import { createProfileRoutes } from "./profiles";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/tutor", createTutorRoutes());
router.use("/auth", createAuthRoutes());
router.use("/guardian", createGuardianRoutes());
router.use("/profiles", createProfileRoutes());

export default router;
