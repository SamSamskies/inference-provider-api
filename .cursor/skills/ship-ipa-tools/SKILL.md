---
name: ship-ipa-tools
description: >-
  Version, verify, and publish the ipa-tools npm package from packages/ipa-tools.
  Use when the user asks to ship, release, publish, or deploy ipa-tools, bump
  its version, or cut an npm release for that package.
disable-model-invocation: true
---

# Ship ipa-tools

Publish `packages/ipa-tools` to the public npm registry.

## Preconditions

- Working tree clean (or only intentional release edits).
- On `main` (or a release branch based on current `main`) with the code to ship.
- User is logged in to npm (`npm whoami` succeeds). Do **not** read or print `~/.npmrc` / auth tokens.
- Confirm the target version is not already on the registry before publishing.

## Checklist

Copy and track:

```
Ship ipa-tools:
- [ ] Confirm version + CHANGELOG
- [ ] npm run build && npm test (in packages/ipa-tools)
- [ ] npm publish (from packages/ipa-tools)
- [ ] git tag ipa-tools@x.y.z and push tag (if user wants)
- [ ] Report install command + registry URL
```

## Version and changelog

1. Read `packages/ipa-tools/package.json` `version` and `packages/ipa-tools/CHANGELOG.md`.
2. For a **first publish** of the current version: keep the version if CHANGELOG already has that section and the version is unpublished.
3. For a **new release**: bump SemVer in `package.json` (`0.x` while IPA is Experimental Draft — prefer minor/patch unless the user asks for major).
4. Add a Keep a Changelog section for the new version (date = today UTC) before publishing.
5. Align pinned CDN examples in `packages/ipa-tools/README.md` with the version being published when those pins would otherwise point at an old release.

## Build and test

From `packages/ipa-tools`:

```bash
npm run build
npm test
```

Do not publish if either fails. `prepublishOnly` also runs build + test; still run them explicitly first so failures are obvious.

## Publish

From `packages/ipa-tools`:

```bash
npm publish
```

- Package is public, unscoped: no `--access` flag required.
- On **403/401**: stop and ask the user to `npm login` (or fix 2FA / OTP). Do not scrape credentials from disk.
- On **name unavailable / previously unpublished name you do not own**: stop and discuss renaming (e.g. scoped `@samsamskies/ipa-tools`) with the user before changing `package.json`.

Dry-run only when the user asks:

```bash
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
