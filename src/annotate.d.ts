import type { VerificationResult } from './verify';

export interface AnnotateOptions {
    /** Emit ANSI colors (default true). */
    color?: boolean;
}

/**
 * Render a verification result as annotated text: the visible prose with
 * markers underneath showing what was checked and what failed.
 */
export function annotate(markup: string, result: VerificationResult, opts?: AnnotateOptions): string;
export default annotate;
