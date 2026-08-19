---
name: ship-ipa-tools
description: >-
  Version, verify, and walk the user through publishing the ipa-tools npm
  package from packages/ipa-tools. The agent must not npm login or npm publish;
  ask the user to do both. Use when the user asks to ship, release, publish, or
  deploy ipa-tools, bump its version, or cut an npm release for that package.
disable-model-invocation: true
---

# Ship ipa-tools

Prepare `packages/ipa-tools` for a public npm release. The user publishes.

npm auth does not persist for the agent (login/OTP). **Never** run `npm login` or `npm publish`. Do **not** read or print `~/.npmrc` / auth tokens. Do **not** use `npm whoami` as a gate.

## Preconditions

- Working tree clean (or only intentional release edits).
- On `main` (or a release branch based on current `main`) with the code to ship.
- Confirm the target version is not already on the registry (`npm view ipa-tools versions`) before asking the user to publish.

## Checklist

Copy and track:

```
Ship ipa-tools:
- [ ] Confirm version + CHANGELOG
- [ ] npm run build && npm test (in packages/ipa-tools)
- [ ] Ask the user to npm login and npm publish
- [ ] Confirm the version on the registry after they say they published
- [ ] git tag ipa-tools@x.y.z and push tag (if user wants)
- [ ] Report install command + registry URL
```

## Version and changelog

1. Read `packages/ipa-tools/package.json` `version` and `packages/ipa-tools/CHANGELOG.md`.
2. For a **first publish** of the current version: keep the version if CHANGELOG already has that section and the version is unpublished.
3. For a **new release**: bump SemVer in `package.json` (`0.x` while IPA is Experimental Draft — prefer minor/patch unless the user asks for major).
4. Add a Keep a Changelog section for the new version (date = today UTC) before asking the user to publish.
5. Align pinned CDN examples in `packages/ipa-tools/README.md` with the version being published when those pins would otherwise point at an old release.

## Build and test

From `packages/ipa-tools`:

```bash
npm run build
npm test
```

Do not ask the user to publish if either fails.

## Ask the user to login and publish

After version/changelog/README pins and a passing build+test, **stop** and ask the user to login and publish. Give them these commands (package is public, unscoped; no `--access` flag):

```bash
cd packages/ipa-tools
npm login
npm publish
```

Then wait. When they say they published, confirm with `npm view ipa-tools version`.

- If the version is not on the registry: ask them to retry `npm login` / `npm publish` (2FA/OTP is expected). Do not try to publish from the agent.
- On **name unavailable / previously unpublished name you do not own**: stop and discuss renaming (e.g. scoped `@samsamskies/ipa-tools`) with the user before changing `package.json`.

Dry-run only when the user asks. They run it:

```bash
cd packages/ipa-tools
npm publish --dry-run
```

## Tag (optional)

If the user wants a git tag after a successful publish:

```bash
git tag "ipa-tools@$(node -p "require('./packages/ipa-tools/package.json').version")"
git push origin "ipa-tools@$(node -p "require('./packages/ipa-tools/package.json').version")"
```

Only create/push tags when the user asks. Only commit CHANGELOG/version bumps when the user asks to commit.

## After publish

Report:

1. Published version (`ipa-tools@x.y.z`)
2. `npm install ipa-tools`
3. Registry page: `https://www.npmjs.com/package/ipa-tools`
4. Whether a git tag was pushed
