/** Vector output stays sharp on high-density displays without regenerating on resize.
 * Keep the encoder lazy: only pages displaying an invitation need it. */
export async function joinQrImage(url: string): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  // Four untouched modules of quiet zone, plus one for the dark UI-style frame.
  // Keep the existing module footprint so dense invitations stay readable at small sizes.
  const margin = 5; const size = modules.size; const side = size + margin * 2;
  const paper = '#18241b'; const ink = '#cddbb5';
  const finders = [[0, 0], [size - 7, 0], [0, size - 7]] as const;
  const rect = (x: number, y: number, width: number, radius: number, fill?: string) =>
    `<rect x="${x}" y="${y}" width="${width}" height="${width}" rx="${radius}"${fill ? ` fill="${fill}"` : ''}/>`;
  const cells: string[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (!modules.get(row, col) || finders.some(([x, y]) => col >= x && col < x + 7 && row >= y && row < y + 7)) continue;
    // Keep timing, alignment and format cells square; only data cells soften at the corners.
    cells.push(rect(col + margin, row + margin, 1, modules.isReserved(row, col) ? 0 : .18));
  }
  for (const [col, row] of finders) {
    const x = col + margin; const y = row + margin;
    // Preserve the locator's 7:5:3 geometry and full one-module ring thickness.
    cells.push(rect(x, y, 7, 1), rect(x + 1, y + 1, 5, .6, paper), rect(x + 2, y + 2, 3, .35));
  }
  const edge = side - .5; const middle = side / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">` +
    `<rect width="${side}" height="${side}" rx="1" fill="#18211b"/>` +
    `<rect x=".2" y=".2" width="${side - .4}" height="${side - .4}" rx=".8" fill="none" stroke="#839373" stroke-width=".12"/>` +
    // The dark tile and its quiet zone stay flat, opaque and free of decoration.
    rect(1, 1, side - 2, 0, paper) +
    `<path d="M.5 5V1Q.5 .5 1 .5H5M${side - 5} .5H${side - 1}Q${edge} .5 ${edge} 1V5M.5 ${side - 5}V${side - 1}Q.5 ${edge} 1 ${edge}H5M${side - 5} ${edge}H${side - 1}Q${edge} ${edge} ${edge} ${side - 1}V${side - 5}" fill="none" stroke="#e9bd79" stroke-width=".3" stroke-linecap="round"/>` +
    `<path d="M${middle - 2} .5h4M${middle - 2} ${edge}h4" fill="none" stroke="#92c5a1" stroke-width=".2" stroke-linecap="round"/>` +
    // Snap module edges at small sizes to avoid pale antialiased seams between touching cells.
    `<g fill="${ink}" shape-rendering="crispEdges">${cells.join('')}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
