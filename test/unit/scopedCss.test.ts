import { describe, expect, it } from 'vitest'
import { scopeCss } from '../../src/scopedCss'

const id = 'data-v-abc123'
const scope = (css: string) => scopeCss(css, id)

describe('scoped CSS', () => {
  it('scopes the last compound selector', () => {
    expect(scope('.a:hover { color:red }')).toBe('.a[data-v-abc123]:hover { color:red }')
    expect(scope('.a::before{content:""}')).toBe('.a[data-v-abc123]::before{content:""}')
    expect(scope('.a .b{color:red}')).toBe('.a .b[data-v-abc123]{color:red}')
    expect(scope('.a > .b{color:red}')).toBe('.a > .b[data-v-abc123]{color:red}')
    expect(scope('.a + .b:hover{color:red}')).toBe(
      '.a + .b[data-v-abc123]:hover{color:red}',
    )
    expect(scope('.a:not(.b){color:red}')).toBe(
      '.a[data-v-abc123]:not(.b){color:red}',
    )
  })

  it('scopes selector lists', () => {
    expect(scope('.a, .b{color:red}')).toBe(
      '.a[data-v-abc123], .b[data-v-abc123]{color:red}',
    )
  })

  it('handles :root, * and attribute selectors containing colons', () => {
    expect(scope(':root{--x:1}')).toBe('[data-v-abc123]:root{--x:1}')
    expect(scope('*{color:red}')).toBe('[data-v-abc123]{color:red}')
    expect(scope('[data-x=":"]{color:red}')).toBe(
      '[data-x=":"][data-v-abc123]{color:red}',
    )
  })

  it('scopes inside :is()/:where()/:not()/:has() when they start a compound', () => {
    expect(scope(':is(.a){color:red}')).toBe(':is(.a[data-v-abc123]){color:red}')
    expect(scope(':where(.a, .b){color:red}')).toBe(
      ':where(.a[data-v-abc123], .b[data-v-abc123]){color:red}',
    )
    expect(scope(':has(> .a){color:red}')).toBe(
      ':has(> .a[data-v-abc123]){color:red}',
    )
    expect(scope('.a:is(.b,.c){color:red}')).toBe(
      '.a[data-v-abc123]:is(.b,.c){color:red}',
    )
  })

  it('handles :deep()', () => {
    expect(scope('.a :deep(.b){color:red}')).toBe(
      '.a[data-v-abc123] .b{color:red}',
    )
    expect(scope('.a>:deep(.b){color:red}')).toBe(
      '.a[data-v-abc123] > .b{color:red}',
    )
    expect(scope('.a :deep(.b):hover{color:red}')).toBe(
      '.a[data-v-abc123] .b:hover{color:red}',
    )
    expect(scope(':deep(.b){color:red}')).toBe('.b{color:red}')
  })

  it('handles legacy deep combinators', () => {
    expect(scope('.a ::v-deep .b{color:red}')).toBe(
      '.a[data-v-abc123] .b{color:red}',
    )
    expect(scope('.a >>> .b{color:red}')).toBe('.a[data-v-abc123] .b{color:red}')
    expect(scope('.a /deep/ .b{color:red}')).toBe(
      '.a[data-v-abc123] .b{color:red}',
    )
  })

  it('handles :global()', () => {
    expect(scope(':global(.foo){color:red}')).toBe('.foo{color:red}')
    expect(scope('.a :global(.foo){color:red}')).toBe(
      '.a[data-v-abc123] .foo{color:red}',
    )
  })

  it('handles :slotted()', () => {
    expect(scope('.a :slotted(.b){color:red}')).toBe(
      '.a[data-v-abc123] .b[data-v-abc123-s]{color:red}',
    )
  })

  it('supports native nesting with &', () => {
    expect(scope('&:hover{color:red}')).toBe('&[data-v-abc123]:hover{color:red}')
    expect(scope('.a{ color:red; & .b { color: blue; } }')).toBe(
      '.a[data-v-abc123]{ color:red; & .b[data-v-abc123] { color: blue; } }',
    )
  })

  it('recurses into grouping at-rules but not @font-face/@page', () => {
    expect(scope('@media (min-width:1px){.a{color:red}}')).toBe(
      '@media (min-width:1px){.a[data-v-abc123]{color:red}}',
    )
    expect(scope('@supports (display:grid){.a{display:grid}}')).toBe(
      '@supports (display:grid){.a[data-v-abc123]{display:grid}}',
    )
    expect(scope('@font-face{font-family:"x";src:url(x.woff2)}')).toBe(
      '@font-face{font-family:"x";src:url(x.woff2)}',
    )
  })

  it('renames keyframes and rewrites animation declarations', () => {
    const input =
      '@keyframes fade{from{opacity:0}to{opacity:1}} .a{animation: fade 1s; animation-name: fade, slide} @media (x){@keyframes slide{to{opacity:0}}}'
    const output = scope(input)
    expect(output).toContain('@keyframes fade-abc123{')
    expect(output).toContain('animation: fade-abc123 1s')
    expect(output).toContain('animation-name: fade-abc123, slide-abc123')
    expect(output).toContain('@keyframes slide-abc123{')
  })

  it('does not modify expressions containing the word animation', () => {
    const input = '.a{animation-timing-function: ease-in; --my-animation: fade;}'
    expect(scope(input)).toBe(
      '.a[data-v-abc123]{animation-timing-function: ease-in; --my-animation: fade;}',
    )
  })

  it('does not rewrite custom properties that contain a keyframe name', () => {
    const input =
      '@keyframes fade{to{opacity:0}} .a{--my-animation: fade; animation: fade 1s; -webkit-animation-name: fade;}'
    const output = scope(input)
    expect(output).toContain('--my-animation: fade;')
    expect(output).toContain('animation: fade-abc123 1s;')
    expect(output).toContain('-webkit-animation-name: fade-abc123;')
  })

  it('preserves comments and whitespace around rules', () => {
    expect(scope('/* top */ .a { color:red }')).toBe(
      '/* top */ .a[data-v-abc123] { color:red }',
    )
  })

  it('leaves declarations and at-rules without blocks intact', () => {
    expect(scope('@import url("x.css");')).toBe('@import url("x.css");')
    expect(scope('@charset "utf-8";')).toBe('@charset "utf-8";')
  })
})
