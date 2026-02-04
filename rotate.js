import fs from "fs";
import { spawn } from "child_process";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const logFile = process.argv[2];
const cmd = process.argv[3];
const args = process.argv.slice(4);

if (!logFile || !cmd) {
  console.error("Usage: node rotate.js <logfile> <command> [args...]");
  process.exit(1);
}

let out = fs.createWriteStream(logFile, { flags: "a" });

function rotate() {
  const oldest = `${logFile}.${MAX_FILES}`;
  if (fs.existsSync(oldest)) {
    fs.unlinkSync(oldest);
  }

  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const from = `${logFile}.${i}`;
    const to = `${logFile}.${i + 1}`;
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
    }
  }

  if (fs.existsSync(logFile)) {
    fs.renameSync(logFile, `${logFile}.1`);
  }

  out.end();
  out = fs.createWriteStream(logFile, { flags: "a" });
}

function write(data) {
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_SIZE) {
    rotate();
  }
  out.write(data);
}

const child = spawn(cmd, args, {
  stdio: ["inherit", "pipe", "pipe"],
  shell: true,
});

child.stdout.on("data", write);
child.stderr.on("data", write);

child.on("exit", (code) => {
  out.end();
  process.exit(code || 0);
});

process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
