import { registerHooks } from "node:module";

// Loaded with --import so the audit's parser workers inherit this boundary.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^(?:pdfjs-dist|pdf-lib)(?:\/|$)/.test(specifier)) {
      throw Object.assign(new Error(`Native PDF audit blocked dependency: ${specifier}`), {
        code: "HEPR_AUDIT_PDF_DEPENDENCY"
      });
    }
    return nextResolve(specifier, context);
  }
});
