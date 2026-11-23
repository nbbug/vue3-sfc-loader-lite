import {
  parse as parseSfc,
  compileTemplate,
  version as compilerVersion,
} from '@vue/compiler-sfc';
import * as CompilerDOM from '@vue/compiler-dom';
import type { SFCStyleBlock, SFCTemplateBlock } from '@vue/compiler-sfc';
import { withCache } from './cache';
import {
  formatError,
  formatErrorLineColumn,
  formatLocatedError,
} from './errors';
import { buildScopeId } from './hash';
import { createModuleUrl, importModule } from './moduleUrl';
import { rewriteModuleSpecifiers } from './lexer';
import { scopeCss } from './scopedCss';
import type { AbstractPath, Options, PathContext } from './types';
import { version as libVersion } from './version';

export type SFCCompilationContext = {
  options: Options;
  /** Resolve a module specifier relative to `refPath` to an importable URL. */
  resolveSpecifier(
    specifier: string,
    refPath: AbstractPath,
  ): Promise<string | null | undefined>;
  /** Load a text resource (used by `src="..."` attributes). */
  loadText(
    pathCx: PathContext,
  ): Promise<{ content: string; path: AbstractPath }>;
  /** Create the lazy dynamic-import helper binding for a module. */
  createDynamicImportSupport(refPath: AbstractPath): {
    helperName: string;
    getBindingSource: () => string;
  };
  /**
   * The Vue runtime (moduleCache entry for `vue`) used to evaluate the
   * function-mode template render function.
   */
  getVueRuntime(): Promise<any>;
};

export type SFCCompilationResult = {
  component: any;
  namespace: any;
  url: string;
};

const supportedScriptLangs = new Set([
  'js',
  'javascript',
  'mjs',
  'esm',
  'module',
]);

const unsupported = (what: string, filename: string, extra = ''): Error =>
  new Error(
    `[vue3-sfc-loader-lite] ${what} is not supported in "${filename}". ` +
      `The lite loader expects browser-ready ES modules for scripts and plain CSS for styles. ` +
      `Pre-compile this component or use the full vue3-sfc-loader.${extra ? ` ${extra}` : ''}`,
  );

const isText = (value: any): value is string => typeof value === 'string';

/**
 * `compileTemplate` always forces module mode + `prefixIdentifiers`, which
 * requires Babel's expression parser to rewrite identifiers. We do not ship
 * Babel, so compile in function mode instead: the generated render function
 * resolves bindings at runtime through `with (_ctx)`. The code is evaluated
 * with `new Function` (the same mechanism used by Vue's runtime compiler and
 * by the original vue3-sfc-loader).
 */
const functionModeCompiler = {
  ...CompilerDOM,
  compile(source: any, options: any = {}) {
    const {
      mode: _mode,
      prefixIdentifiers: _prefixIdentifiers,
      cacheHandlers: _cacheHandlers,
      scopeId: _scopeId,
      hmr: _hmr,
      ...rest
    } = options;
    return (CompilerDOM as any).compile(source, {
      ...rest,
      mode: 'function',
      prefixIdentifiers: false,
      cacheHandlers: false,
      scopeId: undefined,
      hmr: false,
    });
  },
};

const readStyle = async (
  style: SFCStyleBlock,
  filename: AbstractPath,
  context: SFCCompilationContext,
): Promise<{ content: string; path: AbstractPath }> => {
  if (style.src) {
    return await context.loadText({ refPath: filename, relPath: style.src });
  }
  return { content: style.content, path: filename };
};

const readTemplate = async (
  template: SFCTemplateBlock,
  filename: AbstractPath,
  context: SFCCompilationContext,
): Promise<{ content: string; path: AbstractPath }> => {
  if (template.src) {
    return await context.loadText({ refPath: filename, relPath: template.src });
  }
  return { content: template.content, path: filename };
};

const logSfcError = (
  options: Options,
  category: string,
  message: string,
  filename: string,
  source: string,
  loc?: { line?: number; column?: number },
): void => {
  if (loc && typeof loc.line === 'number') {
    options.log?.(
      'error',
      category,
      formatErrorLineColumn(message, filename, source, loc.line, loc.column),
    );
  } else {
    options.log?.('error', category, formatError(message, filename, source));
  }
};

/**
 * Compile one `.vue` SFC into an ES module and evaluate it.
 *
 * Scripts are used verbatim as ES modules (only import specifiers are
 * rewritten). Templates go through `@vue/compiler-sfc`'s `compileTemplate`.
 * Styles are plain CSS and are injected through `options.addStyle`.
 */
export async function createSFCModule(
  source: string,
  filename: AbstractPath,
  context: SFCCompilationContext,
): Promise<SFCCompilationResult> {
  const options = context.options;
  const strFilename = filename.toString();

  // ---------------------------------------------------------------------------
  // Parse
  // ---------------------------------------------------------------------------
  let descriptor;
  let errors;
  try {
    const parsed = parseSfc(source, {
      filename: strFilename,
      sourceMap: false,
    });
    descriptor = parsed.descriptor;
    errors = parsed.errors;
  } catch (error: any) {
    options.log?.(
      'error',
      'SFC parse',
      formatError(String(error?.message ?? error), strFilename, source),
    );
    throw error;
  }

  if (errors.length > 0) {
    // Keep going: some parse errors are recoverable and more precise errors
    // will be produced by compileTemplate / the script module. This also lets
    // the language checks below produce a clearer message for preprocessors.
    for (const error of errors) {
      if (typeof error === 'string') {
        options.log?.(
          'error',
          'SFC parse',
          formatError(error, strFilename, source),
        );
      } else {
        options.log?.(
          'error',
          'SFC parse',
          formatLocatedError(
            error.message,
            strFilename,
            source,
            (error as any).loc,
          ),
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Unsupported language features: fail early with a clear message.
  // ---------------------------------------------------------------------------
  if (descriptor.scriptSetup) {
    throw unsupported('<script setup>', strFilename);
  }

  const scriptLang = (descriptor.script?.lang ?? 'js').toLowerCase();
  if (descriptor.script && !supportedScriptLangs.has(scriptLang)) {
    throw unsupported(
      `the <script lang="${descriptor.script.lang}"> block`,
      strFilename,
      'Only plain JavaScript ES modules are accepted.',
    );
  }

  if (
    descriptor.template?.lang &&
    descriptor.template.lang.toLowerCase() !== 'html'
  ) {
    throw unsupported(
      `the <template lang="${descriptor.template.lang}"> block`,
      strFilename,
      'Only plain HTML templates are accepted.',
    );
  }

  for (const style of descriptor.styles) {
    const lang = (style.lang ?? 'css').toLowerCase();
    if (lang !== 'css') {
      throw unsupported(
        `the <style lang="${style.lang}"> block`,
        strFilename,
        'Only plain CSS is accepted.',
      );
    }
    if (style.module) {
      throw unsupported('CSS Modules (<style module>)', strFilename);
    }
  }

  const hasStyles = descriptor.styles.length > 0;
  if (hasStyles && !options.addStyle) {
    throw new ReferenceError(
      `[vue3-sfc-loader-lite] options.addStyle() is not defined but "${strFilename}" contains <style> blocks`,
    );
  }

  if (descriptor.cssVars.length > 0) {
    options.log?.(
      'warn',
      'SFC style',
      `"${strFilename}" uses v-bind() in CSS, which vue3-sfc-loader-lite does not support. ` +
        `The CSS will be injected as-is.`,
    );
  }

  const scopeId = buildScopeId(strFilename);
  const hasScoped = descriptor.styles.some((style) => style.scoped);

  // ---------------------------------------------------------------------------
  // Custom blocks (the callbacks run once the component exists)
  // ---------------------------------------------------------------------------
  let customBlockCallbacks: (((component: any) => void) | undefined)[] = [];
  if (options.customBlockHandler) {
    customBlockCallbacks = await Promise.all(
      descriptor.customBlocks.map((block) =>
        options.customBlockHandler!(block, filename, options),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Script block: already an ES module, only rewrite its import specifiers.
  // ---------------------------------------------------------------------------
  let scriptCode: string | undefined;
  let scriptRefPath: AbstractPath = filename;
  let scriptModuleUrl: string | undefined;

  if (descriptor.script) {
    if (descriptor.script.src) {
      const loaded = await context.loadText({
        refPath: filename,
        relPath: descriptor.script.src,
      });
      scriptCode = loaded.content;
      scriptRefPath = loaded.path;
    } else {
      scriptCode = descriptor.script.content;
    }

    try {
      const dynamicImport = context.createDynamicImportSupport(scriptRefPath);
      const rewritten = await rewriteModuleSpecifiers(
        scriptCode,
        scriptRefPath.toString(),
        (specifier) => context.resolveSpecifier(specifier, scriptRefPath),
        { dynamicImportHelper: dynamicImport.helperName },
      );
      const code = rewritten.usedDynamicImport
        ? `${dynamicImport.getBindingSource()}\n${rewritten.code}`
        : rewritten.code;
      scriptModuleUrl = createModuleUrl(code, `${strFilename}?script`);
    } catch (error: any) {
      options.log?.(
        'error',
        'SFC script',
        error?.message?.includes('Failed to parse ES module')
          ? error.message
          : formatError(
              String(error?.message ?? error),
              scriptRefPath.toString(),
              scriptCode,
            ),
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Template block: @vue/compiler-sfc compileTemplate in function mode.
  // ---------------------------------------------------------------------------
  let templateRender: ((...args: any[]) => any) | undefined;

  if (descriptor.template) {
    const loaded = await readTemplate(descriptor.template, filename, context);
    const templateFilename = loaded.path.toString();
    const templateSource = loaded.content;

    const compiledCode = await withCache(
      options.compiledCache,
      [
        libVersion,
        compilerVersion,
        'template-function',
        strFilename,
        templateFilename,
        templateSource,
        descriptor.slotted,
        !options.devMode,
        JSON.stringify({
          delimiters: options.delimiters,
          whitespace: options.whitespace,
          isCustomElement: options.isCustomElement
            ? String(options.isCustomElement)
            : '',
          // Assets keep their literal URLs; the lite loader does not import them.
          transformAssetUrls: false,
        }),
      ],
      async ({ preventCache }) => {
        let result;
        try {
          result = compileTemplate({
            source: templateSource,
            filename: templateFilename,
            id: scopeId,
            scoped: hasScoped,
            slotted: descriptor.slotted,
            isProd: !options.devMode,
            // Assets keep their literal URLs; the lite loader does not import them.
            transformAssetUrls: false,
            compiler: functionModeCompiler as any,
            compilerOptions: {
              sourceMap: false,
              isCustomElement: options.isCustomElement,
              whitespace: options.whitespace,
              delimiters: options.delimiters,
            },
          });
        } catch (error: any) {
          preventCache();
          options.log?.(
            'error',
            'SFC template',
            formatError(
              String(error?.message ?? error),
              templateFilename,
              templateSource,
            ),
          );
          throw error;
        }

        if (result.errors.length > 0) {
          preventCache();
          for (const error of result.errors) {
            if (typeof error === 'string') {
              options.log?.(
                'error',
                'SFC template',
                formatError(error, templateFilename, templateSource),
              );
            } else {
              const loc = (error as any).loc?.start ?? (error as any).loc;
              logSfcError(
                options,
                'SFC template',
                error.message,
                templateFilename,
                templateSource,
                loc,
              );
            }
          }
          throw new Error(
            `[vue3-sfc-loader-lite] failed to compile the template of "${strFilename}" (${result.errors.length} error(s))`,
          );
        }

        for (const tip of result.tips) {
          options.log?.('info', 'SFC template', tip);
        }

        if (!isText(result.code)) {
          preventCache();
          throw new Error(
            `[vue3-sfc-loader-lite] compileTemplate produced no code for "${strFilename}"`,
          );
        }

        return result.code;
      },
      options.log,
    );

    try {
      const vueRuntime = await context.getVueRuntime();
      // The generated code ends with `return function render(...) {...}`.
      // `new Function` is deliberately sloppy-mode because function-mode
      // templates use `with (_ctx)`, which is illegal in strict ES modules.
      // eslint-disable-next-line no-new-func
      const render = new Function('Vue', compiledCode)(vueRuntime);
      if (typeof render !== 'function') {
        throw new Error(
          'the compiled template did not return a render function',
        );
      }
      templateRender = render;
    } catch (error: any) {
      options.log?.(
        'error',
        'SFC template',
        formatError(
          `Failed to evaluate the template render function for "${strFilename}": ${String(
            error?.message ?? error,
          )}. Function-mode templates use new Function(); a Content-Security-Policy without 'unsafe-eval' will block them.`,
          templateFilename,
          templateSource,
        ),
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Facade module: attach render/scope metadata to the script's default export.
  // ---------------------------------------------------------------------------
  const facadeLines: string[] = [];

  if (scriptModuleUrl) {
    facadeLines.push(
      `import * as __script_ns__ from ${JSON.stringify(scriptModuleUrl)};`,
    );
  }

  const scriptSource = scriptModuleUrl ? '__script_ns__.default' : 'null';
  facadeLines.push(
    `const __base__ = ${scriptSource};`,
    `const __component__ = __base__ && (typeof __base__ === 'object' || typeof __base__ === 'function')`,
    `  ? (Object.isExtensible(__base__) ? __base__ : Object.assign({}, __base__))`,
    `  : {};`,
  );

  facadeLines.push(`__component__.__file = ${JSON.stringify(strFilename)};`);
  if (hasScoped) {
    facadeLines.push(`__component__.__scopeId = ${JSON.stringify(scopeId)};`);
  }
  facadeLines.push(`export default __component__;`);
  if (scriptModuleUrl) {
    facadeLines.push(`export * from ${JSON.stringify(scriptModuleUrl)};`);
  }

  const facadeUrl = createModuleUrl(
    facadeLines.join('\n'),
    `${strFilename}?sfc`,
  );

  let namespace: any;
  try {
    namespace = await importModule(facadeUrl);
  } catch (error: any) {
    options.log?.(
      'error',
      'SFC module',
      formatError(
        `Failed to evaluate "${strFilename}": ${String(error?.message ?? error)}`,
        strFilename,
        source,
      ),
    );
    throw error;
  }

  const component = namespace.default;

  if (templateRender) {
    component.render = templateRender;
  }

  // ---------------------------------------------------------------------------
  // Styles: plain CSS, optionally scoped by the lite CSS transformer.
  // ---------------------------------------------------------------------------
  if (hasStyles) {
    for (const style of descriptor.styles) {
      const loaded = await readStyle(style, filename, context);
      let css = loaded.content;

      if (style.scoped) {
        css = await withCache(
          options.compiledCache,
          [libVersion, 'scoped-css', scopeId, css],
          async () => scopeCss(css, scopeId),
          options.log,
        );
      }

      options.addStyle!(css.trim(), style.scoped ? scopeId : undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Custom blocks
  // ---------------------------------------------------------------------------
  if (customBlockCallbacks.length > 0) {
    await Promise.all(
      customBlockCallbacks.map((callback) => callback?.(component)),
    );
  }

  return { component, namespace, url: facadeUrl };
}
