import { Router } from "express";
import { reimbursementController } from "../controllers/reimbursements";

const r = Router();
r.get    ("/",    reimbursementController.getAll);
r.get    ("/:id", reimbursementController.getOne);
r.post   ("/",    reimbursementController.create);
r.put    ("/:id", reimbursementController.update);
r.delete ("/:id", reimbursementController.remove);
export default r;
