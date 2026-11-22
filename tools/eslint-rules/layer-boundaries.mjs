// Local ESLint rule `layer-boundaries/imports` (spec 00 FR-011–FR-020, architecture §4.1).
//
// Resolves every static import specifier (`import …`, `import type …`, `export … from …`) to a
// project-root-relative path — relative specifiers against the importing file's folder, `@/…`
// against the root — and checks it against the matrix passed as options (see eslint.config.mjs).
// The target file does not need to exist. Dynamic `import()` and `require()` are not checked.
import path from 'node:path';

/**
 * @typedef {{ layers: string[], config: boolean, externals?: string[] }} LayerPolicy
 *   `layers`: other layers it may import (its own layer is always allowed).
 *   `config`: whether it may import `src/config`.
 *   `externals`: allowlist of bare modules (subpaths included); omitted = any bare module.
 * @typedef {{
 *   srcDir: string,
 *   configModule: string,
 *   layers: Record<string, LayerPolicy>,
 *   io: { modules: string[], allowedIn: string[] },
 *   ui: { dir: string, exclude: string[], typeOnlyFrom: string[] },
 * }} Options
 */

const toPosix = (p) => p.split(path.sep).join('/');

/** `spec` equals `name` or is a subpath of it (`zod/v4` matches `zod`; `zod-x` does not). */
const matchesModule = (spec, name) => spec === name || spec.startsWith(`${name}/`);

/** `p` is `dir` itself or inside it. */
const isWithin = (p, dir) => p === dir || p.startsWith(`${dir}/`);

/** Root-relative posix path of an internal specifier, or null for a bare module. */
function resolveSpecifier(spec, fileRel) {
  if (spec.startsWith('@/')) return path.posix.normalize(spec.slice(2));
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), spec));
  }
  return null;
}

/** Classifies a root-relative path: `config`, `layer` (with name), `src` (other) or `outside`. */
function classify(p, opts) {
  const config = `${opts.srcDir}/${opts.configModule}`;
  if (p === config || p.startsWith(`${config}.`)) return { kind: 'config' };
  if (!isWithin(p, opts.srcDir) || p === opts.srcDir) return { kind: 'outside' };
  const layer = p.slice(opts.srcDir.length + 1).split('/')[0];
  return Object.hasOwn(opts.layers, layer) ? { kind: 'layer', layer } : { kind: 'src' };
}

/** True when the declaration only imports/exports types. */
function isTypeOnly(node) {
  if (node.importKind === 'type' || node.exportKind === 'type') return true;
  const specs = node.specifiers ?? [];
  return specs.length > 0 && specs.every((s) => s.importKind === 'type' || s.exportKind === 'type');
}

/** @type {import('eslint').Rule.RuleModule} */
export const importsRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce architecture §4.1 layer boundaries on static imports' },
    schema: [{ type: 'object' }],
    messages: {
      layer: "'{{from}}' may not import from layer '{{to}}' ('{{spec}}').",
      config: "'{{from}}' may not import src/config ('{{spec}}').",
      external: "Core layer '{{from}}' may not import '{{spec}}' (allowed: {{allowed}}).",
      io: "Only {{allowedIn}} may import '{{spec}}' (filesystem / Blob SDK).",
      uiValue: "UI files may only use 'import type' from src ('{{spec}}').",
      uiTarget: "UI files may only import types from {{allowed}} ('{{spec}}').",
    },
  },
  create(context) {
    /** @type {Options} */
    const opts = context.options[0];
    const fileRel = toPosix(path.relative(context.cwd, context.filename));
    const inSrc = isWithin(fileRel, opts.srcDir);
    const inUi =
      isWithin(fileRel, opts.ui.dir) && !opts.ui.exclude.some((d) => isWithin(fileRel, d));
    if (!inSrc && !inUi) return {};

    const fromLayer = inSrc ? fileRel.slice(opts.srcDir.length + 1).split('/')[0] : null;
    const policy =
      fromLayer && Object.hasOwn(opts.layers, fromLayer) ? opts.layers[fromLayer] : null;
    const layerDir = (l) => `${opts.srcDir}/${l}`;
    // Shown in messages: the layer folder (`src/engine`) or, outside any layer, the file itself.
    const fromName = policy ? layerDir(fromLayer) : fileRel;

    function checkSrc(node, spec) {
      const report = (messageId, data) =>
        context.report({ node: node.source, messageId, data: { spec, from: fromName, ...data } });
      const resolved = resolveSpecifier(spec, fileRel);

      if (resolved === null) {
        if (opts.io.modules.some((m) => matchesModule(spec, m))) {
          if (!opts.io.allowedIn.includes(fromLayer)) {
            report('io', { allowedIn: opts.io.allowedIn.map(layerDir).join(', ') });
            return;
          }
        }
        if (policy?.externals && !policy.externals.some((m) => matchesModule(spec, m))) {
          report('external', { allowed: policy.externals.join(', ') });
        }
        return;
      }

      const target = classify(resolved, opts);
      if (target.kind === 'config' && policy && !policy.config) report('config');
      if (target.kind !== 'layer' || target.layer === fromLayer) return;
      // Files in src outside any declared layer (e.g. src/config.ts) may import any layer except
      // `service`, which nothing in src imports (BR-002).
      const allowed = policy
        ? policy.layers
        : Object.keys(opts.layers).filter((l) => l !== 'service');
      if (!allowed.includes(target.layer)) report('layer', { to: layerDir(target.layer) });
    }

    function checkUi(node, spec) {
      const resolved = resolveSpecifier(spec, fileRel);
      if (resolved === null) return;
      const target = classify(resolved, opts);
      if (target.kind === 'outside') return;
      const report = (messageId, data) =>
        context.report({ node: node.source, messageId, data: { spec, ...data } });
      if (target.kind !== 'layer' || !opts.ui.typeOnlyFrom.includes(target.layer)) {
        report('uiTarget', { allowed: opts.ui.typeOnlyFrom.map(layerDir).join(', ') });
      } else if (!isTypeOnly(node)) {
        report('uiValue');
      }
    }

    const check = (node) => {
      if (!node.source || typeof node.source.value !== 'string') return;
      (inSrc ? checkSrc : checkUi)(node, node.source.value);
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

export default { meta: { name: 'layer-boundaries' }, rules: { imports: importsRule } };
