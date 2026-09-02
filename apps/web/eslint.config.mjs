import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ─── Design scale selectors ─────────────────────────────────────────────────
//
// The single source of truth for the closed-scale enforcement selectors. It is
// referenced twice below: once at `warn` globally (the migrating ratchet) and
// once at `error` for the modules that have finished migrating, so the two
// blocks can never drift apart. Adding a selector here tightens both at once.
//
// Keep example class names out of these comments. Tailwind scans this file as
// source, so a comment containing a class-shaped string generates a real (and
// here invalid) utility — which is how the CSS optimizer came to warn about
// `Unexpected token Delim('*')` on the first attempt.
const designScaleSelectors = [
  {
    selector:
      "Literal[value=/(mx-auto[\s\S]*max-w-[3-7]xl|max-w-[3-7]xl[\s\S]*mx-auto)/]",
    message:
      "Centred page column. Page content anchors to the reading edge, not the middle: two symmetric gutters around a capped column read as an unfinished layout and break alignment with the top bar and sidebar. Use PageColumn (components/layout/page-column) and drop the horizontal auto margin. The shell already centres the whole content area on ultrawide displays.",
  },
  {
    selector:
      "TemplateElement[value.raw=/(mx-auto[\s\S]*max-w-[3-7]xl|max-w-[3-7]xl[\s\S]*mx-auto)/]",
    message:
      "Centred page column. Page content anchors to the reading edge. Use PageColumn (components/layout/page-column).",
  },
  {
    selector: "Literal[value=/text-\\[[0-9.]+(px|rem|em)\\]/]",
    message:
      "Arbitrary font size. Use a type scale step: text-display, text-h1, text-h2, text-h3, text-body, text-body-sm, text-caption, text-micro. See /design.",
  },
  {
    selector: "TemplateElement[value.raw=/text-\\[[0-9.]+(px|rem|em)\\]/]",
    message:
      "Arbitrary font size. Use a type scale step: text-display, text-h1, text-h2, text-h3, text-body, text-body-sm, text-caption, text-micro. See /design.",
  },
  {
    selector: "Literal[value=/\\brounded-(sm|md|lg|xl|2xl|3xl)\\b/]",
    message:
      "Ad-hoc radius. Use rounded-control (6px), rounded-panel (10px), rounded-container (14px), or rounded-full. Radius encodes nesting depth. See /design.",
  },
  {
    selector: "TemplateElement[value.raw=/\\brounded-(sm|md|lg|xl|2xl|3xl)\\b/]",
    message:
      "Ad-hoc radius. Use rounded-control (6px), rounded-panel (10px), rounded-container (14px), or rounded-full. See /design.",
  },
  {
    selector: "Literal[value=/shadow-\\[var\\(--shadow-/]",
    message:
      "Use the elevation utilities instead: shadow-e1 (resting), shadow-e2 (raised), shadow-e3 (overlay), shadow-ring (focus). See /design.",
  },
  {
    selector: "TemplateElement[value.raw=/shadow-\\[var\\(--shadow-/]",
    message:
      "Use the elevation utilities instead: shadow-e1, shadow-e2, shadow-e3, shadow-ring. See /design.",
  },
  {
    selector: "Literal[value=/-\\[#[0-9a-fA-F]{3,8}\\]/]",
    message:
      "Hardcoded colour. Every colour comes from a semantic token so it resolves in both themes and a tenant can re-brand safely. See /design and docs/02-architecture/frontend-theme.md.",
  },
  {
    selector: "TemplateElement[value.raw=/-\\[#[0-9a-fA-F]{3,8}\\]/]",
    message:
      "Hardcoded colour. Every colour comes from a semantic token. See /design.",
  },
  {
    selector:
      "Literal[value=/\\b[pm][xytblrse]?-(7|9|11|13|14|15|17|18|19|21|22|23)\\b/]",
    message:
      "Off-grid spacing. The scale is 1 2 3 4 5 6 8 10 12 16 (4-64px), plus the half-steps 0.5 1.5 2.5 3.5 for dense controls. See /design.",
  },
  {
    selector:
      "Literal[value=/\\bduration-(75|100|150|200|300|500|700|1000)\\b/]",
    message:
      "Hardcoded duration. Use duration-[var(--motion-exit)] (120ms), --motion-enter (180ms) or --motion-layout (240ms) with ease-brand. See /design.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Playwright fixtures receive a callback named `use`, which the React Hooks rule reads
    // as a call to React's `use` hook outside a component. There is no React in the E2E
    // suite, so the rule has nothing to check here.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    // ─── Design scale enforcement ─────────────────────────────────────────────
    //
    // The scales in `globals.css` are closed sets. Without a rule they are a
    // suggestion: the type scale, the radius tokens and the elevation tokens all
    // existed as CSS before this config did, and the codebase accumulated 14
    // arbitrary font sizes, 290 ad-hoc radius classes and 68 verbose arbitrary
    // box-shadow spellings anyway. `--radius-panel` was declared and referenced
    // by nothing at all.
    //
    // Keep example class names out of these comments. Tailwind scans this file
    // as source, so a comment containing a class-shaped string generates a real
    // (and here invalid) utility — which is exactly how the CSS optimizer came
    // to warn about `Unexpected token Delim('*')` on the first attempt.
    //
    // These are `warn` on purpose. Turning them to `error` today would fail lint
    // on ~350 pre-existing call sites in one step; Phase 1 migrates them module
    // by module and flips each rule to `error` as its last commit, so the ratchet
    // only ever tightens. Rendered reference: `/design`.
    //
    // The selectors match Tailwind class text inside string and template
    // literals, which is where these values are written. That catches the real
    // cases without needing a Tailwind-aware plugin.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["warn", ...designScaleSelectors],
    },
  },
  {
    // ─── Migrated modules: ratchet flipped to error ───────────────────────────
    //
    // IPA and IPC finished their token migration in the Round-2 re-skin slice, so
    // their raw utilities cannot regress. This is the same selector set as the
    // global `warn` block above — only the severity differs — so a raw radius,
    // shadow, arbitrary font size, hardcoded colour, off-grid spacing or hardcoded
    // duration fails lint here rather than warning. Add the next module's paths
    // here as it finishes migrating; the ratchet only ever tightens.
    files: ["src/features/ipa/**", "src/features/ipc/**"],
    rules: {
      "no-restricted-syntax": ["error", ...designScaleSelectors],
    },
  },
  {
    // The gallery's whole purpose is to render each scale next to its own name,
    // which means writing the values out literally. Exempting it keeps the rules
    // above strict everywhere they matter.
    files: ["src/features/design-system/**"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
