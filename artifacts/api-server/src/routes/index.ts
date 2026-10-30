import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { createTutorRoutes } from "./tutor";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/tutor", createTutorRoutes());

export default router;
