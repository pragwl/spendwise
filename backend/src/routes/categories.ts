import { Router } from "express";
import { categoryController } from "../controllers/categories";

const r = Router();
r.get    ("/",    categoryController.getAll);
r.get    ("/:id", categoryController.getOne);
r.post   ("/",    categoryController.create);
r.put    ("/:id", categoryController.update);
r.delete ("/:id", categoryController.remove);
export default r;
