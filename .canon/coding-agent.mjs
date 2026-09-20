// Real coding-agent execution for action stages.
//
// Analysis stages are a single model turn (invoke-agent.mjs). Action stages —
// anything that must change the repository (code, tests, deployment config) —
// cannot be done by a chat completion: they need a checkout, a shell, file
// editing, and Git. Those stages run here, inside an actual coding-agent CLI
// session that operates on the workspace.
//
// Configure with the repository variable CANON_CODING_AGENT:
//   copilot  — GitHub Copilot CLI     (uses the Actions GITHUB_TOKEN)
//   claude   — Claude Code            (needs ANTHROPIC_API_KEY)
//   codex    — OpenAI Codex CLI       (needs OPENAI_API_KEY)
//   command  — any other runner named by CANON_CODING_AGENT_COMMAND
//
// There is no inference fallback. If no coding agent is configured the stage
// fails loudly rather than pretending a chat reply implemented software.
//
// Authority is enforced here, not asked for in the prompt. The stage's tool
// policy (compiled from its Authority tab into graph.json) is translated into
// each vendor's real flags: no write tool when the stage may not change files,
// no shell tool when it may not run commands. `--allow-all-tools` is never used.

import fs from "node:fs";
import { spawn } from "node:child_process";

const AGENT = (process.env.CANON_CODING_AGENT || "copilot").trim();

/**
 * Vendor flag contracts, each verified against the CLI version the workflow pins.
 * `build` receives the prompt text, the compiled tool policy, and the stage model.
 */
const RUNNERS = {
  copilot: {
    bin: "copilot",
    install: "npm i -g @github/copilot@1.0.80",
    secret: "COPILOT_GITHUB_TOKEN",
    // Copilot CLI 1.0.80 sends `-p "@-"` to the model verbatim and never reads
    // stdin for it. The prompt therefore travels on stdin with no prompt flag.
    stdin: true,
    build(prompt, policy, model) {
      const args = [
        "--log-level",
        "error",
        "--secret-env-vars",
        "GITHUB_TOKEN,COPILOT_GITHUB_TOKEN,ANTHROPIC_API_KEY,OPENAI_API_KEY",
      ];
      if (model) args.push("--model", cliModel(model));
      if (policy.shell) args.push("--allow-tool", "shell");
      else args.push("--deny-tool", "shell");
      if (policy.write) args.push("--allow-tool", "write");
      else args.push("--deny-tool", "write");
      return args;
    },
  },
  claude: {
    bin: "claude",
    install: "npm i -g @anthropic-ai/claude-code@2.1.247",
    secret: "ANTHROPIC_API_KEY",
    // `claude -p` with no positional argument reads the prompt from stdin.
    stdin: true,
    build(prompt, policy, model) {
      const allowed = ["Read", "Glob", "Grep"];
      if (policy.write) allowed.push("Edit", "Write");
      if (policy.shell) allowed.push("Bash");
      // `plan` blocks Bash even when the stage is explicitly allowed to run tests.
      // `dontAsk` keeps the session non-interactive while the allow/deny lists
      // below remain the authority boundary.
      const args = ["-p", "--permission-mode", policy.write ? "acceptEdits" : "dontAsk"];
      if (model) args.push("--model", model);
      args.push("--allowedTools", allowed.join(","));
      const denied = [];
      if (!policy.write) denied.push("Edit", "Write");
      if (!policy.shell) denied.push("Bash");
      if (denied.length) args.push("--disallowedTools", denied.join(","));
      return args;
    },
  },
  codex: {
    bin: "codex",
    install: "npm i -g @openai/codex@0.150.1",
    secret: "OPENAI_API_KEY",
    // Codex 0.150.1 takes the prompt as a positional argument only.
    stdin: false,
    build(prompt, policy, model) {
      const args = ["exec", "--skip-git-repo-check"];
      args.push("--sandbox", policy.write || policy.shell ? "workspace-write" : "read-only");
      if (model) args.push("--model", model);
      args.push(prompt);
      return args;
    },
  },
};

/** The largest prompt an argv-only CLI can receive before the kernel returns E2BIG. */
export const ARGV_PROMPT_LIMIT = 100 * 1024;

/** Copilot CLI documents gemini-3.6-flash, not google/gemini-3.6-flash. */
function cliModel(model) {
  const raw = String(model ?? "").trim();
  if (!raw) return "";
  const slash = raw.lastIndexOf("/");
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}

/**
 * The model id to pass to a given vendor's CLI.
 *
 * The blueprint's stage model is a Copilot catalogue id. Claude Code and Codex
 * reject it, so those providers take `CANON_CODING_AGENT_MODEL` when the
 * repository sets one and otherwise run on their own default.
 */
export function modelForAgent(agent, stageModel, environment = process.env) {
  if (agent === "copilot") return cliModel(stageModel);
  const override = String(environment.CANON_CODING_AGENT_MODEL ?? "").trim();
  return override;
}

function dropUnusedProviderSecrets(keep) {
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "COPILOT_GITHUB_TOKEN", "GITHUB_TOKEN"]) {
    if (name !== keep) delete process.env[name];
  }
}

function run(command, args, { cwd = process.cwd(), input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let out = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      out += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      out += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) { resolve(out); return; }
      // The CLI's last lines are often the only diagnosis — a policy refusal
      // or an auth error exists nowhere else. Keep a short tail in the error
      // so a stage failure is readable from the run record, not just the log.
      const tail = out.trim().split("\n").slice(-6).join("\n").slice(-800).trim();
      reject(new Error(`${command} exited with code ${code}.${tail ? `\n${tail}` : ""}`));
    });
    child.stdin.end(input);
  });
}

/** Vendors that cannot express a path-level deny list on the command line. */
function pathGuardNote(policy) {
  if (!policy.denyPaths?.length) return "";
  return (
    `\n\n## Paths you may not write\n\n` +
    policy.denyPaths.map((p) => `- \`${p}\``).join("\n") +
    `\n\nCanon rejects the stage if any of these change.`
  );
}

/**
 * The exact argv and stdin one vendor CLI receives for a stage.
 *
 * Kept separate from process spawning so the contract is testable: an agent that
 * sends the prompt on stdin must never carry it (or a placeholder for it) in argv.
 */
export function buildAgentInvocation(agent, prompt, policy, stageModel, environment = process.env) {
  const runner = RUNNERS[agent];
  if (!runner) throw new Error(`Unknown coding agent "${agent}".`);
  const model = modelForAgent(agent, stageModel, environment);
  const args = runner.build(prompt, policy, model);
  if (runner.stdin) return { args, input: prompt };
  if (Buffer.byteLength(prompt, "utf8") > ARGV_PROMPT_LIMIT) {
    throw new Error(
      `The stage brief is ${Math.round(Buffer.byteLength(prompt, "utf8") / 1024)}KB, above the ` +
        `${ARGV_PROMPT_LIMIT / 1024}KB limit the ${runner.bin} CLI can accept as a command-line ` +
        `argument. Shorten the stage task, description, or upstream artifacts, or switch ` +
        `CANON_CODING_AGENT to an agent that reads the prompt on stdin (copilot, claude).`,
    );
  }
  return { args, input: "" };
}

/**
 * Execute one action stage with a coding agent that has real tools.
 * `promptFile` is a path on disk containing the full stage briefing.
 * `policy` is the stage's compiled tool policy; `model` its selected model.
 * Returns the agent's transcript.
 */
export async function invokeCodingAgent({ promptFile, policy = {}, model = "" }) {
  const resolved = {
    write: policy.write !== false,
    shell: policy.shell !== false,
    denyPaths: policy.denyPaths ?? [],
  };
  const prompt = fs.readFileSync(promptFile, "utf8") + pathGuardNote(resolved);

  if (AGENT === "command") {
    const command = process.env.CANON_CODING_AGENT_COMMAND;
    if (!command) {
      throw new Error(
        "CANON_CODING_AGENT=command requires the repository variable CANON_CODING_AGENT_COMMAND.",
      );
    }
    return run("bash", ["-lc", `${command} < ${JSON.stringify(promptFile)}`]);
  }

  const runner = RUNNERS[AGENT];
  if (!runner) {
    throw new Error(
      `Unknown CANON_CODING_AGENT "${AGENT}". Use copilot, claude, codex, or command.`,
    );
  }
  dropUnusedProviderSecrets(runner.secret);
  if (!process.env[runner.secret]) {
    throw new Error(
      `This is an action stage: it must edit the repository, so it runs in a coding agent, ` +
        `not a chat completion. ${runner.secret} is not set. Add it to repository secrets, ` +
        `or set CANON_CODING_AGENT to another supported agent.`,
    );
  }

  const { args, input } = buildAgentInvocation(AGENT, prompt, resolved, model);
  console.log(
    `Coding agent: ${runner.bin} (write=${resolved.write}, shell=${resolved.shell}, ` +
      `denied paths=${resolved.denyPaths.length})`,
  );
  try {
    return await run(runner.bin, args, { input });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        `The "${runner.bin}" coding agent is not installed on the runner. Install it in the ` +
          `workflow before the stage runs: ${runner.install}`,
      );
    }
    throw error;
  }
}

export function codingAgentName() {
  return AGENT;
}

export default invokeCodingAgent;
