/*
 * CRC-32 as PNG chunks use it (ISO 3309 / ITU-T V.42: polynomial 0xEDB88320 reflected, initial
 * value and final XOR 0xFFFFFFFF), table-driven, one byte per step.
 */

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * Continues a CRC-32 over `bytes`. Start with `crc32Start()`, feed every piece in order, and finish
 * with `crc32End`, so a chunk's type and data can be checked without joining them.
 */
export function crc32Update(crc: number, bytes: Readonly<Uint8Array>): number {
  let c = crc
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return c
}

export function crc32Start(): number {
  return 0xffffffff
}

export function crc32End(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0
}

/** CRC-32 of `bytes`, as an unsigned 32-bit number. */
export function crc32(bytes: Readonly<Uint8Array>): number {
  return crc32End(crc32Update(crc32Start(), bytes))
}
