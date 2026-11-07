/** Versioned binary bundle. The descriptor and image bytes are encrypted together. */
export const displayArtworkLimit = 5 * 1024 * 1024;
export const artworkKinds = ['artwork', 'artistArtwork'] as const;
export type ArtworkKind = typeof artworkKinds[number];
export type DisplayImages = Partial<Record<ArtworkKind, { body: Uint8Array; contentType: string }>>;
const imageType = /^(image\/jpeg|image\/png|image\/webp)$/;

export function packDisplayImages(images: DisplayImages): Uint8Array {
  const descriptors = artworkKinds.flatMap(kind => images[kind] ? [{ kind, contentType: images[kind]!.contentType, length: images[kind]!.body.byteLength }] : []);
  const header = new TextEncoder().encode(JSON.stringify({ version: 1, images: descriptors }));
  const size = 4 + header.length + descriptors.reduce((sum, item) => sum + item.length, 0);
  if (header.length > 1024 || size > displayArtworkLimit || !descriptors.length || descriptors.some(item => !imageType.test(item.contentType) || item.length <= 0)) throw Error('Invalid display artwork.');
  const result = new Uint8Array(size); new DataView(result.buffer).setUint32(0, header.length);
  result.set(header, 4); let offset = 4 + header.length;
  for (const item of descriptors) { result.set(images[item.kind]!.body, offset); offset += item.length; }
  return result;
}

export function unpackDisplayImages(bytes: Uint8Array): DisplayImages {
  if (bytes.length < 4 || bytes.length > displayArtworkLimit) throw Error('Invalid display artwork.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (length > 1024 || length + 4 > bytes.length) throw Error('Invalid display artwork.');
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
  if (header?.version !== 1 || !Array.isArray(header.images) || !header.images.length || header.images.length > 2) throw Error('Invalid display artwork.');
  const result: DisplayImages = {}; let offset = 4 + length;
  for (const item of header.images) {
    if (!artworkKinds.includes(item.kind) || Object.hasOwn(result, item.kind) || !imageType.test(item.contentType) ||
      !Number.isSafeInteger(item.length) || item.length <= 0 || offset + item.length > bytes.length) throw Error('Invalid display artwork.');
    result[item.kind as ArtworkKind] = { contentType: item.contentType, body: bytes.slice(offset, offset + item.length) }; offset += item.length;
  }
  if (offset !== bytes.length) throw Error('Invalid display artwork.');
  return result;
}
