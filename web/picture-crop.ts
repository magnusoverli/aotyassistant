export type PictureCrop = { x: number; y: number; zoom: number };
export const centredCrop = (): PictureCrop => ({ x: .5, y: .5, zoom: 1 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

/** Coordinates refer to the browser's EXIF-oriented image, not the encoded camera sensor dimensions. */
export function pictureCrop(width: number, height: number, crop: PictureCrop) {
  const size = Math.min(width, height) / clamp(crop.zoom, 1, 4);
  return { left: (width - size) * clamp(crop.x, 0, 1), top: (height - size) * clamp(crop.y, 0, 1), size };
}
export function movePictureCrop(width: number, height: number, crop: PictureCrop, dx: number, dy: number, previewSize: number): PictureCrop {
  const { size } = pictureCrop(width, height, crop);
  const scale = size / Math.max(1, previewSize);
  return { ...crop, x: width > size ? clamp(crop.x - dx * scale / (width - size), 0, 1) : .5,
    y: height > size ? clamp(crop.y - dy * scale / (height - size), 0, 1) : .5 };
}
