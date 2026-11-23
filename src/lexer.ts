import { init, parse as lexParse } from 'es-module-lexer/minimal/js'
import type { ImportSpecifier } from 'es-module-lexer/minimal'
import { formatErrorLineColumn, offsetToLineColumn } from './errors'

let lexerReady: Promise<void> | undefined

export function ensureLexer(): Promise<void> {
  if (!lexerReady) lexerReady = init()
  return lexerReady
}

/** A normalized import. */
export type ModuleImport = {
  specifier: string | undefined
  kind: 'static' | 'dynamic'
  /** es-module-lexer numeric type (2 = dynamic import()). */
  importType: number
  start: number
  end: number
  statementStart: number
  statementEnd: number
}

/**
 * Parse an ES module and return its import metadata.
 *
 * This is the only "transpilation-adjacent" dependency: es-module-lexer does
 * not transform code, it only locates module syntax so specifiers can be
 * rewritten to runtime module URLs. The minimal build only exposes imports
 * (which is all the lite loader needs).
 */
export async function parseModuleImports(
  source: string,
  filename: string,
): Promise<ModuleImport[]> {
  await ensureLexer()

  let imports: readonly ImportSpecifier[]
  try {
    ;[imports] = lexParse(source)
  } catch (error: any) {
    const idx = typeof error?.idx === 'number' ? error.idx : 0
    const { line, column } = offsetToLineColumn(source, idx)
    throw new Error(
      formatErrorLineColumn(
        `Failed to parse ES module: ${error?.message ?? String(error)}`,
        filename,
        source,
        line,
        column,
      ),
    )
  }

  const result: ModuleImport[] = []
  for (const imp of imports) {
    if (imp.d === -2) continue // import.meta
    result.push({
      specifier: imp.n,
      kind: imp.d >= 0 ? 'dynamic' : 'static',
      importType: imp.t,
      start: imp.s,
      end: imp.e,
      statementStart: imp.ss,
      statementEnd: imp.se,
    })
  }
  return result
}

export type SpecifierKind = 'static' | 'dynamic'

export type SpecifierResolver = (
  specifier: string,
  kind: SpecifierKind,
  info: ModuleImport,
) => Promise<string | null | undefined> | string | null | undefined

export type RewriteResult = {
  code: string
  deps: string[]
  usedDynamicImport: boolean
}

const escapeForQuote = (value: string, quote: string): string => {
  const escapedBackslash = value.replace(/\\/g, '\\\\')
  return quote === "'"
    ? escapedBackslash.replace(/'/g, "\\'")
    : escapedBackslash.replace(/"/g, '\\"')
}

/**
 * Rewrite every statically-known module specifier in `source`.
 *
 * The source itself is never transpiled; only the string spans of import
 * specifiers are replaced with runtime module URLs (blob/data URLs or shims).
 */
export async function rewriteModuleSpecifiers(
  source: string,
  filename: string,
  resolveSpecifier: SpecifierResolver,
  options: { dynamicImportHelper?: string } = {},
): Promise<RewriteResult> {
  const imports = await parseModuleImports(source, filename)
  const replacements: { start: number; end: number; text: string }[] = []
  const deps: string[] = []
  let usedDynamicImport = false

  for (const imp of imports) {
    // Runtime dynamic imports are rewritten to a helper call so they are
    // resolved lazily (and can be computed/variable/recursive). The helper is
    // injected at the top of the module by the caller.
    if (
      imp.kind === 'dynamic' &&
      imp.importType === 2 &&
      options.dynamicImportHelper
    ) {
      const argument = source.slice(imp.start, imp.end)
      if (argument.trim() === '') continue
      usedDynamicImport = true
      replacements.push({
        start: imp.statementStart,
        end: imp.statementEnd,
        text: `${options.dynamicImportHelper}(${argument})`,
      })
      continue
    }

    if (imp.specifier === undefined || imp.specifier === null) continue

    const specifier = imp.specifier
    deps.push(specifier)
    const resolved = await resolveSpecifier(specifier, imp.kind, imp)
    if (resolved === undefined || resolved === null) continue

    if (resolved === specifier) continue

    const raw = source.slice(imp.start, imp.end)
    const isQuotedLiteral =
      raw.length >= 2 &&
      (raw[0] === "'" || raw[0] === '"') &&
      raw[raw.length - 1] === raw[0]
    const isTemplateLiteral = raw[0] === '`'

    if (isQuotedLiteral) {
      // Dynamic imports include their quotes in start/end.
      const quote = raw[0]
      replacements.push({
        start: imp.start,
        end: imp.end,
        text: `${quote}${escapeForQuote(resolved, quote)}${quote}`,
      })
    } else if (isTemplateLiteral) {
      replacements.push({
        start: imp.start,
        end: imp.end,
        text: `"${escapeForQuote(resolved, '"')}"`,
      })
    } else {
      // Static imports only span the specifier contents; the quotes live just
      // outside the span. Escape for that quote so a data URL containing `'`
      // cannot terminate the string literal.
      const quoteBefore = source[imp.start - 1]
      const quoteAfter = source[imp.end]
      const outerQuote =
        quoteBefore === quoteAfter && (quoteBefore === "'" || quoteBefore === '"')
          ? quoteBefore
          : ''
      replacements.push({
        start: imp.start,
        end: imp.end,
        text: outerQuote ? escapeForQuote(resolved, outerQuote) : resolved,
      })
    }
  }

  // Replace from the end so earlier offsets stay valid.
  replacements.sort((a, b) => b.start - a.start)
  let code = source
  for (const replacement of replacements) {
    code =
      code.slice(0, replacement.start) + replacement.text + code.slice(replacement.end)
  }

  return { code, deps, usedDynamicImport }
}
