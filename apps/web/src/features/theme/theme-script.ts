/**
 * Runs before hydration so dark mode never flashes a light canvas, and a
 * compact user never sees one comfortable frame before the rows tighten.
 *
 * Both preferences are resolved in the same pass because both are painted from
 * the root element, and two separate blocking scripts would be two round trips
 * through the parser for one frame of benefit.
 *
 * The string is duplicated logic — `theme-preference.ts` and
 * `density-preference.ts` hold the real sanitizers — and that is the trade being
 * made: this script must run before any module graph exists, so it cannot
 * import them. `theme-preference.test.ts` pins the values on the other side.
 */
export const themeInitializationScript = `
(() => {
  const root = document.documentElement;

  let storedTheme = null;
  try { storedTheme = localStorage.getItem('rukna.theme.preference'); } catch {}
  const preference = storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system' ? storedTheme : 'system';
  const theme = preference === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', theme === 'dark' ? '#17191d' : '#f4f6f8');

  let storedDensity = null;
  try { storedDensity = localStorage.getItem('rukna.density.preference'); } catch {}
  root.dataset.density = storedDensity === 'compact' ? 'compact' : 'comfortable';
})()
`;
