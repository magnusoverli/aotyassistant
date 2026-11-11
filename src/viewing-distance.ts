/** Shared browser/server format; validation and persistence stay in display-settings.ts.
 * The room display is one picture, drawn larger for people who sit further from it. */
export const viewingDistances = [
  { id: 'close', label: 'Close', scale: .85, help: 'A monitor, or a TV within about 2 m. Fits the most on screen.' },
  { id: 'sofa', label: 'Sofa', scale: 1, help: 'A living-room TV watched from about 3 m.' },
  { id: 'room', label: 'Across the room', scale: 1.25, help: 'About 4 m from a TV. The join code moves beside the play order.' },
  { id: 'back', label: 'Back of the room', scale: 1.5, help: 'About 5 m or more. The largest text, with fewer names shown at once.' },
] as const;
export type ViewingDistance = typeof viewingDistances[number]['id'];
export type DisplaySettings = { distance: ViewingDistance };
export type DisplaySnapshot = { revision: number; settings: DisplaySettings };
export const defaultDisplaySettings: Readonly<DisplaySettings> = { distance: 'sofa' };

export const isViewingDistance = (value: unknown): value is ViewingDistance => viewingDistances.some(distance => distance.id === value);
export const viewingDistance = (id: ViewingDistance | undefined) =>
  viewingDistances.find(distance => distance.id === id) ?? viewingDistances.find(distance => distance.id === defaultDisplaySettings.distance)!;
