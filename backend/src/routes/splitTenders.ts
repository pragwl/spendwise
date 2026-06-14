import { Router } from "express";
import { splitTenderController } from "../controllers/splitTenders";

const r = Router();

r.get   ("/",    splitTenderController.getAll);
r.get   ("/:id", splitTenderController.getOne);
r.post  ("/",    splitTenderController.create);
r.put   ("/:id", splitTenderController.update);
r.delete("/:id", splitTenderController.remove);

export default r;
