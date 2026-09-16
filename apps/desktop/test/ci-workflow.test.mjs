import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  ciWorkflowSource,
  releaseWorkflowSource,
  desktopPackageSource,
  linuxPackageWorkflowSource,
  mirrorToCnbWorkflowSource,
  agentRuntimePackageSource,
  i18nPackageSource,
  pluginSdkPackageSource,
  sharedPackageSource,
  releaseMacScriptSource,
  releaseAsarScriptSource,
] = await Promise.all([
  read("../../../.github/workflows/ci.yml"),
  read("../../../.github/workflows/release.yml"),
  read("../package.json"),
  read("../../../.github/workflows/linux-package.yml"),
  read("../../../.github/workflows/mirror-to-cnb.yml"),
  read("../../../packages/agent-runtime/package.json"),
  read("../../../packages/i18n/package.json"),
  read("../../../packages/plugin-sdk/package.json"),
  read("../../../packages/shared/package.json"),
  read("../../../scripts/release-macos.sh"),
  read("../../../scripts/export-linux-asar.mjs"),
]);

test("CI skips documentation-only pushes and pull requests", () => {
  assert.equal(
    (ciWorkflowSource.match(/- 'docs\/\*\*'/g) ?? []).length,
    2,
    "docs path is ignored by push and pull_request triggers",
  );
  assert.equal(
    (ciWorkflowSource.match(/- '\*\*\/\*\.md'/g) ?? []).length,
    2,
    "Markdown files are ignored by push and pull_request triggers",
  );
  assert.match(ciWorkflowSource, /^  workflow_dispatch:/m);
});

test("CI does not typecheck workspace dependencies twice", () => {
  for (const source of [
    agentRuntimePackageSource,
    i18nPackageSource,
    pluginSdkPackageSource,
    sharedPackageSource,
  ]) {
    assert.match(JSON.parse(source).scripts.build, /^tsc\b/);
  }

  assert.match(
    ciWorkflowSource,
    /run: pnpm --filter @pi-desktop\/desktop typecheck/,
  );
  assert.doesNotMatch(ciWorkflowSource, /run: pnpm typecheck/);
});

test("release runners validate tags without a separate job barrier", () => {
  assert.doesNotMatch(releaseWorkflowSource, /^  validate:/m);
  assert.doesNotMatch(releaseWorkflowSource, /^    needs: validate$/m);
  assert.match(
    releaseWorkflowSource,
    /TAG_VERSION="\$\{GITHUB_REF_NAME#v\}"/,
  );
  assert.match(
    releaseWorkflowSource,
    /Tag v\$TAG_VERSION does not match apps\/desktop\/package\.json version \$APP_VERSION/,
  );
});

test("release preparation overlaps independent work and avoids duplicate builds", () => {
  assert.match(
    releaseWorkflowSource,
    /cargo build --release --locked -p host-core &/,
  );
  assert.match(releaseWorkflowSource, /wait "\$host_build_pid"/);
  assert.match(
    releaseWorkflowSource,
    /pnpm --filter '@pi-desktop\/desktop\^\.\.\.' --fail-if-no-match build/,
  );
  // The full JS build belongs to the verify gate; the build matrix only
  // builds the desktop app's workspace dependencies.
  const buildJob = releaseWorkflowSource.match(/^  build:\n[\s\S]*?(?=^  publish:)/m)?.[0];
  assert.ok(buildJob, "release build job is missing");
  assert.doesNotMatch(buildJob, /run: pnpm build:js/);
});

test("release builds are gated on the CI checks and least-privilege permissions", () => {
  assert.match(releaseWorkflowSource, /^permissions:\n  contents: read$/m);
  assert.match(releaseWorkflowSource, /^  verify:/m);
  assert.match(releaseWorkflowSource, /^  build:\n[\s\S]*?^    needs: verify$/m);
  const verifyJob = releaseWorkflowSource.match(/^  verify:\n[\s\S]*?(?=^  build:)/m)?.[0];
  assert.ok(verifyJob, "release verify job is missing");
  for (const step of [
    /run: pnpm build:js/,
    /run: pnpm --filter @pi-desktop\/desktop typecheck/,
    /run: pnpm lint/,
    /run: pnpm -r --if-present test/,
    /run: cargo test -p host-core --locked/,
  ]) {
    assert.match(verifyJob, step);
  }
  const publishJob = releaseWorkflowSource.match(/^  publish:\n[\s\S]*$/m)?.[0];
  assert.ok(publishJob, "release publish job is missing");
  assert.match(publishJob, /^    permissions:\n      contents: write$/m);
});

test("release artifacts bypass redundant Actions compression", () => {
  assert.match(
    releaseWorkflowSource,
    /uses: actions\/upload-artifact@v4[\s\S]*?compression-level: 0/,
  );
});

test("manual Linux package validation covers the RPM desktop identity", () => {
  assert.match(linuxPackageWorkflowSource, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.match(linuxPackageWorkflowSource, /runs-on: ubuntu-22\.04/);
  assert.match(
    linuxPackageWorkflowSource,
    /run: pnpm --filter @pi-desktop\/desktop run dist:linux -- --x64/,
  );
  assert.match(
    linuxPackageWorkflowSource,
    /name: Install RPM inspection tools[\s\S]*apt-get install[\s\S]*cpio rpm/,
  );
  assert.match(
    linuxPackageWorkflowSource,
    /find apps\/desktop\/release[\s\S]*-name '\*\.rpm'/,
  );
  assert.match(linuxPackageWorkflowSource, /rpm -qpl "\$rpm_package"/);
  assert.match(linuxPackageWorkflowSource, /build-id/);
  assert.match(
    linuxPackageWorkflowSource,
    /usr\/share\/applications\/pi-desktop\.desktop/,
  );
  assert.match(linuxPackageWorkflowSource, /Icon=pi-desktop/);
  assert.match(linuxPackageWorkflowSource, /StartupWMClass=pi-desktop/);
  assert.match(
    linuxPackageWorkflowSource,
    /uses: actions\/upload-artifact@v4[\s\S]*path: apps\/desktop\/release\/\*\.rpm/,
  );
});

test("fork release workflow builds and publishes Windows x64 only", () => {
  // The 京车小智工作台 fork ships a single Windows x64 installer lane
  // (NSIS + portable) instead of the upstream all-platform matrix.
  assert.match(
    releaseWorkflowSource,
    /name: Windows x64[\s\S]*?os: windows-latest[\s\S]*?arch: x64[\s\S]*?dist: dist:win/,
  );
  assert.doesNotMatch(releaseWorkflowSource, /macos-15|macos-15-intel|ubuntu-22\.04/);
  assert.doesNotMatch(releaseWorkflowSource, /dist:mac|dist:linux/);
  assert.match(releaseWorkflowSource, /apps\/desktop\/release\/\*\.exe/);
  assert.match(releaseWorkflowSource, /apps\/desktop\/release\/latest\*\.yml/);
  assert.match(releaseWorkflowSource, /files: dist\/\*/);
  assert.doesNotMatch(releaseWorkflowSource, /Merge macOS updater metadata|Verify macOS artifact names/);
  const pkg = JSON.parse(desktopPackageSource);
  assert.equal(pkg.build.win.target[0].target, "nsis");
  assert.equal(pkg.build.win.target[1].target, "portable");
});

test("the signed local macOS lane selects the native runner architecture", () => {
  assert.match(releaseMacScriptSource, /DEFAULT_MAC_ARCH/);
  assert.match(releaseMacScriptSource, /MAC_ARCH="\$\{MAC_ARCH:-\$DEFAULT_MAC_ARCH\}"/);
  assert.match(releaseMacScriptSource, /must match the host/);
  assert.match(releaseMacScriptSource, /electron-builder --mac "--\$\{MAC_ARCH\}"/);
  assert.doesNotMatch(
    releaseMacScriptSource,
    /-c\.(?:dmg|zip)\.artifactName/,
    "the signed local macOS lane uses the shared artifact naming config",
  );
});

test("GitHub releases trigger the CNB mirror pipeline with a JSON payload", () => {
  assert.match(
    mirrorToCnbWorkflowSource,
    /release:\s+types:\s+\[published, edited\]/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /workflow_dispatch:\s+inputs:\s+tag:/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /if: github\.repository == 'vastsa\/PI-Desktop'/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /CNB_MIRROR_TOKEN: \$\{\{\s*secrets\.CNB_MIRROR_TOKEN\s*\}\}/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /Missing repository secret CNB_MIRROR_TOKEN/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /https:\/\/api\.cnb\.cool\/aixk\/Pi-Desktop\/-\/build\/start/,
  );
  assert.match(mirrorToCnbWorkflowSource, /event: "api_trigger_mirror"/);
  assert.match(mirrorToCnbWorkflowSource, /env: \{ MIRROR_TAGS: \$tag \}/);
  assert.match(mirrorToCnbWorkflowSource, /jq -n --arg tag "\$MIRROR_TAG"/);
  assert.match(mirrorToCnbWorkflowSource, /curl --fail-with-body/);
  assert.doesNotMatch(
    mirrorToCnbWorkflowSource,
    /-d ".*github\.event\.release\.tag_name/,
    "JSON payload must not interpolate the release tag through YAML string escaping",
  );
});
