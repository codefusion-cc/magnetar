# CI runners

The Worker, the dashboard and their checks move into the codefusion monorepo. Their jobs take the runner the
CodeFusion pool names for this repository: `vars.CI_RUNNER_LIGHT` for light jobs, `vars.CI_RUNNER_HEAVY` for builds and
test suites. CodeFusion Console sets both (`ci_minutes`). This repository is public, so today both are GitHub's
`ubuntu-latest`, free here.

The Rust client and its releases stay in this public repository (codefusion docs/MONOREPO.md, decision 2). Their
jobs need macOS and Windows, which the pool has no machine for, so they keep GitHub's own labels, free for a public
repository. `packages/release/runners.test.ts` allows those labels only in these jobs:

| Workflow, job | Runs on | Why it stays on GitHub's machines |
| --- | --- | --- |
| `ci.yml` check, macOS and Windows | `macos-14`, `windows-latest` | builds and smoke-tests the client on each system |
| `release.yml` all jobs | see below | builds, signs and publishes the client |
| `preview-app.yml` build | `macos-14` | builds Magnetar Preview for Apple silicon Macs |
| `preview-app.yml` publish | `ubuntu-latest` | signs its manifest and publishes it, apart from the build like a release |
| `provider-health.yml` live | `ubuntu-latest` | the client's weekly live provider tests |

Release targets, and whether the pool has a machine for them:

| Target | Runner | A machine in the pool |
| --- | --- | --- |
| `aarch64-apple-darwin` | `macos-14` | no: the pool's Macs run jobs in Linux VMs |
| `x86_64-apple-darwin` | `macos-14` (cross-compiled) | no |
| `x86_64-pc-windows-msvc` | `windows-latest` | no |
| `aarch64-pc-windows-msvc` | `windows-11-arm` | no |
| `x86_64-unknown-linux-gnu` | `ubuntu-22.04` (oldest glibc) | no: the pool's x64 Linux machines are newer |
| `aarch64-unknown-linux-gnu` | `ubuntu-22.04-arm` | no: kobold is ARM Linux, but not on Ubuntu 22.04 |

Every other job reads `vars.CI_RUNNER_LIGHT` or `vars.CI_RUNNER_HEAVY`, with no fallback label.
