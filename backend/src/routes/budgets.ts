import { Router } from "express";
import { budgetController } from "../controllers/budgets";

const r = Router();
r.get    ("/",    budgetController.getAll);
r.get    ("/:id", budgetController.getOne);
r.post   ("/",    budgetController.create);
r.put    ("/:id", budgetController.update);
r.delete ("/:id", budgetController.remove);
export default r;
