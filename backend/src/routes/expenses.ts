import { Router } from "express";
import { expenseController } from "../controllers/expenses";

const r = Router();
r.get    ("/",     expenseController.getAll);
r.get    ("/:id",  expenseController.getOne);
r.post   ("/",     expenseController.create);
r.put    ("/:id",  expenseController.update);
r.delete ("/bulk", expenseController.bulkDelete);
r.delete ("/:id",  expenseController.remove);
export default r;
