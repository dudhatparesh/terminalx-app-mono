const fs = require("fs");
const path = require("path");

const appDir = __dirname;
const envFile = path.join(appDir, ".env");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const index = trimmed.indexOf("=");
  if (index === -1) return null;

  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  } else {
    const comment = value.match(/\s+#/);
    if (comment) value = value.slice(0, comment.index).trim();
  }

  return [key, value];
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};

  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const parsed = parseEnvLine(line);
      if (parsed) env[parsed[0]] = parsed[1];
      return env;
    }, {});
}

const fileEnv = loadEnv(envFile);

module.exports = {
  apps: [
    {
      name: "terminalx",
      cwd: appDir,
      script: "npm",
      args: "run start",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        PORT: fileEnv.PORT || "3456",
      },
      max_memory_restart: "1G",
      time: true,
    },
  ],
};
