import { Router } from "express";
import { sourceController } from "../controllers/sources";

const r = Router();
r.get    ("/",    sourceController.getAll);
r.get    ("/:id", sourceController.getOne);
r.post   ("/",    sourceController.create);
r.put    ("/:id", sourceController.update);
r.delete ("/:id", sourceController.remove);
export default r;
