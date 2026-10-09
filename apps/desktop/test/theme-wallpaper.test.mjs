import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [tokens, skin, globals, styles] = await Promise.all([
  read("../src/styles/tokens.css"),
  read("../src/styles/app-background.css"),
  read("../src/styles/globals.css"),
  loadStyles(),
]);

const tokensDeclaredIn = (name) =>
  (tokens.match(new RegExp(`${name}:`, "g")) ?? []).length;

test("the wallpaper tokens are declared once per theme block", () => {
  // Both theme blocks must own the values: the veil and scrim differ, and a
  // token that only exists in one block silently falls back across themes.
  for (const token of [
    "--ds-app-bg-image",
    "--ds-app-bg-scrim",
    "--ds-app-veil-alpha",
    "--ds-app-veil-alpha-soft",
  ]) {
    assert.equal(
      tokensDeclaredIn(token),
      2,
      `${token} must be declared in both theme blocks`,
    );
  }
  assert.match(
    tokens,
    /--ds-app-bg-scrim: color-mix\(in oklab, var\(--ds-bg-under\) 48%, transparent\);/,
  );
  assert.match(
    tokens,
    /--ds-app-bg-scrim: color-mix\(in oklab, var\(--ds-bg-under\) 45%, transparent\);/,
  );
});

test("the skin partial is imported last so it can outrank every feature layer", () => {
  const imports = [...globals.matchAll(/^@import "\.\/([A-Za-z0-9-]+)\.css";$/gm)].map(
    (match) => match[1],
  );
  assert.ok(imports.length > 0, "globals.css must sequence the partials");
  assert.equal(imports.at(-1), "app-background");
  assert.equal(imports.filter((name) => name === "app-background").length, 1);
});

test("the photo is assigned on the same three selectors the theme blocks use", () => {
  // `:root[data-theme="…"]` outranks a bare `:root`, so the skin has to match
  // those selectors or `--ds-app-bg-image: none` wins and nothing paints.
  assert.match(
    skin,
    /:root,\s*:root\[data-theme="dark"\],\s*:root\[data-theme="light"\] \{\s*--ds-app-bg-image:\s*url\("\.\.\/assets\/theme\/workbench-backdrop\.jpg"\);/,
  );
});

test("the shell paints a legal image list with the scrim above the photo", () => {
  // A bare colour is not a valid `<image>`, so it is wrapped in a flat gradient.
  // Listing the colour raw invalidates the whole declaration and leaves the
  // shell unpainted with `#root background-image: none`.
  const block = skin.match(/:root #root \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(
    block,
    /background-image:\s*linear-gradient\(\s*var\(--ds-app-bg-scrim\),\s*var\(--ds-app-bg-scrim\)\s*\),\s*var\(--ds-app-bg-image\);/,
  );
  assert.match(block, /background-position:\s*center;/);
  assert.match(block, /background-size:\s*cover;/);
  assert.match(block, /background-repeat:\s*no-repeat;/);
});

test("the shell plate goes transparent so the photo shows through", () => {
  assert.match(
    skin,
    /:root \.app-shell,\s*:root \.app-shell\.settings-mode \{\s*background:\s*transparent;/,
  );
});

test("plates trade opacity but keep their own surface tone", () => {
  // The dock column must stay one step lighter than the chat pane (D419), so
  // each plate works from its own token instead of one flattened colour.
  assert.match(
    skin,
    /:root \.main-pane \{\s*background-color:\s*color-mix\(\s*in oklab,\s*var\(--ds-bg-primary\) var\(--ds-app-veil-alpha\),\s*transparent\s*\);/,
  );
  assert.match(
    skin,
    /:root \.work-panel \{\s*background-color:\s*color-mix\(\s*in oklab,\s*var\(--ds-bg-dock\) var\(--ds-app-veil-alpha\),/,
  );
  assert.match(
    skin,
    /:root \.work-panel-header \{\s*background-color:\s*color-mix\(\s*in oklab,\s*var\(--ds-bg-dock-raised\) var\(--ds-app-veil-alpha\),/,
  );
  // Chrome plates read lighter-weight than the reading plates.
  assert.match(
    skin,
    /:root \.main-titlebar,\s*:root \.conversation-topbar,\s*:root \.window-controls \{\s*background-color:\s*color-mix\(\s*in oklab,\s*var\(--ds-bg-primary\) var\(--ds-app-veil-alpha-soft\),/,
  );
});

test("the settings shell keeps its opaque built-in paint", () => {
  // scripts/e2e/theme-surfaces.js pins the settings rail to
  // `--ds-settings-rail-bg` pixel-for-pixel, so a contributed theme can move
  // that surface. Thinning any settings plate would break that contract, and
  // the settings page is the densest form layout in the app besides.
  assert.doesNotMatch(
    skin,
    /\.settings-(nav|shell|shell-full|content|titlebar)\b/,
  );
});

test("the sidebar keeps its theme image hook", () => {
  // plugin-themes.test.mjs locks the built-in sidebar paint contract; the skin
  // may only thin the colour so a contributed sidebar image still works.
  assert.match(
    styles,
    /\.sidebar \{[\s\S]*?background-color:\s*var\(--ds-bg-sidebar[^;]*;[\s\S]*?background-image:\s*var\(--ds-bg-sidebar-image/,
  );
  const block = skin.match(/:root \.sidebar,\s*:root \.sidebar-rail \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(block, /background-color:\s*color-mix\(/);
  assert.doesNotMatch(block, /background-image/);
});

test("the wallpaper states colours through tokens only", () => {
  // scripts/style-surface-tokens.mjs allows colour literals only in theme-root
  // blocks; this partial is not one, so it must stay literal-free.
  assert.doesNotMatch(skin, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(skin, /\brgba?\(/);
  // The word may appear in prose; only a real declaration is forbidden.
  assert.doesNotMatch(skin, /backdrop-filter\s*:/);
});

test("the backdrop asset ships with the renderer", async () => {
  await access(new URL("../src/assets/theme/workbench-backdrop.jpg", import.meta.url));
});
