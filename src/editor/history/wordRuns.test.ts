import { describe, expect, it } from 'vitest'
import { MAX_WORD_RUNS_LENGTH, WordRunDecoder, WordRunEncoder, type WordRuns, validateWordRuns } from './wordRuns'

/** Deterministic pseudo-random numbers in [0, 1). */
function randomSource(seed: number): () => number {
  let state = seed
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
}

/** 32-bit values built from bytes in memory order, so the tests hold on any byte order. */
function wordsFromBytes(bytes: number[]): Uint32Array {
  return new Uint32Array(Uint8Array.from(bytes).buffer)
}

/** A value with only its alpha byte set. */
const alphaWord = (alpha: number) => wordsFromBytes([0, 0, 0, alpha])[0]
/** A value with a colour byte set. */
const colourWord = (red: number, alpha = 0) => wordsFromBytes([red, 0, 0, alpha])[0]

function encode(values: Uint32Array, segments = [values.length]): { runs: WordRuns; nonZero: number } {
  const encoder = new WordRunEncoder(values.length)
  let start = 0
  for (const length of segments) {
    encoder.pushWords(values, start, start + length)
    start += length
  }
  const runs = encoder.finish()
  return { runs, nonZero: encoder.nonZero }
}

/** Decodes all values by writing them into zeroed memory. */
function decodeWritten(runs: WordRuns): Uint32Array {
  const words = new Uint32Array(runs.length)
  new WordRunDecoder(runs).writeInto(words, new Uint8Array(words.buffer), 0, runs.length)
  return words
}

/** Decodes all values by XORing them into `base`, in pieces of `piece` values. */
function decodeXored(runs: WordRuns, base: Uint32Array, piece: number): Uint32Array {
  const words = base.slice()
  const decoder = new WordRunDecoder(runs)
  for (let at = 0; at < words.length; at += piece) {
    decoder.xorInto(words, new Uint8Array(words.buffer), at, Math.min(piece, words.length - at))
  }
  return words
}

/** The tokens as readable [kind, length, value?] entries. */
function tokenList(runs: WordRuns): (string | number)[][] {
  const list: (string | number)[][] = []
  for (let t = 0; t < runs.tokens.length; ) {
    const header = runs.tokens[t++]
    const kind = ['skip', 'fill', 'literal'][header & 3]
    list.push(kind === 'fill' ? [kind, header >>> 2, runs.tokens[t++]] : [kind, header >>> 2])
  }
  return list
}

const encodedBytes = (runs: WordRuns) => runs.tokens.byteLength + runs.literals.byteLength

describe('WordRunEncoder and WordRunDecoder', () => {
  it('stores long runs of zeros as SKIP and of one value as FILL, short runs as literals', () => {
    const v = colourWord(9, 255)
    const w = colourWord(7)
    const values = Uint32Array.from([0, 0, 0, 0, v, v, v, w, 0, w, w, 0, 0, 0])
    const { runs, nonZero } = encode(values)
    expect(tokenList(runs)).toEqual([['skip', 4], ['fill', 3, v], ['literal', 4], ['skip', 3]])
    expect(Array.from(new Uint32Array(runs.literals.buffer))).toEqual([w, 0, w, w])
    expect(runs.alphaOnly).toBe(false)
    expect(nonZero).toBe(6)
    expect(Array.from(decodeWritten(runs))).toEqual(Array.from(values))
  })

  it('keeps only the alpha byte of literals when no literal has colour', () => {
    const values = Uint32Array.from([alphaWord(10), alphaWord(200), 0, alphaWord(255), alphaWord(255), alphaWord(255), alphaWord(1)])
    const { runs } = encode(values)
    expect(runs.alphaOnly).toBe(true)
    expect(Array.from(runs.literals)).toEqual([10, 200, 0, 1])
    expect(Array.from(decodeWritten(runs))).toEqual(Array.from(values))
    // A single literal with colour keeps all four bytes of every literal.
    const coloured = encode(Uint32Array.from([alphaWord(10), colourWord(3, 10)])).runs
    expect(coloured.alphaOnly).toBe(false)
    expect(coloured.literals.byteLength).toBe(8)
  })

  it('widens the alpha bytes collected so far when the first literal with colour appears', () => {
    const values = Uint32Array.from([alphaWord(10), alphaWord(20), colourWord(5, 30), alphaWord(40), 0])
    const { runs } = encode(values)
    expect(runs.alphaOnly).toBe(false)
    // Memory order, whatever the platform's byte order.
    expect(Array.from(runs.literals)).toEqual([0, 0, 0, 10, 0, 0, 0, 20, 5, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0, 0])
    expect(Array.from(decodeWritten(runs))).toEqual(Array.from(values))
    // With no literals at all, there is nothing to widen.
    expect(encode(new Uint32Array(5).fill(colourWord(1, 1))).runs).toMatchObject({ alphaOnly: true, literals: new Uint8Array(0) })
  })

  it('encodes one value, all zeros and one long run', () => {
    expect(tokenList(encode(Uint32Array.from([0])).runs)).toEqual([['literal', 1]])
    expect(tokenList(encode(new Uint32Array(1000)).runs)).toEqual([['skip', 1000]])
    const fill = encode(new Uint32Array(1000).fill(colourWord(5, 5)))
    expect(tokenList(fill.runs)).toEqual([['fill', 1000, colourWord(5, 5)]])
    expect(fill.nonZero).toBe(1000)
    expect(fill.runs.literals.byteLength).toBe(0)
  })

  it('round-trips random sequences of every kind, pushed in any segments and decoded in any pieces', () => {
    const random = randomSource(11)
    const generators: Record<string, () => number> = {
      noise: () => (random() * 2 ** 32) >>> 0,
      'alpha only': () => alphaWord(Math.floor(random() * 256)),
      'mostly zero': () => (random() < 0.9 ? 0 : (random() * 2 ** 32) >>> 0),
      'short runs': () => 0,
    }
    for (const [name, next] of Object.entries(generators)) {
      for (const length of [1, 2, 3, 4, 7, 64, 1000]) {
        const values = new Uint32Array(length)
        let current = next()
        for (let i = 0; i < length; i++) {
          if (name === 'short runs') {
            if (random() < 0.4) current = random() < 0.3 ? 0 : alphaWord(Math.floor(random() * 4) * 60)
            values[i] = current
          } else {
            values[i] = next()
          }
        }
        const segments: number[] = []
        for (let left = length; left > 0; ) {
          const size = Math.min(left, 1 + Math.floor(random() * 50))
          segments.push(size)
          left -= size
        }
        const { runs, nonZero } = encode(values, segments)
        expect(() => validateWordRuns(runs, length)).not.toThrow()
        expect(nonZero, `${name} ${length}`).toBe(values.filter((v) => v !== 0).length)
        expect(Array.from(decodeWritten(runs)), `${name} ${length}`).toEqual(Array.from(values))
        const base = Uint32Array.from({ length }, () => (random() * 2 ** 32) >>> 0)
        const xored = decodeXored(runs, base, 1 + Math.floor(random() * 40))
        expect(Array.from(xored), `${name} ${length}`).toEqual(Array.from(base, (b, i) => (b ^ values[i]) >>> 0))
      }
    }
  })

  it('never takes more than 4 bytes per value plus 4, even for adversarial patterns', () => {
    const v = colourWord(1, 1)
    const patterns: Record<string, number[]> = {
      'literal 1, fill 3': [colourWord(2), v, v, v],
      'literal 2, fill 3': [colourWord(2), colourWord(3), v, v, v],
      'literal 1, skip 3': [colourWord(2), 0, 0, 0],
      'pairs': [v, v, colourWord(4), colourWord(4)],
      'alternating': [v, 0],
    }
    for (const [name, pattern] of Object.entries(patterns)) {
      for (const length of [1, 5, 999, 1000, 1001]) {
        const values = Uint32Array.from({ length }, (_, i) => pattern[i % pattern.length])
        const { runs } = encode(values)
        expect(encodedBytes(runs), `${name} × ${length}`).toBeLessThanOrEqual(4 * length + 4)
        expect(Array.from(decodeWritten(runs))).toEqual(Array.from(values))
      }
    }
    const random = randomSource(3)
    const noise = Uint32Array.from({ length: 4096 }, () => (random() * 2 ** 32) >>> 0)
    expect(encodedBytes(encode(noise).runs)).toBeLessThanOrEqual(4 * 4096 + 4)
  })

  it('returns arrays of exactly their length, in memory of exactly that size', () => {
    const random = randomSource(8)
    const values = Uint32Array.from({ length: 5000 }, () => (random() < 0.5 ? 0 : (random() * 2 ** 32) >>> 0))
    const { runs } = encode(values)
    expect(runs.tokens.buffer.byteLength).toBe(runs.tokens.byteLength)
    expect(runs.literals.buffer.byteLength).toBe(runs.literals.byteLength)
    expect(runs.literals.byteOffset).toBe(0)
  })

  it('rejects impossible lengths and a sequence that is not complete', () => {
    expect(() => new WordRunEncoder(0)).toThrow(RangeError)
    expect(() => new WordRunEncoder(1.5)).toThrow(RangeError)
    expect(() => new WordRunEncoder(MAX_WORD_RUNS_LENGTH + 1)).toThrow(RangeError)
    const encoder = new WordRunEncoder(3)
    encoder.pushWords(Uint32Array.from([1, 2]), 0, 2)
    expect(() => encoder.finish()).toThrow(/expected 3/)
  })
})

describe('WordRunDecoder on runs that were not validated', () => {
  it('throws instead of looping or reading past the end', () => {
    const empty = new Uint8Array(0)
    const cases: [string, WordRuns][] = [
      ['tokens end early', { length: 10, tokens: Uint32Array.from([3 * 4 + 0]), literals: empty, alphaOnly: false }],
      ['token of length 0', { length: 10, tokens: Uint32Array.from([0, 10 * 4 + 0]), literals: empty, alphaOnly: false }],
      ['unknown token kind', { length: 10, tokens: Uint32Array.from([10 * 4 + 3]), literals: empty, alphaOnly: false }],
      ['fill without a value', { length: 10, tokens: Uint32Array.from([10 * 4 + 1]), literals: empty, alphaOnly: false }],
      ['literals end early', { length: 10, tokens: Uint32Array.from([10 * 4 + 2]), literals: new Uint8Array(8), alphaOnly: false }],
      ['alpha literals end early', { length: 10, tokens: Uint32Array.from([10 * 4 + 2]), literals: new Uint8Array(3), alphaOnly: true }],
    ]
    for (const [name, runs] of cases) {
      const words = new Uint32Array(10)
      const bytes = new Uint8Array(words.buffer)
      expect(() => new WordRunDecoder(runs).writeInto(words, bytes, 0, 10), name).toThrow(RangeError)
      expect(() => new WordRunDecoder(runs).xorInto(words, bytes, 0, 10), name).toThrow(RangeError)
    }
  })
})

describe('validateWordRuns', () => {
  const valid = () => encode(Uint32Array.from([0, 0, 0, 5, 5, 5, 7, colourWord(1)])).runs

  it('accepts what the encoder makes', () => {
    expect(() => validateWordRuns(valid(), 8)).not.toThrow()
  })

  it('rejects malformed runs', () => {
    const runs = valid()
    const withTokens = (tokens: number[]): WordRuns => ({ ...runs, tokens: Uint32Array.from(tokens) })
    const cases: [string, WordRuns, number][] = [
      ['another length', runs, 9],
      ['unknown token kind', withTokens([3 * 4 + 3, 3 * 4 + 1, 5, 2 * 4 + 2]), 8],
      ['token of length 0', withTokens([0 * 4 + 0, 3 * 4 + 0, 3 * 4 + 1, 5, 2 * 4 + 2]), 8],
      ['fill without a value', withTokens([3 * 4 + 0, 2 * 4 + 2, 3 * 4 + 1]), 8],
      ['fill of zero', withTokens([3 * 4 + 0, 3 * 4 + 1, 0, 2 * 4 + 2]), 8],
      ['too few values', withTokens([3 * 4 + 0, 3 * 4 + 1, 5, 1 * 4 + 2]), 8],
      ['too many values', withTokens([4 * 4 + 0, 3 * 4 + 1, 5, 2 * 4 + 2]), 8],
      ['literals missing', { ...runs, literals: runs.literals.subarray(0, 4) }, 8],
      ['literals not on a 4-byte boundary', { ...runs, literals: new Uint8Array(9).subarray(1) }, 8],
      ['alpha-only literals of the wrong size', { ...runs, alphaOnly: true }, 8],
    ]
    for (const [name, candidate, length] of cases) {
      expect(() => validateWordRuns(candidate, length), name).toThrow(RangeError)
    }
  })
})
