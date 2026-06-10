import morgan from "morgan";
import { config } from "../config";

export const logger = morgan(config.log.level);
