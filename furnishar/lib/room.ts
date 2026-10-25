import type { RoomLayout } from './types';

export const FEET_TO_METERS = 0.3048;

/**
 * Build a simple rectangular RoomLayout from manual dimensions (meters).
 * Walls: north (y=0), east (x=W), south (y=L), west (x=0).
 * One door on the north wall near the west corner, one window centered on the south wall.
 */
export function buildRectangularRoom(
  dims: { width: number; length: number; height: number },
  roomType: string,
): RoomLayout {
  const W = +dims.width.toFixed(3);
  const L = +dims.length.toFixed(3);
  const H = +dims.height.toFixed(3);
  const doorWidth = Math.min(0.9, W * 0.3);
  const windowWidth = Math.min(1.6, W * 0.45);

  return {
    room_id: `room-${Date.now().toString(36)}`,
    room_type: roomType,
    dimensions: { width: W, length: L, height: H },
    walls: [
      { id: 'wall-north', start: { x: 0, y: 0 }, end: { x: W, y: 0 }, hasWindow: false, hasDoor: true },
      { id: 'wall-east', start: { x: W, y: 0 }, end: { x: W, y: L }, hasWindow: false, hasDoor: false },
      { id: 'wall-south', start: { x: W, y: L }, end: { x: 0, y: L }, hasWindow: true, hasDoor: false },
      { id: 'wall-west', start: { x: 0, y: L }, end: { x: 0, y: 0 }, hasWindow: false, hasDoor: false },
    ],
    openings: [
      {
        type: 'door',
        wall_id: 'wall-north',
        position: { x: +(0.15 + doorWidth / 2).toFixed(3), y: 0 },
        width: doorWidth,
        height: Math.min(2.1, H - 0.1),
        swing_direction: 'inward',
      },
      {
        type: 'window',
        wall_id: 'wall-south',
        position: { x: +(W / 2).toFixed(3), y: L },
        width: windowWidth,
        height: Math.min(1.3, H * 0.45),
        swing_direction: 'none',
        sill_height: 0.9,
      },
    ],
    existing_furniture: [],
    natural_light: 'medium',
    floor_type: 'hardwood',
  };
}
