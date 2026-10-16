import { type ImportError, createImportError } from './errors'
import type { SvgSizeAttributes } from './svgSize'

/*
 * Policy for untrusted SVG files: reject anything that could run code, show web
 * content or load another resource, instead of trying to sanitise it.
 *
 * This is one layer of defence. SVGs are also only ever rendered through an <img>
 * element (which never runs scripts or fetches external resources) and are never
 * inserted into the application DOM.
 */

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

/** The parts of a DOM Element the policy reads. Real Elements satisfy this. */
export interface SvgElementLike {
  readonly localName: string
  readonly namespaceURI: string | null
  readonly textContent: string | null
  readonly children: ArrayLike<SvgElementLike>
  getAttributeNames(): string[]
  getAttribute(name: string): string | null
}

export interface ParsedSvg<TElement extends SvgElementLike = SvgElementLike> {
  readonly root: TElement
  /** Targets of document-level processing instructions, e.g. 'xml-stylesheet'. */
  readonly processingInstructions: readonly string[]
  /** Whether the parsed document has a DOCTYPE node. */
  readonly hasDoctype: boolean
}

export type SvgAnalysis =
  | { readonly ok: true; readonly sizeAttributes: SvgSizeAttributes }
  | { readonly ok: false; readonly error: ImportError }

/** Elements rejected wherever they appear. */
const REJECTED_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object'])
const ANIMATION_ELEMENTS = new Set(['animate', 'set'])

/**
 * Embedded images allowed in href and url(): local raster data only. Nested SVG data
 * (data:image/svg+xml) is rejected because this policy could not inspect its content.
 */
const ALLOWED_DATA_URI = /^data:image\/(?:png|jpeg|jpg|gif|webp)[;,]/i
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
/** image-set() can name files without url(). */
const CSS_IMAGE_SET = /image-set\(/i
/** DTD declarations, matched in any case anywhere in the markup. */
const DTD_DECLARATION = /<!(?:DOCTYPE|ENTITY)/i

/**
 * Checks raw SVG markup before it is parsed. DOCTYPE declarations and entity
 * definitions are rejected outright, so entity expansion never reaches the XML
 * parser. The match is deliberately broad: a declaration mentioned inside a comment
 * or CDATA section is also rejected.
 */
export function checkSvgMarkup(markup: string): ImportError | null {
  const match = DTD_DECLARATION.exec(markup)
  if (!match) return null
  return createImportError('svg-unsupported-content', `Contains a DTD declaration (${match[0]})`)
}

/**
 * Checks a parsed SVG against the import policy and returns its size attributes.
 * The tree is walked iteratively, so deeply nested files cannot overflow the stack.
 */
export function analyseSvg(parsed: ParsedSvg): SvgAnalysis {
  const { root } = parsed
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) {
    return invalid(`Root element is <${root.localName}> in namespace ${root.namespaceURI ?? 'none'}`)
  }
  if (parsed.hasDoctype) return unsafe('Contains a DOCTYPE declaration')
  if (parsed.processingInstructions.some((target) => target.toLowerCase() === 'xml-stylesheet')) {
    return unsafe('References an external stylesheet (xml-stylesheet)')
  }

  const stack: SvgElementLike[] = [root]
  while (stack.length > 0) {
    const element = stack.pop()!
    const problem = findElementProblem(element)
    if (problem) return unsafe(problem)
    for (let i = 0; i < element.children.length; i++) stack.push(element.children[i])
  }

  return {
    ok: true,
    sizeAttributes: {
      width: root.getAttribute('width'),
      height: root.getAttribute('height'),
      viewBox: root.getAttribute('viewBox'),
    },
  }
}

function findElementProblem(element: SvgElementLike): string | null {
  const name = element.localName.toLowerCase()

  if (element.namespaceURI === XHTML_NAMESPACE) return `Contains HTML content (<${element.localName}>)`
  if (REJECTED_ELEMENTS.has(name)) return `Contains a <${element.localName}> element`

  if (ANIMATION_ELEMENTS.has(name) && isHrefAttribute(element.getAttribute('attributeName') ?? '')) {
    return 'Animates a link reference'
  }

  if (name === 'style') {
    const css = element.textContent ?? ''
    if (/@import/i.test(css)) return 'Stylesheet imports another file'
    const problem = findCssProblem(css)
    if (problem !== null) return `Stylesheet ${problem}`
  }

  for (const attribute of element.getAttributeNames()) {
    const value = element.getAttribute(attribute) ?? ''

    if (localPart(attribute).startsWith('on')) {
      return `Has an event handler attribute (${attribute})`
    }
    if (isHrefAttribute(attribute) && !isAllowedReference(value)) {
      return `Links to "${truncate(value)}"`
    }
    // Unprefixed attributes may be parsed as CSS (style and presentation attributes).
    // Prefixed ones (inkscape:, sodipodi:) are editor metadata and only checked for url().
    const problem = attribute.includes(':') ? findDisallowedCssUrl(value) : findCssProblem(value)
    if (problem !== null) return `Attribute ${attribute} ${problem}`
  }
  return null
}

/** Matches href and any namespaced form such as xlink:href. */
function isHrefAttribute(name: string): boolean {
  return localPart(name) === 'href'
}

/** Lower-cased attribute name without its namespace prefix ("xlink:href" → "href"). */
function localPart(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1).toLowerCase()
}

/** Same-document fragments (#id), empty references and embedded image data are allowed. */
export function isAllowedReference(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || trimmed.startsWith('#') || ALLOWED_DATA_URI.test(trimmed)
}

/**
 * Finds CSS that references another resource. CSS escapes are rejected because they
 * could spell url() or a file name in a form the patterns below would not match.
 */
function findCssProblem(css: string): string | null {
  if (css.includes('\\')) return 'uses a CSS escape sequence'
  if (CSS_IMAGE_SET.test(css)) return 'uses image-set()'
  return findDisallowedCssUrl(css)
}

function findDisallowedCssUrl(text: string): string | null {
  for (const match of text.matchAll(CSS_URL)) {
    if (!isAllowedReference(match[2])) return `references "${truncate(match[2])}"`
  }
  return null
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value
}

function invalid(detail: string): SvgAnalysis {
  return { ok: false, error: createImportError('decode-failed', detail) }
}

function unsafe(detail: string): SvgAnalysis {
  return { ok: false, error: createImportError('svg-unsupported-content', detail) }
}
