import multer from "multer";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config/index.js";
import { ACCEPTED_EXTENSIONS } from "../services/ingestion.js";

const MAX_FILE_BYTES = config.limits.uploadMaxMb * 1024 * 1024; // NotebookLM caps uploads at 200MB
const MAX_FILES_PER_REQUEST = 20;

const storage = multer.diskStorage({
  destination: config.paths.uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  // Browsers send multipart filenames as latin1; recover the UTF-8 name.
  file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    const error = new Error(`Unsupported file type "${ext || file.originalname}". Use ${ACCEPTED_EXTENSIONS.join(", ")}.`);
    error.status = 400;
    cb(error);
    return;
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
});
