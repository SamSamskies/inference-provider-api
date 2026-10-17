---
name: ship-ipa-package
description: >-
  Prepare and verify npm releases of ipa-tools or ipa-prompt-api-fallback in
  inference-provider-api. Use for shipping a named package, preparing a version
  bump, or checking publication and its demo update. Questions about whether a
  release is needed call for advice, not publication.
---

# Ship an IPA package

Release only the package selected by the user. If the target is ambiguous, ask
which package; never default to releasing both. Keep their versions independent.
Use the current repository files and registry metadata rather than remembered
versions or a previous release's commands.

| Package | Workspace | Versioned documentation and demo imports |
| --- | --- | --- |
| `ipa-tools` | `packages/ipa-tools` | Its README and matching `ipa-tools@` imports in `examples/**` |
| `ipa-prompt-api-fallback` | `packages/ipa-prompt-api-fallback` | Its README and the `ipa-prompt-api-fallback@` import in `examples/prompt-api-fallback/index.html` |

## Prepare and verify

1. Work on an authorized feature or release branch based on current `main`,
   preserving unrelated user changes. Read the selected package's manifest,
   changelog, scripts, and changes since its published version. A request to
   prepare or bump a version does not itself authorize publishing it.
2. Check `npm view PACKAGE versions --json` and its dist-tags. Keep the current
   manifest version for a first publish if it is appropriate and unpublished;
   otherwise choose a SemVer bump from the published version. Use patch for
   compatible fixes, minor for compatible additions, and major for breaking
   changes. The spec's draft status does not reset package versioning. A failed
   registry lookup is not proof that a version is unpublished.
3. Update the selected manifest and root lockfile together. For example,
   `npm version VERSION --workspace PACKAGE --no-git-tag-version --ignore-scripts`.
   Move applicable notes from `[Unreleased]` into a version section dated with
   today's UTC date, retaining an empty `[Unreleased]` section for future work.
   A prepared changelog entry is separate from confirmed npm publication.
4. Review the documentation and demo pins listed above. Update pins intended to
   demonstrate this release; leave historical migration notes and unrelated
   package pins intact. Keep the other package's version unchanged. Change a
   fallback peer requirement only when compatibility actually requires it.
5. Use the root manifest's supported Node version and run `npm test` from the
   repository root. It builds both workspaces before running tests and TypeScript
   checks, avoiding stale local peer output. Resolve failures before publishing.
6. Pack the selected workspace into a temporary directory with
   `npm pack --workspace PACKAGE --pack-destination TEMP_DIR`. Inspect the packed
   version, exports, and files, then exercise the changed behavior using the
   packed artifact. For the fallback, verify it with a published `ipa-tools`
   version satisfying its peer range, rather than relying only on the local
   workspace. Do not silently raise the peer requirement to make the check pass.
7. Run `git diff --check` and review the release diff. Follow the task's Git
   authorization for commits, pushes, and PRs. Keep a release PR in draft while
   its demo imports point to an unpublished or unavailable version. Create or
   push a release tag only when the user asks.

Replace `PACKAGE`, `VERSION`, and `TEMP_DIR` with concrete values. Give the user
paste-ready commands for the selected workspace, not unresolved placeholders.

## Publish with the selected package's rules

- **`ipa-tools`:** Preserve its existing user-publishes policy. The agent must not
  run `npm login` or `npm publish` for this package. After preparation and checks,
  give the user commands to enter `packages/ipa-tools`, run `npm login`, and run
  `npm publish`; wait for their response. Explain this skill requirement when
  handing off the publish step. If they request a publish dry-run, they run it.
- **`ipa-prompt-api-fallback`:** When publishing is part of the user's request,
  the agent may attempt one publish of the verified release. If npm requires
  interactive authentication (`EOTP`, `ENEEDAUTH`, or an authentication error),
  stop retrying and give the user the workspace-specific `npm publish` command;
  include `npm login` only if sign-in is needed. Do not automate login or bypass
  two-factor authentication. Preparation-only requests stop before publication.

Never read or print `~/.npmrc` or auth tokens, or use `npm whoami` as a release
gate. Report name, ownership, or version conflicts without renaming a package or
changing access automatically. Do not run a publish dry-run unless requested.

## Confirm publication and finish the demo update

1. After a successful publish or the user says they published, query the exact
   version with
   `npm view PACKAGE@VERSION version dist.tarball dist.shasum --json --prefer-online`
   and check the intended dist-tag. Do not rely on `latest` alone.
2. npm may report that an upload is processing before the version becomes
   readable. Keep any release PR in draft and retry read-only checks at 30-60 second
   intervals for up to five minutes. If still unavailable, report publication
   as pending and leave any release PR draft. Do not republish, bump again, or treat
   processing as an authentication failure.
3. Verify the registry artifact matches the tested release. For changed CDN
   pins, fetch the exact entry URL and its resolved JavaScript and peer imports;
   a working wrapper alone does not prove the demo module is available.
4. Once the version and all changed CDN imports resolve, update any release PR
   to describe the released version and validation, remove obsolete pending-auth
   notes, and mark it ready. Leave merging to the user's authorized Git
   workflow. After the user reports a merge, check deployment status and the
   import actually served by the live demo.
5. Report the package and published version, install command, registry link,
   PR/demo status, and any remaining user action. Distinguish pending publication
   from a release confirmed available on npm.
