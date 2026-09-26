// Provider-agnostic analysis invocation.
//
// GitHub Models was retired on 2026-07-30. There is no default inference
// provider and no silent model substitution. Set CANON_AGENT_PROVIDER to
// anthropic, openai, or command. Analysis stages that need the repo use the
// coding agent with a read-only tool policy instead of this module.

import { spawn } from "node:child_process";

const PROVIDER = (process.env.CANON_AGENT_PROVIDER || "").trim();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to repository secrets, or change CANON_AGENT_PROVIDER.`,
    );
  }
  return value;
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Agent provider error ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function runCommand(command, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`Agent command exited with code ${code}.`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Run one agent turn and return its raw text response. */
export async function invokeAgent({ system, prompt, model }) {
  if (!PROVIDER || PROVIDER === "github-models") {
    throw new Error(
      "CANON_AGENT_PROVIDER cannot be github-models. GitHub Models was retired. Set anthropic, openai, or command, or run the stage as a read-only coding agent.",
    );
  }

  if (PROVIDER === "command") {
    const command = requireEnv("CANON_AGENT_COMMAND");
    return runCommand(command, `${system}\n\n---\n\n${prompt}`);
  }

  if (PROVIDER === "anthropic") {
    const data = await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": requireEnv("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      {
        model: model || "claude-sonnet-4-5",
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: prompt }],
      },
    );
    return (data.content ?? []).map((part) => part.text ?? "").join("\n");
  }

  if (PROVIDER === "openai") {
    const data = await postJson(
      "https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
      {
        model: model || "gpt-5",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      },
    );
    return data.choices?.[0]?.message?.content ?? "";
  }

  throw new Error(`Unknown CANON_AGENT_PROVIDER "${PROVIDER}". Use anthropic, openai, or command.`);
}

export default invokeAgent;
