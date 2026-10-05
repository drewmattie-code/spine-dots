# SPINE-dots — Hardened Product Spec

Oct 5, 2026 · @Drew Mattie

## Summary

SPINE-dots v1.0 should be an **enforcing** policy decision and enforcement point for agent tool calls: nothing an agent does reaches data or the outside world except through it, and every claim on the README is backed by a test. v0.1 proves the idea in about 700 lines; this spec turns it into a product a security architect would sign off on.

**Who it's for.** Platform and security teams running always-on agents (OpenDots first, then any MCP-speaking runtime) who must answer three questions for every action: should it run, what data did it see, and who is accountable.

**Thesis.** A runtime answers *can my agent do this?* Governance answers *should it, this time, and can we prove what happened?* SPINE-dots owns the second half and stays runtime-neutral.

**What world class means here:**

- **Enforces, not reports.** Redaction, scoping and blocking change what actually executes.
- **Fails closed.** Any error, timeout or unknown input produces BLOCK, never ALLOW.
- **Untrusted agent.** Nothing the agent writes (task text, recipient, args) is taken at its word.
- **Provable.** The audit trail is signed, anchored and verifiable by a third party.
- **Every claim tested.** Each public claim maps to an acceptance test and a red-team case.
- **Fast enough to sit inline.** p99 under 25 ms for a policy-only decision.

## Claims audit

Of the 14 claims in the README and adapter docs, 3 hold today, 6 hold only partly or only in the demo, and 5 are false or untested. The table names each claim, what v0.1 actually does (verified by reading the code and running probes on 2026-10-05), and the requirement that makes it true. IDs (C1…C14) are referenced by the acceptance tests in Verification.

| ID | Claim (README / adapter) | v0.1 reality | Status | Requirement to make it true |
| --- | --- | --- | --- | --- |
| C1 | Every Dot action is registered before it executes | ARS blocks unregistered or unapproved Dots | Holds | Add version pinning: action must name the exact registered version and config hash |
| C2 | Risk-scored | CRI scores 0–100 with factors | Holds | Version the model; put weights in policy; record model version in each audit entry |
| C3 | Adversarially checked | Rule checker only; LLM checker is a hook | Demo only | Ship a reference checker Dot plus a contract test; checker must have no shared context, a different model or prompt, and a timeout that fails closed |
| C4 | Data-scoped; salary/SSN redacted (GDS) | Redactions are computed and reported, but the tool receives the original args | False | GDS mediates the data: tools get a scoped handle or filtered payload, never raw datasets. Redaction is enforced in the data path |
| C5 | Policy-gated: restricted data cannot leave the org | `isExternal` is a regex on email text; `x@corp.evil.com` and any webhook URL count as internal, so payroll to an outside webhook drops to NEEDS\_APPROVAL | False | Egress classification from an org-owned allowlist of domains, URLs and integrations; default = external |
| C6 | Tamper-evident log no one can quietly edit | Hash chain detects partial edits; anyone with write access can rewrite the whole chain; write errors are swallowed | Partly | Signed entries, periodic external anchoring, append-only storage, and fail-closed on log write failure |
| C7 | PDS is "the only door" to tools | Door is opened by keyword match on agent-written task text ("report" unlocks send\_email) | False | Tool grants come from the registered task type and the operator, never from free text the agent writes |
| C8 | Spine Gate: riskier tier, higher bar | Least-privilege check at production always passes | Partly | Per-tier conformance suite that actually runs: eval pass rate, red-team pass, named high-privilege grants with approver and expiry |
| C9 | Policy is data (JSON), not code | Rules are JavaScript functions | False | Declarative policy language with schema, versioning and tests (see Policy engine) |
| C10 | One middleware hook; nothing else changes | True for the decision, but enforcing C4 needs a data-read hook too | Partly | Two hooks, documented: tool dispatch and data access |
| C11 | `import { handle } from 'spine-dots'` | No `main`/`exports` in package.json; not on npm | False | Publish to npm with typed exports, provenance and SBOM |
| C12 | Zero runtime dependencies, Node ≥ 20, self-hosted | True | Holds | Keep core dependency-free; put signing, Postgres and OTel in optional packages |
| C13 | Vanilla OpenDots would email SSNs after one blind click | Scripted narration, not a real OpenDots run | Demo only | Demo runs against a real OpenDots instance, both paths, recorded |
| C14 | Swap store.js for Postgres; nothing else changes | Interface exists; no concurrency control; log id derived from array length | Demo only | Transactional store interface with ordering guarantees; reference Postgres adapter with tests |

Rule from here on: a claim may appear in the README only if its acceptance test is green in CI.

## Threat model and design principles

The agent being governed is treated as a potentially compromised principal: prompt injection, a bad model update or a malicious tool result can make it lie about its task, its recipient and its arguments. SPINE-dots must hold under that assumption.

**Adversaries in scope**

| Adversary | Goal | Primary control |
| --- | --- | --- |
| Injected or misaligned agent | Exfiltrate data, move money, escalate privilege | PDS grants not derived from agent text; GDS data mediation; egress allowlist |
| Malicious tool output or web content | Steer the agent into a harmful next call | ESF provenance on every external input; trust level feeds CRI and policy |
| Insider with operator access | Approve harmful actions, then erase the trail | Two-person rule for high-risk approvals; signed, anchored log |
| Compromised SPINE host | Forge ALLOW decisions or rewrite history | Signing keys in a KMS/HSM; decision receipts verifiable by the runtime |
| Lookalike recipients | Pass an outside party off as internal | Canonicalized domain and URL matching against an org allowlist |

**Out of scope for v1.0:** a compromised OpenDots runtime that skips the hook entirely (mitigated by network egress controls, documented as a deployment requirement), and model-weight attacks.

**Design principles**

1. **Fail closed.** Errors, timeouts, unknown tools, unknown datasets and unknown recipients resolve to BLOCK.
2. **Enforce in the data path.** If SPINE says a field is redacted, the tool never receives it.
3. **Never trust agent-supplied classification.** Task type, recipient class and data sensitivity come from the registry, catalog and allowlists.
4. **Deny by default, grant by name.** Every high-privilege capability is an explicit grant with an approver and an expiry.
5. **Explain every decision.** Each result carries the rule IDs and factors that produced it.
6. **Verifiable by outsiders.** An auditor with a public key can verify the log without trusting SPINE's operators.
7. **Runtime-neutral core.** OpenDots is the first adapter, not a dependency.

## Gateway and enforcement contract

The gateway returns a signed decision for every tool call, and the runtime may execute only with a valid receipt and the data handle SPINE issues. That is what turns v0.1's advisory decision into enforcement.

&#91;embedded content: gateway decision path · 6 checks, 3 outcomes, fail closed throughout\]

Each check can end the call early as BLOCK; only a call that clears all six and passes policy reaches ALLOW or NEEDS APPROVAL, and the audit entry is written before either is returned.

**Request** (`POST /v1/decide`): `dotId`, `dotVersion`, `configHash`, `taskType`, `tool`, `args`, `datasets`, `inputRefs` (ESF provenance of any external data used to build the args), `idempotencyKey`.

**Response:** `decision`, `ruleIds[]`, `risk` (score, band, factors, model version), `objections[]`, `redactions[]`, `dataHandle` (ALLOW only), `approvalId` (NEEDS\_APPROVAL only), `auditId`, `receipt` (signed over decision, args hash and expiry).

**Enforcement rules**

- Tool adapters verify the receipt signature, that the args hash matches what was decided, and that the receipt hasn't expired (default 60 s) before running.
- Data reaches tools only through `dataHandle`, which returns fields within clearance; raw dataset access from tool code is not permitted.
- An approval binds to the args hash: changing any argument after approval requires a new decision.
- The same `idempotencyKey` returns the same decision; replaying a used receipt is rejected.
- Unknown fields in the request are rejected, not ignored.

## Layer-by-layer requirements

Each layer keeps its plain-English job from the README; what changes is that each one gets a testable contract. MUST items gate v1.0; SHOULD items can ship in v1.x.

### ARS — Agent Registry Spine

- MUST register each Dot as an immutable version: model, system prompt hash, tool grants, clearance, egress scope, owner.
- MUST reject actions that don't name a registered version, or whose config hash doesn't match.
- MUST require a named approver for every approval and every grant change, logged in AGS.
- MUST support suspend and revoke that take effect on the next call (kill switch), target under 1 second.
- SHOULD support grant expiry and periodic recertification by the owner.

### PDS — Progressive Discovery Spine

- MUST derive available tools from the registered **task type** (an enum set by the operator or the triggering workflow), not from free-text task descriptions.
- MUST treat free text only as an input to CRI and ACS, never as a grant.
- MUST bind each tool grant to argument constraints (for example, `send_email.to` must match the egress allowlist; `transfer_funds.amount` ≤ limit).
- MUST return only granted tools to the runtime, so ungranted tools are never shown to the model.
- SHOULD support just-in-time grants: one-time elevation approved by a human, scoped to one call.

### GDS — Grounded Data Spine

- MUST mediate every data read: tools receive a scoped handle or a filtered payload, so redacted fields never reach the tool or the model.
- MUST classify fields from a catalog (manual tags plus optional detectors for SSN, card numbers, emails), with unknown fields defaulting to the dataset's highest class.
- MUST scan outbound payloads for classified values (DLP on egress), so data copied into a free-text email body is still caught.
- MUST version the canonical definitions and record the version used in each decision.
- SHOULD support row-level scopes (for example, a regional Dot sees only its region's rows).

### CRI — Composite Risk Index

- MUST keep the explainable factor breakdown and add: recipient trust class, amount for money tools, record count, ESF trust of inputs, time of day and anomaly versus the Dot's baseline.
- MUST version the scoring model and store weights in policy, not code.
- MUST be calibrated: publish the score distribution on the benchmark suite and the false-allow and false-block rates per band.
- SHOULD learn per-Dot baselines (normal tools, volumes, recipients) and score deviation.

### ACS — Adversarial Coordination Spine

- MUST ship a reference checker Dot: separate process, no shared context with the maker, adversarial prompt, structured verdict schema.
- MUST fail closed: checker timeout or malformed verdict counts as a blocking objection.
- MUST log the checker's identity, model and prompt version with each verdict.
- MUST allow policy to require a checker on a different model provider for critical actions.
- SHOULD measure checker quality on the red-team suite (catch rate, false-objection rate).

### AGS — Agent Governance Spine

- MUST evaluate the declarative policy (see Policy engine) and return rule IDs with every decision.
- MUST write the audit entry **before** returning ALLOW; if the write fails, the decision becomes BLOCK.
- MUST enforce human-approval workflows: approver identity, two-person rule above a configurable band, approval expiry, and the exact payload approved (approval is bound to a hash of the args).
- MUST sign entries and anchor the chain externally (see Audit and evidence).

### ESF — External Signal Fabric

- MUST stamp every external input (web, tool output, inbound email) with source, fetch time, hash and trust level, and carry it with the data into later calls.
- MUST let policy forbid high-risk actions whose arguments derive from untrusted inputs (taint tracking at the field level).
- SHOULD maintain a source reputation list the operator can tune.

### DCS — Durable Context Spine

- MUST record handovers as structured, signed records: open items, done items, decisions, pending approvals.
- MUST link each handover to the audit entries it summarizes.
- SHOULD flag memory that contains classified data so it is scoped by GDS on the next shift.

### Spine Gate

- MUST run a per-tier conformance suite: eval pass rate on the Dot's task set, red-team pass rate, clean DCS, named owner, named high-privilege grants with approver and expiry.
- MUST block promotion if any check fails, naming the failing check (keep the v0.1 behaviour).
- MUST demote automatically on revocation, failed recertification or a breach of the anomaly threshold.
- SHOULD support canary promotion: a share of traffic at the new tier for a set period before full promotion.

## Policy engine

Policy becomes versioned data that security teams can read, diff, test and roll back without touching code, which makes claim C9 true.

**Language.** A JSON/YAML rule format with a published JSON Schema. Each rule has an `id`, a `when` expression over a fixed, typed context (dot, tool, task type, recipient class, data classes, risk band, ESF trust, ACS verdict, time), an effect (`allow`, `require_approval`, `block`), and a human-readable reason. Expressions use a small, side-effect-free grammar (CEL-style) evaluated by a sandboxed interpreter. Adapters to OPA/Rego or Cedar are a v1.x option for teams that already run them.

**Semantics.**

- Deny-overrides: any `block` wins; then `require_approval`; `allow` only if a rule explicitly allows and none escalates.
- No matching allow rule means BLOCK (default deny), replacing v0.1's default ALLOW.
- Every decision returns the full list of matched rule IDs.

**Lifecycle.**

1. Policy lives in a Git repo; every change is a reviewed pull request.
2. CI runs the policy's own test cases (given context, expect decision) plus the shared red-team suite.
3. New policy deploys in **shadow mode** first: it evaluates alongside the live policy and logs disagreements without affecting decisions.
4. Promotion to live records the policy version hash; every audit entry stores the version that decided it.
5. Rollback is one command to a previous version hash.

**Starter packs.** Ship opinionated defaults operators can adopt and tune: *Finance* (money and payroll), *Customer data* (PII and support), *Engineering* (code, infra, secrets), each mapped to the compliance controls in Audit and evidence.

**Dry-run API.** `POST /v1/decide?dryRun=true` returns the decision and matched rules without logging or executing, for testing and for showing users why an action would be blocked.

## Audit and evidence

The log must let an outside auditor prove, without trusting SPINE's operators, that no entry was added, removed or changed after the fact. Hash chaining alone doesn't do that; signing plus external anchoring does.

**Integrity**

- Each entry is signed (Ed25519) with a key held in a KMS or HSM; SPINE hosts never see the raw key.
- Entries are batched into a Merkle tree; the root is anchored at a fixed interval (default 5 minutes) to at least one external witness: an RFC 3161 timestamp authority, a transparency log, or a customer-owned write-once bucket.
- Storage is append-only at the database level (no UPDATE or DELETE grants), with object-lock or WORM storage for archives.
- A standalone verifier CLI checks signatures, chain and anchors from an export plus a public key.
- Entry IDs come from the store's sequence, not array length, so concurrent writers can't collide.

**Content of each entry**

Decision, matched rule IDs, policy version, CRI model version and factors, ACS verdict and checker identity, GDS redactions, ESF provenance of inputs, approver identity and the hash of the exact payload approved, Dot version and config hash, latency, and a decision receipt the runtime can verify.

**Privacy of the log itself.** The log stores hashes and field names of classified data, never the values. Retention is configurable per data class; deletion requests are handled by crypto-shredding per-subject keys, so the chain stays verifiable.

**Export and integration**

- OpenTelemetry spans for every decision.
- Streaming export to SIEMs (Splunk, Sentinel, Datadog) and to Parquet for analytics.
- Evidence bundles per period: entries, anchors, policy versions and verifier output in one signed archive.

**Compliance mapping.** Publish a control matrix showing which SPINE features provide evidence for: NIST AI RMF (Govern, Map, Measure, Manage), ISO/IEC 42001, EU AI Act record-keeping and human-oversight duties for high-risk systems, SOC 2 (CC6 logical access, CC7 monitoring), and the OWASP Top 10 for LLM applications (prompt injection, excessive agency, sensitive information disclosure). The matrix claims evidence support, not certification.

## Integrations and packaging

OpenDots is the launch adapter; MCP is the multiplier, because one MCP gateway puts SPINE in front of any runtime that speaks it.

| Surface | v1.0 scope | Notes |
| --- | --- | --- |
| OpenDots adapter | Tool-dispatch hook, data-access hook, enriched approval card component, checker-Dot client | Tested against a pinned OpenDots release in CI; compatibility table in README |
| MCP gateway | SPINE runs as an MCP proxy: agents connect to it, it forwards approved calls to real MCP servers | Covers Claude, OpenAI Agents SDK, LangGraph and others without per-runtime code |
| SDKs | TypeScript (core), Python client | Python calls the decision service over HTTP |
| Decision service | HTTP and gRPC: `/v1/decide`, `/v1/approve`, `/v1/registry`, `/v1/audit/verify` | Stateless; scales horizontally |
| Approval UI | Web console: approval queue, decision explorer, policy diff, Gate status | Approvals also via Slack and email with signed links |
| Storage | In-memory (dev), SQLite (single node), Postgres (production) | Same transactional interface; migrations versioned |
| Identity | OIDC/SAML for operators; SCIM for approver groups | Approver identity goes into every audit entry |

**Packaging**

- npm packages: `@spine-dots/core` (zero dependencies, the decision engine), `@spine-dots/server`, `@spine-dots/opendots`, `@spine-dots/mcp`, `@spine-dots/store-postgres`, with typed `exports` (fixes C11).
- Container image and Helm chart for self-hosting; air-gapped install supported.
- Every release signed, with npm provenance, an SBOM (CycloneDX) and a changelog.
- Semantic versioning; the decision API and policy schema are stable from v1.0.

## Non-functional requirements

SPINE sits inline on every tool call, so its latency and availability become the agent's. Targets below are proposals to validate in the benchmark suite.

| Area | Target |
| --- | --- |
| Decision latency, policy only (no ACS) | p50 < 5 ms, p99 < 25 ms on one vCPU |
| Decision latency with LLM checker | Bounded by a per-policy timeout (default 8 s); timeout = blocking objection |
| Throughput | ≥ 1,000 decisions/s per node, linear horizontal scaling |
| Availability | 99.95% for the decision service in the reference HA deployment |
| Behaviour when SPINE is down | Runtime adapter fails closed; a cached read-only policy may allow READ-class tools only if the operator opts in |
| Audit durability | No acknowledged decision without a durable log write; RPO = 0 for the log |
| Kill switch | Suspend or revoke a Dot effective in < 1 s across nodes |
| Policy reload | New policy version live in < 10 s without restart |

**Security of SPINE itself**

- Threat-model review and an external penetration test before v1.0.
- mTLS between runtime adapters and the decision service; decision receipts signed so a runtime can reject forged ALLOWs.
- Least-privilege service accounts; secrets only from a secret manager.
- Dependency and container scanning in CI; reproducible builds.
- Security policy, private disclosure address and a fix-time commitment (critical within 7 days) published in SECURITY.md.

## Verification

v1.0 ships when every claim in the audit has a green acceptance test, the red-team suite passes at the stated rate, and the benchmarks meet the non-functional targets in CI.

**Acceptance tests (one or more per claim)**

| Claim | Test that must pass |
| --- | --- |
| C4 | With salary/SSN redacted, the tool receives a payload containing neither field, checked by the test harness's fake tool |
| C4 | Salary values pasted into a free-text email body are caught by egress DLP and blocked |
| C5 | Recipients `a@corp.evil.com`, `x@acme.io.attacker.net`, an unlisted webhook URL and a Unicode lookalike domain are all classified external |
| C5 | Restricted data to any external recipient is BLOCK, never NEEDS\_APPROVAL |
| C6 | Editing, deleting, inserting or reordering any entry, or rewriting the whole chain, fails the verifier against the anchors |
| C6 | A failed log write turns ALLOW into BLOCK |
| C7 | Task text containing "report", "share" or an injected instruction does not grant `send_email` to a Dot whose task type lacks it |
| C8 | Promotion fails when the Dot's eval or red-team pass rate is below threshold, at every tier |
| C3 | Checker timeout and malformed checker output both produce a blocking objection |
| All | Fuzzing the decision API with random and malformed actions never yields ALLOW for an unregistered Dot, unknown tool or unknown dataset |

**Red-team suite.** A public, versioned set of scenarios (target: 200+ at v1.0) covering prompt injection through tool output, recipient spoofing, data smuggling via encoding (base64, splitting across calls), privilege escalation via task wording, approval fatigue, and replay of an approved payload with changed arguments. Report pass rate per release; v1.0 target: 100% on critical-severity scenarios, ≥ 95% overall.

**Benchmarks.** Latency and throughput from the non-functional table, run in CI on fixed hardware, with results published in the repo.

**Honest demo.** Rebuild the demo against a real OpenDots instance: the vanilla path shows OpenDots' actual approval card, and the governed path shows SPINE's real decision. Add a third scene where a lookalike recipient and an encoded payload are both caught, which shows the hardening rather than only the happy path.

## Roadmap and milestones

Five releases take SPINE-dots from demo to production, ordered so the false claims are fixed first: enforcement before features, evidence before reach.

&#91;embedded content: roadmap · v0.2 to v1.0, one exit gate per release\]

A release ships only when its gate's acceptance tests are green; dates are left open until scope and staffing are confirmed.

## Approved claims language and open questions

Until v1.0, the README should say only what is true today; the rewrites below keep the pitch sharp without overclaiming.

| Today's line | Use instead (v0.x) | Unlocked at |
| --- | --- | --- |
| "makes them safe to run at scale" | "adds a governance decision to every Dot tool call" | v1.0 with red-team results published |
| "salary/SSN columns are redacted" | "flags fields above the Dot's clearance" | v0.2 (GDS enforcement) |
| "a record no one can quietly edit" | "a hash-chained log that detects edits" | v0.4 (signing and anchoring) |
| "PDS is the only door" | "scopes tools to the Dot's grants and tier" | v0.2 (task types) |
| "Policy is data (JSON), not code" | "policy rules are centralized in one file" | v0.3 (policy engine) |
| "one blind click" (vanilla OpenDots) | describe the real OpenDots approval card | v0.2 (honest demo) |

**Open questions**

- [ ] Brand and domain: README links `saasquach.ai`; confirm the correct spelling and whether SaaSquatch or Charles & Roe is the public owner.
- [ ] Licence: keep MIT for everything, or MIT core plus a commercial licence for the console, SSO and evidence bundles (open-core)?
- [ ] Hosted offering: self-hosted only, or a managed control plane that never sees customer data (decisions local, metadata only)?
- [ ] Policy language: build the CEL-style DSL, or adopt Cedar or OPA from day one?
- [ ] OpenDots relationship: seek a listing or official integration with CopilotKit before or after v1.0?
- [ ] Public identity: ship under a personal GitHub account or a company organisation, given the separation between your day role and Charles & Roe.
