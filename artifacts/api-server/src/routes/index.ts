import { Router, type IRouter } from "express";
import healthRouter from "./health";
import publicationsRouter from "./publications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicationsRouter);

export default router;
