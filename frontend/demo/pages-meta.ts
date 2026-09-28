/* ===========================================================================
   Pages-only Vite plugin: adds link-preview tags (Open Graph / Twitter) to the
   static demo and ships the preview image, so the demo link shows a card on
   LinkedIn, Reddit or X. The router build never uses it.
   =========================================================================== */
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://ramirezjhulian7.github.io/motorola-q11-freedom/';
const IMAGE = 'social-preview.png';
const TITLE = 'Q11 Freedom: live demo';
const DESC = 'Local web panel for the Motorola Q11 mesh after the Minim cloud shut down. '
  + 'No account, no app, no flashing. Try it with fictional data.';

export function pagesMeta(): Plugin {
  return {
    name: 'freedom-pages-meta',
    apply: 'build',
    transformIndexHtml() {
      const tag = (attr: string, key: string, content: string) =>
        ({ tag: 'meta', attrs: { [attr]: key, content }, injectTo: 'head' as const });
      return [
        tag('name', 'description', DESC),
        tag('property', 'og:type', 'website'),
        tag('property', 'og:url', SITE),
        tag('property', 'og:title', TITLE),
        tag('property', 'og:description', DESC),
        tag('property', 'og:image', SITE + IMAGE),
        tag('property', 'og:image:width', '1280'),
        tag('property', 'og:image:height', '640'),
        tag('name', 'twitter:card', 'summary_large_image'),
      ];
    },
    generateBundle() {
      const src = fileURLToPath(new URL('../../docs/social-preview.png', import.meta.url));
      this.emitFile({ type: 'asset', fileName: IMAGE, source: readFileSync(src) });
    },
  };
}
