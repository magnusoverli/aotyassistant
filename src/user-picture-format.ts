/** Shared limits for the camera/file picker and the server's raster decoder. */
export const maxUserPictureBytes = 10 * 1024 * 1024;
export const maxUserPicturePixels = 40_000_000;
export const userPictureSize = 512;
export const userPictureVersionPattern = /^[a-f0-9]{32}$/;
export const pictureVersion = (url: string | undefined) => url?.split('/').at(-1)?.replace(/\.webp$/, '') ?? 'none';
