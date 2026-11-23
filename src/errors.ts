/**
 * Error formatting helpers. The original loader uses `@babel/code-frame`; the
 * lite loader only needs a tiny code-frame formatter so template/style/script
 * errors stay useful without pulling Babel into the bundle.
 */

export type SourceLocation = {
  line: number
  column?: number
}

export function formatError(message: string, filename: string, _source?: string): string {
  return `${filename}\n${message}`
}

/**
 * Format an error with a source excerpt.
 *
 * @param line 1-based line number
 * @param column 0-based column number (converted internally)
 */
export function formatErrorLineColumn(
  message: string,
  filename: string,
  source: string,
  line?: number,
  column?: number,
): string {
  if (!line || line < 1) return formatError(message, filename, source)

  const lines = source.split(/\r?\n/)
  const lineText = lines[line - 1]
  if (lineText === undefined) return formatError(message, filename, source)

  const column1 = typeof column === 'number' && column >= 0 ? column + 1 : 1
  const gutterWidth = String(line).length
  const gutter = ' '.repeat(gutterWidth)
  const caretOffset = Math.max(0, column1 - 1)

  return (
    `${filename}:${line}:${column1}\n` +
    `${gutter} | ${lineText}\n` +
    `${' '.repeat(gutterWidth)} | ${' '.repeat(caretOffset)}^\n` +
    `${message}`
  )
}

/** Convert an absolute character offset into a 1-based line / 0-based column. */
export function offsetToLineColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < safeOffset; i++) {
    if (source.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: safeOffset - lineStart }
}

/** Log a parser/compiler error that carries a `loc` ({ line, column }). */
export function formatLocatedError(
  message: string,
  filename: string,
  source: string,
  loc?: { start?: SourceLocation } | SourceLocation,
): string {
  if (!loc) return formatError(message, filename, source)
  const start = 'start' in loc && loc.start ? loc.start : (loc as SourceLocation)
  return formatErrorLineColumn(message, filename, source, start.line, start.column)
}
