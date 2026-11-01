/*
 * Run-length encoding of 32-bit pixel values, shared by pixel patches (where the values are
 * old XOR new, so 0 means unchanged) and crop patches (where they are the removed pixels).
 *
 * A sequence is stored as tokens, each covering `length` consecutive values:
 *
 * - SKIP:    `length` zeros.
 * - FILL:    `length` copies of one non-zero value, stored in the word after the token.
 * - LITERAL: the next `length` values from `literals`, in order.
 *
 * A token is one 32-bit word, `length × 4 + kind`. Runs of equal values shorter than MIN_RUN
 * are stored as literals: a separate token would cost more than the values. So the encoding
 * never needs more than 4 bytes per value, plus 4 bytes (see WordRunEncoder).
 *
 * Literal values keep their four bytes in pixel memory order (R, G, B, A). When every literal
 * value has only its alpha byte set, as when an edit changed only alpha, only that byte is
 * kept: one byte per value (`alphaOnly`).
 *
 * Values are read as 32-bit words in the platform's byte order. Runs exist only in memory
 * during a session and are never saved, so the byte order cannot change under them.
 */

const SKIP = 0
const FILL = 1
const LITERAL = 2
/** Runs of equal values shorter than this are stored as literals. */
const MIN_RUN = 3
/** The longest sequence a token's 30-bit length field can describe: about 4 GiB of RGBA. */
export const MAX_WORD_RUNS_LENGTH = 2 ** 30 - 1
const INITIAL_CAPACITY = 1024

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
/** The bits of a pixel word holding red, green and blue: everything except alpha. */
const COLOUR_BITS = LITTLE_ENDIAN ? 0x00ffffff : 0xffffff00 | 0

/** A run-length encoded sequence of 32-bit values. Never modified once created. */
export interface WordRuns {
  /** Number of values encoded. */
  readonly length: number
  /** SKIP, FILL (followed by its value) and LITERAL tokens, in order. */
  readonly tokens: Uint32Array
  /** The values of LITERAL tokens: four bytes each, or only the alpha byte when `alphaOnly`. */
  readonly literals: Uint8Array
  /** Whether every literal value has only its alpha byte set, so `literals` keeps just that byte. */
  readonly alphaOnly: boolean
}

/**
 * Encodes a sequence of exactly `expectedLength` values, pushed in order in one or more
 * segments. Single use: push every value, then call finish().
 *
 * Output arrays start small and double as needed, never beyond what the sequence can use;
 * finish() trims them to their exact length. Literals are collected as alpha bytes, one per
 * value, until a literal with colour appears, and only then widened to four bytes each, so
 * alpha-only edits never hold four bytes per literal, not even while encoding.
 */
export class WordRunEncoder {
  /** Number of non-zero values pushed (for a pixel patch: changed pixels). Complete after finish(). */
  nonZero = 0

  private readonly expected: number
  private tokens: Uint32Array
  private tokenCount = 0
  /** Literal values while none has colour: their alpha bytes. Null once one has colour. */
  private alphaLiterals: Uint8Array | null
  /** Literal values once one has colour: whole values. */
  private wordLiterals: Uint32Array | null = null
  private literalCount = 0
  /** Literal values written but not yet covered by a LITERAL token. */
  private pendingLiterals = 0
  private runValue = 0
  private runLength = 0
  private pushed = 0

  constructor(expectedLength: number) {
    if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > MAX_WORD_RUNS_LENGTH) {
      throw new RangeError(`Cannot encode ${expectedLength} values; the limit is ${MAX_WORD_RUNS_LENGTH}`)
    }
    this.expected = expectedLength
    this.tokens = new Uint32Array(Math.min(INITIAL_CAPACITY, expectedLength + 1))
    this.alphaLiterals = new Uint8Array(Math.min(INITIAL_CAPACITY, expectedLength))
  }

  /** Pushes `source[start]` to `source[end - 1]`. */
  pushWords(source: Readonly<Uint32Array>, start: number, end: number): void {
    let value = this.runValue
    let length = this.runLength
    for (let i = start; i < end; i++) {
      const word = source[i] | 0
      if (word === value) {
        length++
        continue
      }
      this.endRun(value, length)
      value = word
      length = 1
    }
    this.runValue = value
    this.runLength = length
    this.pushed += end - start
  }

  /** Pushes `a[i] XOR b[i]` for i from `start` to `end - 1`. */
  pushXor(a: Readonly<Uint32Array>, b: Readonly<Uint32Array>, start: number, end: number): void {
    let value = this.runValue
    let length = this.runLength
    for (let i = start; i < end; i++) {
      const word = a[i] ^ b[i]
      if (word === value) {
        length++
        continue
      }
      this.endRun(value, length)
      value = word
      length = 1
    }
    this.runValue = value
    this.runLength = length
    this.pushed += end - start
  }

  finish(): WordRuns {
    if (this.pushed !== this.expected) {
      throw new Error(`Encoded ${this.pushed} values; expected ${this.expected}`)
    }
    this.endRun(this.runValue, this.runLength)
    this.runLength = 0
    this.flushLiterals()

    const tokens = exactLength(this.tokens, this.tokenCount)
    if (this.alphaLiterals) {
      return { length: this.expected, tokens, literals: exactLength(this.alphaLiterals, this.literalCount), alphaOnly: true }
    }
    const words = exactLength(this.wordLiterals!, this.literalCount)
    const literals = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
    return { length: this.expected, tokens, literals, alphaOnly: false }
  }

  private endRun(value: number, length: number): void {
    if (length === 0) return
    if (value !== 0) this.nonZero += length
    if (length >= MIN_RUN) {
      this.flushLiterals()
      if (value === 0) {
        this.reserveTokens(1)
        this.tokens[this.tokenCount++] = length * 4 + SKIP
      } else {
        this.reserveTokens(2)
        this.tokens[this.tokenCount++] = length * 4 + FILL
        this.tokens[this.tokenCount++] = value
      }
      return
    }
    this.pendingLiterals += length
    const needed = this.literalCount + length
    if (this.alphaLiterals && (value & COLOUR_BITS) === 0) {
      if (needed > this.alphaLiterals.length) {
        this.alphaLiterals = grow(this.alphaLiterals, this.literalCount, needed, this.expected)
      }
      const alpha = LITTLE_ENDIAN ? value >>> 24 : value & 0xff
      for (let k = 0; k < length; k++) this.alphaLiterals[this.literalCount++] = alpha
      return
    }
    if (this.alphaLiterals) this.widenLiterals()
    if (needed > this.wordLiterals!.length) {
      this.wordLiterals = grow(this.wordLiterals!, this.literalCount, needed, this.expected)
    }
    for (let k = 0; k < length; k++) this.wordLiterals![this.literalCount++] = value
  }

  /** Turns the alpha bytes collected so far into whole values (colour 0), for the first literal with colour. */
  private widenLiterals(): void {
    const alpha = this.alphaLiterals!
    const words = new Uint32Array(alpha.length)
    const bytes = new Uint8Array(words.buffer)
    for (let k = 0; k < this.literalCount; k++) bytes[k * 4 + 3] = alpha[k]
    this.wordLiterals = words
    this.alphaLiterals = null
  }

  private flushLiterals(): void {
    if (this.pendingLiterals === 0) return
    this.reserveTokens(1)
    this.tokens[this.tokenCount++] = this.pendingLiterals * 4 + LITERAL
    this.pendingLiterals = 0
  }

  private reserveTokens(count: number): void {
    if (this.tokenCount + count > this.tokens.length) {
      this.tokens = grow(this.tokens, this.tokenCount, this.tokenCount + count, this.expected + 1)
    }
  }
}

/**
 * Reads a WordRuns sequence in order, applying the next values to pixel words. Use it on runs
 * that passed validateWordRuns(). As a second line of defence it also throws a RangeError,
 * rather than looping or reading past the end, if the tokens or literals run out or a token
 * is malformed; its target may then be partly written.
 */
export class WordRunDecoder {
  private readonly tokens: Uint32Array
  private readonly literalBytes: Uint8Array
  private readonly literalWords: Uint32Array | null
  private readonly literalCount: number
  private token = 0
  private kind = SKIP
  private value = 0
  private remaining = 0
  private literal = 0

  constructor(runs: WordRuns) {
    this.tokens = runs.tokens
    this.literalBytes = runs.literals
    this.literalWords = runs.alphaOnly
      ? null
      : new Uint32Array(runs.literals.buffer, runs.literals.byteOffset, Math.floor(runs.literals.byteLength / 4))
    this.literalCount = this.literalWords ? this.literalWords.length : runs.literals.length
  }

  /** XORs the next `count` values into `words[offset]` onwards. `bytes` views the same memory. */
  xorInto(words: Uint32Array, bytes: Uint8Array, offset: number, count: number): void {
    const end = offset + count
    let at = offset
    while (at < end) {
      if (this.remaining === 0) this.nextToken()
      const stop = Math.min(end, at + this.remaining)
      this.remaining -= stop - at
      if (this.kind === FILL) {
        const value = this.value
        for (let i = at; i < stop; i++) words[i] ^= value
      } else if (this.kind === LITERAL) {
        let l = this.literal
        this.checkLiterals(l, stop - at)
        if (this.literalWords) {
          const literals = this.literalWords
          for (let i = at; i < stop; i++) words[i] ^= literals[l++]
        } else {
          const literals = this.literalBytes
          for (let i = at; i < stop; i++) bytes[i * 4 + 3] ^= literals[l++]
        }
        this.literal = l
      }
      at = stop
    }
  }

  /**
   * Writes the next `count` values to `words[offset]` onwards. Zeros (SKIP) are not written:
   * the target must already be zero there, as newly allocated memory is.
   */
  writeInto(words: Uint32Array, bytes: Uint8Array, offset: number, count: number): void {
    const end = offset + count
    let at = offset
    while (at < end) {
      if (this.remaining === 0) this.nextToken()
      const stop = Math.min(end, at + this.remaining)
      this.remaining -= stop - at
      if (this.kind === FILL) {
        words.fill(this.value, at, stop)
      } else if (this.kind === LITERAL) {
        const l = this.literal
        this.checkLiterals(l, stop - at)
        if (this.literalWords) {
          words.set(this.literalWords.subarray(l, l + stop - at), at)
        } else {
          const literals = this.literalBytes
          for (let i = at, k = l; i < stop; i++) bytes[i * 4 + 3] = literals[k++]
        }
        this.literal = l + stop - at
      }
      at = stop
    }
  }

  private nextToken(): void {
    if (this.token >= this.tokens.length) throw new RangeError('Run tokens end before the values do')
    const header = this.tokens[this.token++]
    this.kind = header & 3
    this.remaining = header >>> 2
    if (this.kind > LITERAL || this.remaining === 0) throw new RangeError(`Malformed run token ${header}`)
    if (this.kind === FILL) {
      if (this.token >= this.tokens.length) throw new RangeError('Run token has no fill value')
      this.value = this.tokens[this.token++]
    }
  }

  private checkLiterals(next: number, count: number): void {
    if (next + count > this.literalCount) throw new RangeError('Literal values end before the runs do')
  }
}

/**
 * Throws a RangeError unless `runs` is a well-formed encoding of exactly `expectedLength`
 * values: known token kinds with lengths of at least 1, a non-zero value after every FILL,
 * tokens covering exactly `expectedLength` values, and exactly as many literal bytes as the
 * LITERAL tokens use. Reads only the tokens, never the literal values.
 */
export function validateWordRuns(runs: WordRuns, expectedLength: number): void {
  if (runs.length !== expectedLength) {
    throw new RangeError(`Runs encode ${runs.length} values; expected ${expectedLength}`)
  }
  const { tokens } = runs
  let covered = 0
  let literalValues = 0
  for (let t = 0; t < tokens.length; ) {
    const header = tokens[t++]
    const kind = header & 3
    const length = header >>> 2
    if (kind > LITERAL || length === 0) throw new RangeError(`Malformed run token ${header} at ${t - 1}`)
    if (kind === FILL) {
      if (t >= tokens.length || tokens[t] === 0) throw new RangeError(`Run token at ${t - 1} has no fill value`)
      t++
    }
    if (kind === LITERAL) literalValues += length
    covered += length
  }
  if (covered !== expectedLength) {
    throw new RangeError(`Run tokens cover ${covered} values; expected ${expectedLength}`)
  }
  const bytesPerLiteral = runs.alphaOnly ? 1 : 4
  if (runs.literals.byteLength !== literalValues * bytesPerLiteral) {
    throw new RangeError(`Runs have ${runs.literals.byteLength} literal bytes; expected ${literalValues * bytesPerLiteral}`)
  }
  if (!runs.alphaOnly && runs.literals.byteOffset % 4 !== 0) {
    throw new RangeError('Literal values do not start on a 4-byte boundary')
  }
}

/** A 32-bit view of a pixel buffer's bytes, which always start on a 4-byte boundary. */
export function pixelWords(data: Readonly<Uint8ClampedArray<ArrayBuffer>>): Uint32Array {
  return new Uint32Array(data.buffer, data.byteOffset, data.length / 4)
}

/** `array` with exactly `length` elements: itself when already that long, otherwise a copy. */
function exactLength<T extends Uint8Array | Uint32Array>(array: T, length: number): T {
  return (length === array.length ? array : array.slice(0, length)) as T
}

/** A copy of the first `used` elements in a larger array: at least `needed` long, doubling, at most `limit` unless more is needed. */
function grow<T extends Uint8Array | Uint32Array>(array: T, used: number, needed: number, limit: number): T {
  const capacity = Math.max(needed, Math.min(array.length * 2, limit))
  const grown = (array instanceof Uint8Array ? new Uint8Array(capacity) : new Uint32Array(capacity)) as T
  grown.set(array.subarray(0, used))
  return grown
}
