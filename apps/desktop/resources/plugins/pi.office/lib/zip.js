"use strict";

/**
 * Store-only ZIP writer for the OOXML generators.
 *
 * Method 0 (stored) is not a simplification we can trade away: the payloads are
 * a few kilobytes of XML, so deflate would save nothing measurable while adding
 * a dependency the plugin sandbox may not expose. The header layout mirrors
 * `buildStoreZip` in packages/plugin-devkit/src/pack.ts — the installer reads
 * packages with exactly this layout — but the code is copied rather than
 * imported so the bundled plugin stays self-contained.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (reflected, polynomial 0xEDB88320) over raw bytes. */
function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A fixed DOS timestamp keeps the output byte-for-byte reproducible: the same
// document hashes the same way every run, which is what makes a failing test a
// useful signal instead of a clock tick. 2020-01-01 00:00:00, the DOS epoch
// layout Word itself writes when it does not care.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Reject names an extractor could use to escape the output directory.
 *
 * OOXML part names are always relative and forward-slashed, so anything else
 * points at a caller mistake — and a wrong `..` here would write outside the
 * archive root once Word or our own unzipper treats it as a path.
 */
function checkName(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new TypeError("zip entry name must be a non-empty string");
  }
  if (raw.startsWith("/")) {
    throw new Error(`zip entry name must be relative: "${raw}"`);
  }
  if (raw.includes("\\")) {
    throw new Error(`zip entry name must use forward slashes: "${raw}"`);
  }
  const segments = raw.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`zip entry name has an unsafe path segment: "${raw}"`);
    }
  }
  return raw;
}

function toBytes(data, name) {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError(`zip entry "${name}" must carry a Buffer or Uint8Array`);
}

/**
 * Build a store-only zip from `[{ name, data }]`.
 *
 * Entry order is preserved, so callers that emit parts in a fixed order get a
 * deterministic archive. An empty list produces the 22-byte end-of-central-
 * directory record, which is a legal (empty) archive rather than an error.
 */
function buildZip(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("buildZip expects an array of { name, data } entries");
  }

  const locals = [];
  const centrals = [];
  const seen = new Set();
  let offset = 0;

  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") {
      throw new TypeError("buildZip entry must be an object with name and data");
    }
    const name = checkName(entry.name);
    if (seen.has(name)) {
      throw new Error(`duplicate zip entry "${name}"`);
    }
    seen.add(name);

    const data = toBytes(entry.data, name);
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    // Bit 11 says the name is UTF-8. It is only set when the name is not plain
    // ASCII so archives we build for ASCII-only OOXML parts stay byte-identical
    // to the installer's own output.
    const flags = /[^\x20-\x7e]/.test(name) ? 0x0800 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed to extract (2.0 = store)
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size == stored size
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const localBlock = Buffer.concat([local, nameBytes, data]);
    locals.push(localBlock);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by (MS-DOS, 2.0)
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10); // method: store
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // offset of the local header
    centrals.push(Buffer.concat([central, nameBytes]));

    offset += localBlock.length;
  }

  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with the central directory
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // entries total
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // archive comment length

  return Buffer.concat([...locals, centralBlock, eocd]);
}

module.exports = { buildZip };
