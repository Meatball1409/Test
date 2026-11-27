/** Nur für Tests: Fake-JPEG mit SOF0-Kopf (reicht für Größe und PDF-Aufbau) */
export function fakeJpeg(w: number, h: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}
