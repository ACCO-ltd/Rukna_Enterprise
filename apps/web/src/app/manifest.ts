import type { MetadataRoute } from 'next';

/**
 * Step 7 (ADR-047: phone flows are an installable web app, not a native app). Installed, the app
 * opens on the site-staff Home. The product name is the platform's, never a tenant's: one install
 * works for whichever company the person signs in to.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rukna ERP',
    short_name: 'Rukna',
    description: 'Quotes, receipts, delivery notes and material requests from site.',
    start_url: '/site',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // The manifest cannot read CSS tokens: this is --brand-primary and the light surface.
    theme_color: '#2453e0',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
