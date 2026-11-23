/**
 * A small, dependency-free scoped CSS transformer.
 *
 * Vue's own `compileStyle` uses PostCSS. The lite loader intentionally avoids
 * PostCSS (and therefore style preprocessors), so scoped styles are handled by
 * this focused rewriter. It covers the constructs emitted by low-code
 * generators and normal hand-written CSS:
 *
 *  - selector lists, combinators, pseudo classes/elements
 *  - `:deep()`, `::v-deep`, `>>>`, `/deep/`, `:global()`, `:slotted()`
 *  - nested `@media`, `@supports`, `@layer`, `@container`
 *  - scoped `@keyframes` renaming + `animation` / `animation-name` rewriting
 *
 * CSS Modules, `v-bind()` in CSS and full CSS validation are not supported.
 */

const isWhitespace = (char: string): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f'

const skipString = (input: string, start: number): number => {
  const quote = input[start]
  let i = start + 1
  while (i < input.length) {
    const char = input[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === quote) return i + 1
    i++
  }
  return input.length
}

const skipComment = (input: string, start: number): number => {
  const end = input.indexOf('*/', start + 2)
  return end === -1 ? input.length : end + 2
}

/** Skip a balanced pair, e.g. from `(` to after `)`. */
const skipBalanced = (input: string, start: number, open: string, close: string): number => {
  let depth = 0
  let i = start
  while (i < input.length) {
    const char = input[i]
    if (char === '/' && input[i + 1] === '*') {
      i = skipComment(input, i)
      continue
    }
    if (char === '"' || char === "'") {
      i = skipString(input, i)
      continue
    }
    if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return input.length
}

const findMatchingBrace = (input: string, openIndex: number): number => {
  let depth = 0
  let i = openIndex
  while (i < input.length) {
    const char = input[i]
    if (char === '/' && input[i + 1] === '*') {
      i = skipComment(input, i)
      continue
    }
    if (char === '"' || char === "'") {
      i = skipString(input, i)
      continue
    }
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return input.length
}

/** Split on a separator at the top level (outside strings, comments, brackets). */
const splitTopLevel = (input: string, separator: string): string[] => {
  const parts: string[] = []
  let start = 0
  let i = 0
  while (i < input.length) {
    const char = input[i]
    if (char === '/' && input[i + 1] === '*') {
      i = skipComment(input, i)
      continue
    }
    if (char === '"' || char === "'") {
      i = skipString(input, i)
      continue
    }
    if (char === '(') {
      i = skipBalanced(input, i, '(', ')')
      continue
    }
    if (char === '[') {
      i = skipBalanced(input, i, '[', ']')
      continue
    }
    if (char === separator) {
      parts.push(input.slice(start, i))
      start = i + 1
    }
    i++
  }
  parts.push(input.slice(start))
  return parts
}

const unquote = (value: string): string => {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') ||
      (trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const collectKeyframeNames = (css: string): Set<string> => {
  const names = new Set<string>()
  const regex = /@(?:-\w+-)?keyframes\s+([^\s{]+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(css))) {
    const name = unquote(match[1])
    if (name) names.add(name)
  }
  return names
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const rewriteAnimationDeclarations = (
  statement: string,
  keyframeNames: Set<string>,
  suffix: string,
): string => {
  if (keyframeNames.size === 0) return statement

  return statement.replace(
    /(^|[;{])(\s*(?:-\w+-)?animation(?:-name)?\s*:\s*)([^;}]+)/gi,
    (_whole, lead: string, property: string, value: string) => {
      let rewritten = value
      for (const name of keyframeNames) {
        const regex = new RegExp(
          `(^|[\\s,])${escapeRegExp(name)}(?=[\\s,]|$)`,
          'g',
        )
        rewritten = rewritten.replace(regex, `$1${name}-${suffix}`)
      }
      return lead + property + rewritten
    },
  )
}

type SpecialMarker = {
  index: number
  kind: 'deep' | 'slotted' | 'global'
  innerStart: number
  innerEnd: number
  restStart: number
}

const SPECIAL_MARKERS: { text: string; kind: SpecialMarker['kind'] }[] = [
  { text: ':deep(', kind: 'deep' },
  { text: ':v-deep(', kind: 'deep' },
  { text: '::v-deep(', kind: 'deep' },
  { text: ':slotted(', kind: 'slotted' },
  { text: ':global(', kind: 'global' },
]

/** Find the earliest top-level `:deep(...)`, `:slotted(...)` or `:global(...)`. */
const findSpecialMarker = (selector: string): SpecialMarker | null => {
  let i = 0
  while (i < selector.length) {
    const char = selector[i]
    if (char === '/' && selector[i + 1] === '*') {
      i = skipComment(selector, i)
      continue
    }
    if (char === '"' || char === "'") {
      i = skipString(selector, i)
      continue
    }
    if (char === '[') {
      i = skipBalanced(selector, i, '[', ']')
      continue
    }
    if (char === '(') {
      i = skipBalanced(selector, i, '(', ')')
      continue
    }
    if (char === ':') {
      for (const marker of SPECIAL_MARKERS) {
        if (selector.startsWith(marker.text, i)) {
          const openParen = i + marker.text.length - 1
          const afterClose = skipBalanced(selector, openParen, '(', ')')
          return {
            index: i,
            kind: marker.kind,
            innerStart: openParen + 1,
            innerEnd: Math.max(openParen + 1, afterClose - 1),
            restStart: afterClose,
          }
        }
      }
    }
    i++
  }
  return null
}

/** Find a legacy deep combinator (`>>>`, `/deep/`, `::v-deep` without parens). */
const findLegacyDeep = (
  selector: string,
): { index: number; length: number } | null => {
  let i = 0
  while (i < selector.length) {
    const char = selector[i]
    if (char === '/' && selector[i + 1] === '*') {
      i = skipComment(selector, i)
      continue
    }
    if (char === '"' || char === "'") {
      i = skipString(selector, i)
      continue
    }
    if (char === '[') {
      i = skipBalanced(selector, i, '[', ']')
      continue
    }
    if (char === '(') {
      i = skipBalanced(selector, i, '(', ')')
      continue
    }
    if (selector.startsWith('>>>', i)) return { index: i, length: 3 }
    if (selector.startsWith('/deep/', i)) return { index: i, length: 6 }
    if (
      selector.startsWith('::v-deep', i) &&
      selector[i + 8] !== '(' // handled by findSpecialMarker
    ) {
      return { index: i, length: 8 }
    }
    i++
  }
  return null
}

/** Split `.a > .b:hover` into `{ prefix: '.a > ', compound: '.b:hover' }`. */
const splitLastCompound = (selector: string): { prefix: string; compound: string } => {
  let lastSeparatorEnd = 0
  let i = 0
  while (i < selector.length) {
    const char = selector[i]
    if (char === '/' && selector[i + 1] === '*') {
      i = skipComment(selector, i)
      continue
    }
    if (char === '"' || char === "'") {
      i = skipString(selector, i)
      continue
    }
    if (char === '[') {
      i = skipBalanced(selector, i, '[', ']')
      continue
    }
    if (char === '(') {
      i = skipBalanced(selector, i, '(', ')')
      continue
    }
    if (char === '>' || char === '+' || char === '~') {
      lastSeparatorEnd = i + 1
    } else if (isWhitespace(char)) {
      lastSeparatorEnd = i + 1
    }
    i++
  }

  const prefix = selector.slice(0, lastSeparatorEnd)
  const compound = selector.slice(lastSeparatorEnd).trim()
  return { prefix, compound }
}

/** Find the first pseudo (`:`) of a compound selector at top level. */
const findPseudoStart = (compound: string): number => {
  let i = 0
  while (i < compound.length) {
    const char = compound[i]
    if (char === '/' && compound[i + 1] === '*') {
      i = skipComment(compound, i)
      continue
    }
    if (char === '"' || char === "'") {
      i = skipString(compound, i)
      continue
    }
    if (char === '[') {
      i = skipBalanced(compound, i, '[', ']')
      continue
    }
    if (char === '(') {
      i = skipBalanced(compound, i, '(', ')')
      continue
    }
    if (char === ':') return i
    i++
  }
  return -1
}

const scopeFunctionalPseudo = (compound: string, attr: string): string | null => {
  const match = /^:(is|where|not|has)\(/i.exec(compound)
  if (!match) return null
  const openParen = match[0].length - 1
  const afterClose = skipBalanced(compound, openParen, '(', ')')
  // Only rewrite when the functional pseudo spans the entire compound.
  if (afterClose !== compound.length) return null
  const inner = compound.slice(openParen + 1, afterClose - 1)
  const scopedInner = splitTopLevel(inner, ',')
    .map((part) => scopeSelector(part.trim(), attr))
    .join(', ')
  return `:${match[1]}(${scopedInner})`
}

const scopeSelector = (selector: string, attr: string, slottedAttr?: string): string => {
  const trimmed = selector.trim()
  if (trimmed === '') return selector

  const marker = findSpecialMarker(trimmed)
  if (marker) {
    const prefix = trimmed.slice(0, marker.index)
    const inner = trimmed.slice(marker.innerStart, marker.innerEnd)
    const rest = trimmed.slice(marker.restStart)
    const scopedPrefix = scopeCombinatorPrefix(prefix, attr, slottedAttr)
    if (marker.kind === 'slotted') {
      const scopedInner = splitTopLevel(inner, ',')
        .map((part) => scopeSelector(part.trim(), slottedAttr ?? attr))
        .join(', ')
      return `${scopedPrefix}${scopedInner}${rest}`
    }
    // :deep() and :global() content is intentionally not scoped.
    return `${scopedPrefix}${inner}${rest}`
  }

  const legacyDeep = findLegacyDeep(trimmed)
  if (legacyDeep) {
    const prefix = trimmed.slice(0, legacyDeep.index)
    const rest = trimmed.slice(legacyDeep.index + legacyDeep.length)
    const scopedPrefix = scopeCombinatorPrefix(prefix, attr, slottedAttr)
    return `${scopedPrefix}${rest.trim()}`
  }

  const { prefix, compound } = splitLastCompound(trimmed)
  if (compound === '') return trimmed

  let scopedCompound: string
  if (compound === '*') {
    scopedCompound = attr
  } else {
    const functional = scopeFunctionalPseudo(compound, attr)
    if (functional !== null) {
      scopedCompound = functional
    } else {
      const pseudoStart = findPseudoStart(compound)
      scopedCompound =
        pseudoStart === -1
          ? compound + attr
          : compound.slice(0, pseudoStart) + attr + compound.slice(pseudoStart)
    }
  }

  return `${prefix}${scopedCompound}`
}

/**
 * Scope the part of a selector before a `:deep`/`:global`/`:slotted` marker,
 * taking care of a trailing combinator (`[>+~]`).
 */
const scopeCombinatorPrefix = (
  prefix: string,
  attr: string,
  slottedAttr?: string,
): string => {
  let trimmed = prefix.trim()
  if (trimmed === '') return ''

  let combinator = ''
  const match = /([>+~])\s*$/.exec(trimmed)
  if (match) {
    combinator = match[1]
    trimmed = trimmed.slice(0, match.index).trim()
  }

  const scoped = trimmed
    ? splitTopLevel(trimmed, ',')
        .map((part) => scopeSelector(part.trim(), attr, slottedAttr))
        .join(', ')
    : ''

  return `${scoped}${combinator ? ` ${combinator}` : ''} `
}

const scopeSelectorList = (selectorList: string, attr: string, slottedAttr: string): string =>
  splitTopLevel(selectorList, ',')
    .map((part) => scopeSelector(part.trim(), attr, slottedAttr))
    .join(', ')

const GROUPING_AT_RULES = new Set([
  'media',
  'supports',
  'container',
  'layer',
  'document',
  'starting-style',
])

const RENAME_KEYFRAMES_RE = /^@(-(?:webkit|moz|o)-)?keyframes\s+(.+)$/i

const splitLeadingTrivia = (input: string): { leading: string; rest: string } => {
  let i = 0
  for (;;) {
    while (i < input.length && isWhitespace(input[i])) i++
    if (input[i] === '/' && input[i + 1] === '*') {
      i = skipComment(input, i)
      continue
    }
    break
  }
  return { leading: input.slice(0, i), rest: input.slice(i) }
}

/**
 * Apply a scope ID to a plain CSS string.
 */
export function scopeCss(css: string, scopeId: string): string {
  const attr = `[${scopeId}]`
  const slottedAttr = `[${scopeId}-s]`
  const suffix = scopeId.replace(/^data-v-/, '')
  const keyframeNames = collectKeyframeNames(css)

  const processBlock = (input: string): string => {
    let output = ''
    let i = 0
    let statementStart = 0

    while (i < input.length) {
      const char = input[i]

      if (char === '/' && input[i + 1] === '*') {
        i = skipComment(input, i)
        continue
      }
      if (char === '"' || char === "'") {
        i = skipString(input, i)
        continue
      }
      if (char === '(') {
        i = skipBalanced(input, i, '(', ')')
        continue
      }
      if (char === '[') {
        i = skipBalanced(input, i, '[', ']')
        continue
      }

      if (char === ';') {
        output += rewriteAnimationDeclarations(
          input.slice(statementStart, i + 1),
          keyframeNames,
          suffix,
        )
        i++
        statementStart = i
        continue
      }

      if (char === '{') {
        const rawPrelude = input.slice(statementStart, i)
        const closeBrace = findMatchingBrace(input, i)
        const inner = input.slice(i + 1, closeBrace)
        const { leading, rest } = splitLeadingTrivia(rawPrelude)
        const trailingMatch = /\s*$/.exec(rest)
        const trailing = trailingMatch ? trailingMatch[0] : ''
        const prelude = rest.trim()

        if (prelude === '') {
          output += `${leading}${trailing}{${processBlock(inner)}}`
        } else if (prelude[0] === '@') {
          const atRuleMatch = /^@([-\w]+)/.exec(prelude)
          const atRule = atRuleMatch ? atRuleMatch[1].toLowerCase() : ''

          const keyframesMatch = RENAME_KEYFRAMES_RE.exec(prelude)
          if (keyframesMatch) {
            const name = unquote(keyframesMatch[2].trim())
            const renamed = `${name}-${suffix}`
            output += `${leading}@${keyframesMatch[1] ?? ''}keyframes ${renamed}${trailing}{${inner}}`
          } else if (GROUPING_AT_RULES.has(atRule)) {
            output += `${leading}${prelude}${trailing}{${processBlock(inner)}}`
          } else {
            // @font-face, @page, @property, @scope, unknown at-rules: keep as is.
            output += `${leading}${prelude}${trailing}{${inner}}`
          }
        } else {
          output += `${leading}${scopeSelectorList(prelude, attr, slottedAttr)}${trailing}{${processBlock(inner)}}`
        }

        i = closeBrace + 1
        statementStart = i
        continue
      }

      i++
    }

    output += rewriteAnimationDeclarations(input.slice(statementStart), keyframeNames, suffix)
    return output
  }

  return processBlock(css)
}
