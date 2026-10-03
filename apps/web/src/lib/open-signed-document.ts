/**
 * Opens a signed document URL in a new tab without the browser treating it as an unrequested popup.
 *
 * The tab is opened synchronously on the click (before the URL is fetched) and pointed at the URL
 * once it arrives; it is closed again if the fetch fails. `noopener` must NOT be passed to
 * `window.open` here — with it the call always returns `null`, so the blank tab could never be
 * navigated or closed. The opener link is cut by hand instead.
 */
export async function openSignedDocument<T extends { url: string }>(
  fetchDocument: () => Promise<T>,
): Promise<T> {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const doc = await fetchDocument();
    if (tab) tab.location.href = doc.url;
    else window.open(doc.url, '_blank', 'noopener');
    return doc;
  } catch (error) {
    tab?.close();
    throw error;
  }
}
