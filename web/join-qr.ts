/** Vector output stays sharp on high-density displays without regenerating on resize.
 * Keep the encoder lazy: only pages displaying an invitation need it. */
export async function joinQrImage(url: string): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  const svg = await QRCode.toString(url, { type: 'svg', margin: 4 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
