import { spawnSync } from "node:child_process";

const result = spawnSync("next", ["build"], {
  env: {
    ...process.env,
    NEXT_IGNORE_INCORRECT_LOCKFILE: "1"
  },
  shell: true,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
