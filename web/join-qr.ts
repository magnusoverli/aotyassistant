/** Vector output stays sharp on high-density displays without regenerating on resize.
 * Keep the encoder lazy: only pages displaying an invitation need it. */
export async function joinQrImage(url: string): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  // Four untouched modules of quiet zone, plus one for the decorative frame.
  const margin = 5; const size = modules.size; const side = size + margin * 2;
  const paper = '#faf7ef'; const ink = '#173c2c';
  const finders = [[0, 0], [size - 7, 0], [0, size - 7]] as const;
  const rect = (x: number, y: number, width: number, radius: number, fill?: string) =>
    `<rect x="${x}" y="${y}" width="${width}" height="${width}" rx="${radius}"${fill ? ` fill="${fill}"` : ''}/>`;
  const cells: string[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (!modules.get(row, col) || finders.some(([x, y]) => col >= x && col < x + 7 && row >= y && row < y + 7)) continue;
    // Keep timing, alignment and format cells square; only data cells soften at the corners.
    cells.push(rect(col + margin, row + margin, 1, modules.isReserved(row, col) ? 0 : .13));
  }
  for (const [col, row] of finders) {
    const x = col + margin; const y = row + margin;
    // Preserve the locator's 7:5:3 geometry and full one-module ring thickness.
    cells.push(rect(x, y, 7, .55), rect(x + 1, y + 1, 5, .3, paper), rect(x + 2, y + 2, 3, .18));
  }
  const edge = side - .4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">` +
    `<rect width="${side}" height="${side}" fill="${paper}"/>` +
    `<rect x=".4" y=".4" width="${side - .8}" height="${side - .8}" rx="1" fill="none" stroke="#839373" stroke-width=".22"/>` +
    `<path d="M.4 3V1.4Q.4 .4 1.4 .4H3M${edge} ${side - 3}V${side - 1.4}Q${edge} ${edge} ${side - 1.4} ${edge}H${side - 3}" fill="none" stroke="#b49b62" stroke-width=".3" stroke-linecap="round"/>` +
    // Snap module edges at small sizes to avoid pale antialiased seams between touching cells.
    `<g fill="${ink}" shape-rendering="crispEdges">${cells.join('')}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
