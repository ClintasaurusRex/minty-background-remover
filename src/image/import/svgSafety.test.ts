import { describe, expect, it } from 'vitest'
import {
  SVG_NAMESPACE,
  type ParsedSvg,
  type SvgElementLike,
  analyseSvg,
  checkSvgMarkup,
  isAllowedReference,
} from './svgSafety'

const XHTML = 'http://www.w3.org/1999/xhtml'

interface FakeOptions {
  namespace?: string | null
  text?: string
}

/** Minimal stand-in for a DOM Element. */
function el(
  localName: string,
  attributes: Record<string, string> = {},
  children: SvgElementLike[] = [],
  { namespace = SVG_NAMESPACE, text }: FakeOptions = {},
): SvgElementLike {
  return {
    localName,
    namespaceURI: namespace,
    textContent: text ?? null,
    children,
    getAttributeNames: () => Object.keys(attributes),
    getAttribute: (name) => attributes[name] ?? null,
  }
}

function svg(children: SvgElementLike[] = [], attributes: Record<string, string> = { viewBox: '0 0 10 10' }): ParsedSvg {
  return { root: el('svg', attributes, children), processingInstructions: [], hasDoctype: false }
}

function rejectionOf(parsed: ParsedSvg) {
  const result = analyseSvg(parsed)
  return result.ok ? null : result.error
}

describe('analyseSvg', () => {
  it('accepts ordinary drawing content and returns the root size attributes', () => {
    const parsed = svg(
      [
        el('defs', {}, [
          el('linearGradient', { id: 'g' }, [el('stop', { offset: '0', 'stop-color': '#fff' })]),
          el('clipPath', { id: 'c' }, [el('rect', { width: '5', height: '5' })]),
        ]),
        el('g', { 'clip-path': 'url(#c)' }, [
          el('path', { d: 'M0 0L10 10', fill: 'url(#g)', stroke: 'url("#g")', style: 'opacity: 0.5' }),
          el('use', { href: '#c' }),
          el('use', { 'xlink:href': '#c' }),
          el('text', {}, [], { text: 'Pump station' }),
        ]),
        el('style', {}, [], { text: '.a { fill: url(#g); }' }),
        // Editor metadata in other namespaces is harmless.
        el('namedview', { 'inkscape:zoom': '1' }, [], { namespace: 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd' }),
      ],
      { width: '24', height: '24px', viewBox: '0 0 24 24' },
    )
    expect(analyseSvg(parsed)).toEqual({
      ok: true,
      sizeAttributes: { width: '24', height: '24px', viewBox: '0 0 24 24' },
    })
  })

  it('returns null size attributes when they are absent', () => {
    expect(analyseSvg(svg([], {}))).toEqual({
      ok: true,
      sizeAttributes: { width: null, height: null, viewBox: null },
    })
  })

  it('allows embedded raster data images in links and url()', () => {
    for (const data of [
      'data:image/png;base64,iVBORw0KGgo=',
      'data:image/jpeg;base64,/9j/',
      'data:image/jpg;base64,/9j/',
      'data:image/gif;base64,R0lGOD',
      ' DATA:IMAGE/WEBP;base64,UklGRg== ',
    ]) {
      expect(rejectionOf(svg([el('image', { href: data })]))).toBeNull()
      expect(rejectionOf(svg([el('image', { 'xlink:href': data })]))).toBeNull()
      expect(rejectionOf(svg([el('rect', { fill: `url("${data.trim()}")` })]))).toBeNull()
      expect(rejectionOf(svg([el('style', {}, [], { text: `.a { fill: url(${data.trim()}) }` })]))).toBeNull()
    }
  })

  it('rejects embedded SVG data in links and url()', () => {
    for (const data of ['data:image/svg+xml,%3Csvg%3E', 'data:image/svg+xml;base64,PHN2Zz4=', 'DATA:IMAGE/SVG+XML;utf8,<svg/>']) {
      const cases = [
        el('image', { href: data }),
        el('image', { 'xlink:href': data }),
        el('feImage', { href: data }),
        el('use', { href: data }),
        el('rect', { fill: `url("${data}")` }),
        el('rect', { style: `fill: url('${data}')` }),
        el('style', {}, [], { text: `.a { fill: url(${data}) }` }),
      ]
      for (const element of cases) {
        expect(rejectionOf(svg([element]))?.code).toBe('svg-unsupported-content')
      }
    }
  })

  it('rejects a parsed document with a DOCTYPE', () => {
    expect(rejectionOf({ ...svg(), hasDoctype: true })?.code).toBe('svg-unsupported-content')
  })

  it('rejects a root that is not an SVG element as invalid', () => {
    const html = { ...svg(), root: el('html', {}, [], { namespace: XHTML }) }
    expect(rejectionOf(html)?.code).toBe('decode-failed')
    const noNamespace = { ...svg(), root: el('svg', {}, [], { namespace: null }) }
    expect(rejectionOf(noNamespace)?.code).toBe('decode-failed')
  })

  it('rejects scripts, foreignObject and embedded web content', () => {
    const unsafe = [
      el('script', {}, [], { text: 'alert(1)' }),
      el('script', {}, [], { namespace: XHTML }),
      el('foreignObject', { width: '10', height: '10' }),
      el('div', {}, [], { namespace: XHTML }),
      el('iframe', { src: 'https://example.com' }, [], { namespace: XHTML }),
      el('embed'),
      el('object'),
    ]
    for (const element of unsafe) {
      expect(rejectionOf(svg([element]))?.code).toBe('svg-unsupported-content')
    }
  })

  it('rejects unsafe content however deeply it is nested', () => {
    let tree = el('script')
    for (let i = 0; i < 10_000; i++) tree = el('g', {}, [tree])
    expect(rejectionOf(svg([tree]))?.code).toBe('svg-unsupported-content')
  })

  it('rejects event handler attributes', () => {
    for (const attribute of ['onload', 'onclick', 'ONMOUSEOVER', 'onbegin', 'ev:onload']) {
      expect(rejectionOf(svg([el('rect', { [attribute]: 'x()' })]))?.code).toBe('svg-unsupported-content')
    }
    expect(rejectionOf({ ...svg(), root: el('svg', { onload: 'x()' }) })?.code).toBe(
      'svg-unsupported-content',
    )
  })

  it('rejects links to other files and non-image data', () => {
    for (const href of [
      'https://example.com/image.png',
      'http://192.168.0.1/a.svg#icon',
      '//example.com/a.png',
      'file:///etc/passwd',
      'icons.svg#arrow',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://example.com/123',
    ]) {
      for (const attribute of ['href', 'xlink:href']) {
        expect(rejectionOf(svg([el('image', { [attribute]: href })]))?.code).toBe('svg-unsupported-content')
      }
      expect(rejectionOf(svg([el('a', { href })]))?.code).toBe('svg-unsupported-content')
      expect(rejectionOf(svg([el('feImage', { href })]))?.code).toBe('svg-unsupported-content')
    }
  })

  it('rejects external url() references in attributes and style', () => {
    const cases = [
      el('rect', { fill: 'url(https://example.com/p.svg#p)' }),
      el('rect', { style: "fill: url('//example.com/p.svg#p')" }),
      el('rect', { filter: 'url( "filters.svg#blur" )' }),
      el('rect', { style: 'background: url(#ok), url(http://example.com/x.png)' }),
    ]
    for (const element of cases) {
      expect(rejectionOf(svg([element]))?.code).toBe('svg-unsupported-content')
    }
  })

  it('rejects CSS escapes and image-set(), which could hide a resource reference', () => {
    const cases = [
      el('rect', { style: 'fill: u\\72l(https://example.com/p.svg#p)' }),
      el('rect', { fill: 'u\\rl(x.svg#p)' }),
      el('style', {}, [], { text: '.a { background: \\75rl(x.png) }' }),
      el('rect', { style: 'background: image-set("x.png" 1x)' }),
      el('style', {}, [], { text: '.a { background: -webkit-image-set("x.png" 1x) }' }),
    ]
    for (const element of cases) {
      expect(rejectionOf(svg([element]))?.code).toBe('svg-unsupported-content')
    }
    // Backslashes in editor metadata (e.g. Windows export paths) are not CSS.
    expect(rejectionOf(svg([], { viewBox: '0 0 1 1', 'inkscape:export-filename': 'C:\\icons\\a.png' }))).toBeNull()
  })

  it('rejects stylesheets that import or reference other files', () => {
    for (const css of ['@import "theme.css";', '@IMPORT url(x.css);', '.a { fill: url(https://example.com/p.svg#p) }']) {
      expect(rejectionOf(svg([el('style', {}, [], { text: css })]))?.code).toBe('svg-unsupported-content')
    }
  })

  it('rejects external stylesheet processing instructions', () => {
    expect(rejectionOf({ ...svg(), processingInstructions: ['xml-stylesheet'] })?.code).toBe('svg-unsupported-content')
    expect(rejectionOf({ ...svg(), processingInstructions: ['other'] })).toBeNull()
  })

  it('rejects animations that change link references', () => {
    for (const name of ['animate', 'set']) {
      for (const target of ['href', 'xlink:href']) {
        const element = el(name, { attributeName: target, to: 'https://example.com/x.png' })
        expect(rejectionOf(svg([element]))?.code).toBe('svg-unsupported-content')
      }
    }
    expect(rejectionOf(svg([el('animate', { attributeName: 'opacity', to: '0' })]))).toBeNull()
  })

  it('names the problem in the developer detail only', () => {
    const error = rejectionOf(svg([el('image', { href: 'https://example.com/tracker.png' })]))
    expect(error?.detail).toContain('https://example.com/tracker.png')
    expect(error?.message).not.toContain('example.com')
  })
})

describe('isAllowedReference', () => {
  it('allows fragments, empty references and image data only', () => {
    expect(isAllowedReference('#a')).toBe(true)
    expect(isAllowedReference('  #a ')).toBe(true)
    expect(isAllowedReference('')).toBe(true)
    expect(isAllowedReference('data:image/gif;base64,R0lGOD')).toBe(true)
    expect(isAllowedReference('data:image/svg+xml,%3Csvg%3E')).toBe(false)
    expect(isAllowedReference('data:image/bmp;base64,Qk0=')).toBe(false)
    expect(isAllowedReference('data:,hello')).toBe(false)
    expect(isAllowedReference('a.svg')).toBe(false)
  })
})

describe('checkSvgMarkup', () => {
  it('accepts ordinary SVG markup without DTD declarations', () => {
    for (const markup of [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Illustrator -->\n<svg xmlns="http://www.w3.org/2000/svg"><![CDATA[x]]></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><text>&lt;!DOCTYPE&gt; &amp; &#169;</text></svg>',
    ]) {
      expect(checkSvgMarkup(markup)).toBeNull()
    }
  })

  it('rejects DOCTYPE declarations and entity definitions in any case', () => {
    for (const markup of [
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>',
      '<?xml version="1.0"?>\n<!DOCTYPE svg [\n  <!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n<svg xmlns="&ns_svg;"/>',
      '<!DOCTYPE lol [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><svg>&b;</svg>',
      '<!doctype svg><svg/>',
      '<svg><!ENTITY x "y"></svg>',
      '<!-- <!DOCTYPE svg> --><svg/>',
    ]) {
      const error = checkSvgMarkup(markup)
      expect(error?.code).toBe('svg-unsupported-content')
      expect(error?.detail).toMatch(/DTD declaration/)
    }
  })
})
