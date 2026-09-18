// Canon orchestration engine.
//
import { createHash } from "node:crypto";

// Pure decision logic for a run: which stages are ready, how outcomes route to the
// next stages, how joins wait, how loops are capped. No I/O, no GitHub calls — every
// function takes the compiled graph (.canon/graph.json) and the run record and returns
// a new decision. This is the only file that decides what happens next.

/** Forward (non-loop) edges arriving at a stage. */
export function forwardInbound(graph, stageId) {
  return graph.edges.filter((e) => e.to === stageId && e.kind !== "return");
}

/** Edges leaving a stage, in blueprint order. */
export function outbound(graph, stageId) {
  return graph.edges.filter((e) => e.from === stageId);
}

export function stageById(graph, stageId) {
  return graph.stages.find((s) => s.id === stageId) ?? null;
}

/** How many inbound branches must arrive before a stage may start. */
export function requiredBranches(stage, inboundCount) {
  if (inboundCount <= 1) return inboundCount;
  const policy = stage.join ?? { mode: "all", threshold: 1 };
  if (policy.mode === "any") return 1;
  if (policy.mode === "n_of_m") {
    return Math.min(Math.max(1, policy.threshold ?? 1), inboundCount);
  }
  return inboundCount;
}

function now() {
  return new Date().toISOString();
}

/** Unguessable per-attempt token for a stage execution. */
function newTicket() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? {}).getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Tamper-evident chaining for the audit trail.
 *
 * Each timeline entry carries its sequence number, the digest of the entry before
 * it, and its own digest over that pair. The run record lives in an issue body,
 * which anyone with write access can edit; the chain means an edited, reordered, or
 * removed transition can be detected instead of silently believed. `tick` verifies
 * the chain before it acts on the record, so a broken trail stops the run.
 */
function digest(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

/** Stable serialization so the same entry always hashes the same way. */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function entryHash(entry, previousHash) {
  const { hash, ...rest } = entry;
  return digest(`${previousHash ?? ""}|${canonical(rest)}`);
}

export function appendTimeline(run, event, detail) {
  log(run, event, detail);
}

function log(run, event, detail) {
  const timeline = run.timeline ?? (run.timeline = []);
  const previous = timeline[timeline.length - 1] ?? null;
  const entry = {
    seq: (previous?.seq ?? 0) + 1,
    at: now(),
    event,
    ...detail,
    prev: previous?.hash ?? null,
  };
  entry.hash = entryHash(entry, previous?.hash ?? null);
  timeline.push(entry);
  run.updatedAt = now();
}

/**
 * Re-derive the whole chain. Returns the first entry that does not match, so the
 * run can name exactly where the trail was altered.
 */
export function verifyTimeline(run) {
  const timeline = run?.timeline ?? [];
  let previousHash = null;
  let expectedSeq = 1;
  let chainStarted = false;
  for (const entry of timeline) {
    // Records written before the chain existed carry no hash. Skip those, but
    // only ahead of the first hashed entry: once the chain starts every later
    // record must be hashed and linked, so hashes cannot be stripped from the
    // middle or the end to hide a change. This rejected them outright, which
    // reported every run created before hashing as tampered with.
    if (!entry.hash) {
      if (chainStarted) {
        return {
          ok: false,
          at: entry.seq ?? null,
          reason: "an unhashed timeline event follows a hashed one",
        };
      }
      expectedSeq = (entry.seq ?? expectedSeq) + 1;
      continue;
    }
    chainStarted = true;
    if (entry.seq !== expectedSeq && previousHash !== null) {
      return {
        ok: false,
        at: entry.seq ?? null,
        reason: "the transition sequence skips or repeats",
      };
    }
    if (previousHash !== null && entry.prev !== previousHash) {
      return {
        ok: false,
        at: entry.seq ?? null,
        reason: "an earlier transition was changed or removed",
      };
    }
    if (entryHash(entry, entry.prev ?? null) !== entry.hash) {
      return { ok: false, at: entry.seq ?? null, reason: "the transition record was edited" };
    }
    previousHash = entry.hash;
    expectedSeq = (entry.seq ?? expectedSeq) + 1;
  }
  return { ok: true, head: previousHash, entries: timeline.length };
}

/** The digest of the newest transition — the fingerprint of the whole trail. */
export function auditHead(run) {
  const timeline = run?.timeline ?? [];
  return timeline[timeline.length - 1]?.hash ?? null;
}

/** A fresh run record. Stored as JSON in the run issue body. */
export function createRun(graph, meta = {}) {
  const stages = {};
  for (const stage of graph.stages) {
    stages[stage.id] = {
      status: "pending",
      outcome: null,
      summary: "",
      artifact: null,
      iterations: 0,
      satisfiedBy: [],
      attempt: 0,
      ticket: null,
      // The candidate generation this stage last executed against. Anything
      // recorded in an earlier generation is stale evidence, not a result.
      generation: 0,
      evaluatedSha: null,
      approval: null,
      evidence: null,
      startedAt: null,
      finishedAt: null,
      deadline: null,
    };
  }
  const run = {
    schema: 1,
    runId: meta.runId ?? `run-${Date.now().toString(36)}`,
    graphVersion: graph.version ?? 1,
    status: "running",
    objective: meta.objective ?? "",
    trigger: meta.trigger ?? "manual",
    createdAt: now(),
    updatedAt: now(),
    cursor: 0,
    // Candidate generation. Advanced whenever the work under evaluation is
    // replaced — a return edge sending work back, or a stage publishing a new
    // commit. Every approval, review, evidence bundle and authorization is
    // stamped with the generation it was produced in, and nothing from an
    // earlier generation may satisfy a later one.
    generation: 1,
    // The trusted commit under evaluation. Set by the first stage that publishes
    // code and re-set by every later stage that changes it. Reviews, QA, and the
    // release stamp bind to this SHA, never to whatever GITHUB_SHA the workflow ran on.
    baseSha: meta.baseSha ?? "",
    candidateSha: meta.candidateSha ?? "",
    source: meta.source ?? null,
    stages,
    edgeCounts: {},
    // Evidence passed between stages, one entry per taken edge.
    handoffs: [],
    timeline: [],
  };
  const created = run;
  log(created, "run-created", { trigger: meta.trigger ?? "manual" });
  return created;
}

/** Stages whose gate is satisfied and which have not run yet. */
export function readyStages(graph, run) {
  if (run.status === "failed" || run.status === "completed") return [];
  const ready = [];
  for (const stage of graph.stages) {
    const state = run.stages[stage.id];
    if (!state || state.status !== "pending") continue;
    const inbound = forwardInbound(graph, stage.id);
    if (inbound.length === 0) {
      // Only the declared entry may start without an inbound branch.
      if (stage.id === graph.entry) ready.push(stage);
      continue;
    }
    const satisfied = new Set(state.satisfiedBy).size;
    if (satisfied < requiredBranches(stage, inbound.length)) continue;
    // Evidence-based handoff: never start a stage on superseded evidence.
    if (staleHandoffs(run, stage.id).length) continue;
    ready.push(stage);
  }
  return ready;
}

/** Mark a stage as picked up by a worker (AI) or waiting on a person (human). */
export function startStage(run, stageId, mode) {
  const state = run.stages[stageId];
  if (!state) return run;
  state.status = mode === "human" ? "awaiting" : "running";
  state.startedAt = now();
  // Single-use execution ticket. A machine result is only accepted when it quotes
  // the ticket and attempt issued here, so a pasted comment cannot drive the run.
  state.attempt = (state.attempt ?? 0) + 1;
  state.ticket = mode === "human" ? null : newTicket();
  // Bind the attempt to the candidate generation it was dispatched in. A result
  // that arrives after the candidate was replaced is answering a question the
  // run no longer asks.
  state.generation = run.generation ?? 1;
  if (mode === "human") run.status = "awaiting_human";
  log(run, mode === "human" ? "stage-awaiting-human" : "stage-started", {
    stage: stageId,
    generation: state.generation,
  });
  return run;
}

/** Does this edge carry the stage's result forward? */
export function edgeMatches(edge, result) {
  const condition = edge.condition ?? { type: "always" };
  if (condition.type === "always") return true;
  if (condition.type === "outcome") return condition.outcome === result.outcome;
  if (condition.type === "expression") {
    const routes = (result.route ?? []).map((r) => String(r).toLowerCase());
    if (routes.includes(edge.id.toLowerCase())) return true;
    if (routes.includes(String(edge.to).toLowerCase())) return true;
    const expression = String(condition.expression ?? "")
      .trim()
      .toLowerCase();
    return Boolean(expression) && routes.some((r) => expression.includes(r));
  }
  return false;
}

/**
 * Advance the candidate generation.
 *
 * The generation is the run's answer to "is this evidence still about the work we
 * are looking at?". It moves whenever the work under evaluation is replaced, and
 * everything stamped with an older generation stops counting from that moment.
 */
export function advanceGeneration(run, reason, detail = {}) {
  run.generation = (run.generation ?? 1) + 1;
  log(run, "generation-advanced", { generation: run.generation, reason, ...detail });
  return run.generation;
}

/**
 * Reset a stage and everything downstream of it so a loop can run again.
 *
 * Resetting the stages is not enough. The evidence that fed them — handoffs,
 * artifacts, evaluated commits, approvals, evidence bundles — was produced for the
 * previous candidate generation, and leaving it in place both blocks the stage
 * from restarting (its inbound handoff still names the old commit) and lets a
 * superseded approval survive into the new generation. Everything bound to the
 * reset subgraph is dropped along with the stages.
 */
function resetForward(graph, run, startId) {
  const seen = new Set();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const state = run.stages[id];
    if (state) {
      state.status = "pending";
      state.outcome = null;
      state.summary = "";
      state.satisfiedBy = [];
      state.startedAt = null;
      state.finishedAt = null;
      state.deadline = null;
      // In-flight work from the previous generation can no longer report in.
      state.ticket = null;
      // Prior-generation evidence and authority never carry forward.
      state.artifact = null;
      state.evaluatedSha = null;
      state.approval = null;
      state.evidence = null;
    }
    for (const edge of outbound(graph, id)) {
      if (edge.kind === "return") continue;
      queue.push(edge.to);
    }
  }
  // Drop every handoff feeding the reset subgraph. The edge that caused the reset
  // records its own fresh handoff immediately after this returns, and upstream
  // stages re-record theirs when they run again.
  run.handoffs = (run.handoffs ?? []).filter((h) => !seen.has(h.to));
  advanceGeneration(run, "rework", { from: startId, stages: [...seen] });
  return seen;
}

/**
 * The evidence a downstream stage receives when an edge is taken.
 *
 * A handoff is not "stage A finished" — it is "stage A produced this artifact,
 * with this outcome, against this exact commit, in this generation". The
 * downstream stage inherits both, and if the candidate commit moves or the
 * generation advances before that stage runs, the handoff is stale and the stage
 * is held rather than working from superseded evidence.
 */
function recordHandoff(run, edge, state, stage) {
  const handoffs = run.handoffs ?? (run.handoffs = []);
  const existing = handoffs.findIndex((h) => h.edge === edge.id);
  const bindsCandidate = Boolean(
    stage?.attestsCandidate || state.evaluatedSha || state.candidateSha,
  );
  const record = {
    edge: edge.id,
    from: edge.from,
    to: edge.to,
    at: now(),
    generation: run.generation ?? 1,
    outcome: state.outcome ?? null,
    summary: state.summary ?? "",
    artifact: state.artifact ?? null,
    sha: state.evaluatedSha ?? run.candidateSha ?? null,
    bindsCandidate,
  };
  if (existing === -1) handoffs.push(record);
  else handoffs[existing] = record;
  log(run, "handoff", {
    stage: edge.from,
    to: edge.to,
    edge: edge.id,
    sha: record.sha,
    generation: record.generation,
  });
}

/** Handoffs feeding a stage. */
export function handoffsFor(run, stageId) {
  return (run.handoffs ?? []).filter((h) => h.to === stageId);
}

/**
 * Handoffs whose commit is no longer the run's candidate. Their downstream stage
 * would be judging code that has already been replaced.
 */
export function staleHandoffs(run, stageId = null) {
  const candidate = String(run.candidateSha ?? "").trim();
  if (!candidate) return [];
  return (run.handoffs ?? []).filter((h) => {
    if (stageId !== null && h.to !== stageId) return false;
    if (!h.sha || h.sha === candidate) return false;
    // Planning artifacts are not code evidence. Only handoffs that bind a
    // candidate SHA go stale when the candidate moves.
    if (h.bindsCandidate === false) return false;
    return h.bindsCandidate === true || Boolean(h.sha);
  });
}

/**
 * Completed attestations that no longer describe the current candidate.
 *
 * A stage that attests to code (review, QA, security, release review, human
 * approval of code) makes a claim about one commit in one generation. When either
 * moves, the claim is stale: it may not authorize a merge or a release, and the
 * stage has to run again.
 */
export function staleAttestations(graph, run) {
  const candidate = String(run.candidateSha ?? "").trim();
  const generation = run.generation ?? 1;
  const attesting = new Set(
    (graph?.stages ?? []).filter((s) => s.attestsCandidate).map((s) => s.id),
  );
  const stale = [];
  for (const [id, state] of Object.entries(run.stages ?? {})) {
    if (!attesting.has(id) || state?.status !== "done") continue;
    if (candidate && state.evaluatedSha && state.evaluatedSha !== candidate) {
      stale.push({ stage: id, reason: "evaluated a different commit", sha: state.evaluatedSha });
      continue;
    }
    if (state.generation && state.generation !== generation) {
      stale.push({
        stage: id,
        reason: "attested in an earlier generation",
        generation: state.generation,
      });
    }
  }
  return stale;
}

function satisfy(run, edge) {
  const state = run.stages[edge.to];
  if (!state) return;
  if (!state.satisfiedBy.includes(edge.id)) state.satisfiedBy.push(edge.id);
}

/**
 * Record a finished stage and route its result.
 * `result` is { outcome, summary, artifact, route? }.
 */
export function recordOutcome(graph, run, stageId, result) {
  const stage = stageById(graph, stageId);
  const state = run.stages[stageId];
  if (!stage || !state) {
    return { taken: [], error: `Unknown stage "${stageId}".` };
  }

  // Status vs outcome: `status: "failed"` means infrastructure/execution failure
  // and kills the run. `outcome: "failed"` is a normal domain result (e.g. QA
  // rejected the work) and must route through the graph like any other outcome.
  if (result.status === "failed") {
    state.status = "failed";
    state.ticket = null;
    state.summary = result.summary ?? "";
    state.finishedAt = now();
    run.status = "failed";
    log(run, "stage-failed", { stage: stageId, detail: result.summary ?? "" });
    return { taken: [], failed: true };
  }

  // Bind the result to the generation it was dispatched in. If the candidate was
  // sent back for rework while this stage was executing, its verdict answers a
  // question the run has already moved past.
  const resultGeneration = Number(result.generation ?? 0);
  const stageGeneration = Number(state.generation ?? 0);
  if (resultGeneration && stageGeneration && resultGeneration !== stageGeneration) {
    log(run, "stale-generation", {
      stage: stageId,
      reported: resultGeneration,
      expected: stageGeneration,
    });
    return {
      taken: [],
      staleGeneration: true,
      error: `Result was produced for generation ${resultGeneration}; the stage is now on generation ${stageGeneration}.`,
    };
  }

  // Bind the result to the commit it evaluated. A review or QA verdict that did
  // not look at the current candidate cannot count towards releasing it.
  const evaluated = String(result.evaluatedSha ?? "").trim();
  const candidate = String(run.candidateSha ?? "").trim();
  if (candidate && evaluated && evaluated !== candidate) {
    state.status = "failed";
    state.summary = `Evaluated ${evaluated.slice(0, 12)}, but the candidate is ${candidate.slice(0, 12)}.`;
    state.finishedAt = now();
    run.status = "failed";
    log(run, "stale-evaluation", { stage: stageId, evaluated, candidate });
    return { taken: [], failed: true, staleSha: true };
  }

  state.status = "done";
  state.ticket = null;
  state.outcome = result.outcome ?? "approved";
  state.evaluatedSha = evaluated || candidate || null;

  // A stage that produced a new commit moves the candidate forward. Every approval
  // recorded before this point applied to the previous commit, so the generation
  // advances with it and those attestations stop counting.
  const produced = String(result.candidateSha ?? "").trim();
  if (produced && produced !== candidate) {
    if (!run.baseSha) run.baseSha = candidate || produced;
    run.candidateSha = produced;
    state.evaluatedSha = produced;
    log(run, "candidate-advanced", { stage: stageId, sha: produced, previous: candidate || null });
    advanceGeneration(run, "candidate-advanced", { stage: stageId, sha: produced });
    state.generation = run.generation;
  }

  state.summary = result.summary ?? "";
  state.artifact = result.artifact ?? null;
  state.iterations += 1;
  state.finishedAt = now();
  log(run, "stage-completed", { stage: stageId, outcome: state.outcome });

  const taken = [];
  for (const edge of outbound(graph, stageId)) {
    if (!edgeMatches(edge, { ...result, outcome: state.outcome })) continue;
    if (edge.kind === "return") {
      // Snapshot the rejecting stage before resetForward clears it. The fresh
      // handoff must carry the review/test findings that caused the loop.
      const returnEvidence = {
        outcome: state.outcome,
        summary: state.summary,
        artifact: state.artifact,
        evaluatedSha: state.evaluatedSha,
        candidateSha: state.candidateSha,
      };
      const count = (run.edgeCounts[edge.id] ?? 0) + 1;
      run.edgeCounts[edge.id] = count;
      const limit = edge.loopLimit ?? graph.defaultLoopLimit ?? 3;
      if (count > limit) {
        run.status = "failed";
        log(run, "loop-limit-exceeded", { stage: stageId, edge: edge.id, limit });
        return { taken, failed: true, loopLimit: edge.id };
      }
      resetForward(graph, run, edge.to);
      log(run, "loop-back", { stage: stageId, edge: edge.id, iteration: count });
      satisfy(run, edge);
      recordHandoff(run, edge, returnEvidence, stage);
      taken.push(edge.id);
      continue;
    }
    satisfy(run, edge);
    recordHandoff(run, edge, state, stage);
    taken.push(edge.id);
  }

  if (taken.length === 0) {
    log(run, "branch-end", { stage: stageId, outcome: state.outcome });
  }

  finalize(graph, run);
  return { taken, next: readyStages(graph, run).map((s) => s.id) };
}

/** True when nothing is running, waiting, or ready. */
export function isSettled(graph, run) {
  if (run.status === "failed" || run.status === "completed") return true;
  const busy = Object.values(run.stages).some(
    (s) => s.status === "running" || s.status === "awaiting" || s.status === "blocked",
  );
  return !busy && readyStages(graph, run).length === 0;
}

/** Close the run out when there is no work left. */
export function finalize(graph, run) {
  if (run.status === "failed" || run.status === "completed") return run;
  if (!isSettled(graph, run)) {
    const waiting = Object.values(run.stages).some(
      (s) => s.status === "awaiting" || s.status === "blocked",
    );
    run.status = waiting ? "awaiting_human" : "running";
    return run;
  }
  const reachedExit = (graph.exits ?? []).some((id) => run.stages[id]?.status === "done");
  run.status = reachedExit || (graph.exits ?? []).length === 0 ? "completed" : "stalled";
  log(run, run.status === "completed" ? "run-completed" : "run-stalled", {});
  return run;
}

/**
 * Stages dispatched in this cycle that never published a trusted result. The worker
 * job crashed, timed out, was cancelled, or its artifact never landed. Silence is an
 * infrastructure failure, never a completed stage.
 */
export function failUnreportedStages(run) {
  const failed = [];
  for (const [id, state] of Object.entries(run.stages ?? {})) {
    if (state.status !== "running") continue;
    state.status = "failed";
    state.ticket = null;
    state.summary = "The stage job ended without publishing a trusted result.";
    state.finishedAt = now();
    run.status = "failed";
    log(run, "stage-no-result", { stage: id, detail: state.summary });
    failed.push(id);
  }
  return failed;
}

/**
 * Stages that are ready at the same moment and hold the same lock.
 *
 * Locks are compiled from declared resource ownership. Two stages holding one lock
 * cannot both write it safely, so the run does not guess: it starts one, holds the
 * other, and asks a person to decide who owns the resource.
 */
export function lockConflicts(ready) {
  const conflicts = [];
  for (let i = 0; i < ready.length; i += 1) {
    for (let j = i + 1; j < ready.length; j += 1) {
      const a = ready[i];
      const b = ready[j];
      const shared = (a.locks ?? []).filter((key) => (b.locks ?? []).includes(key));
      for (const key of shared) {
        conflicts.push({ lock: key, proceeding: a, held: b });
      }
    }
  }
  return conflicts;
}

/** Record that a stage was held back because a person must resolve a conflict. */
export function holdStage(run, stageId, lock, issueNumber) {
  const state = run.stages?.[stageId];
  if (!state) return run;
  state.status = "blocked";
  state.blockedBy = { lock, issue: issueNumber ?? null, at: now() };
  run.status = "awaiting_human";
  log(run, "resource-conflict", { stage: stageId, lock, issue: issueNumber ?? null });
  return run;
}

/** Release a held stage once the conflict issue is resolved. */
export function releaseStage(run, stageId) {
  const state = run.stages?.[stageId];
  if (!state || state.status !== "blocked") return run;
  state.status = "pending";
  state.blockedBy = null;
  log(run, "resource-conflict-cleared", { stage: stageId });
  return run;
}

/** Human decisions allowed at a stage, used to validate slash commands. */
export function allowedDecisions(stage) {
  const declared = stage.decisions ?? [];
  if (declared.length) return declared;
  const fromEdges = (stage.outcomes ?? []).filter(Boolean);
  return fromEdges.length ? fromEdges : ["approved", "changes_required", "rejected"];
}

export default {
  createRun,
  readyStages,
  startStage,
  recordOutcome,
  finalize,
  failUnreportedStages,
  isSettled,
  edgeMatches,
  requiredBranches,
  forwardInbound,
  outbound,
  stageById,
  allowedDecisions,
  verifyTimeline,
  appendTimeline,
  auditHead,
  handoffsFor,
  staleHandoffs,
  lockConflicts,
  holdStage,
  releaseStage,
};
