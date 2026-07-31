/**
 * Compatibility wrapper over the lightweight HTML renderer.
 *
 * Existing imports can keep using createRenderer(factStore).render(source),
 * but the underlying rendering path is the shared render-html module.
 */

import { renderProveml } from './render-html.js';

export function createRenderer(factStore) {
    return {
        render(source, options = {}) {
            return renderProveml(source, factStore, options);
        }
    };
}
