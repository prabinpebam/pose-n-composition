export interface RoomPreset {
  label: string;
  path: string;
  metrics: { landmark: string; height: number; ceiling?: number; floor: number; clearance: number };
  license: string;
}
export type RoomId = string;

const local = import.meta.env.DEV
  ? Object.values(import.meta.glob('../local-rooms/catalog.json', { eager: true, import: 'default' }))
    .reduce<Record<RoomId, RoomPreset>>((catalog, value) => ({ ...catalog, ...value as Record<RoomId, RoomPreset> }), {})
  : {};
export const ROOMS: Readonly<Record<RoomId, RoomPreset>> = local;
export const ROOM_IDS = Object.keys(ROOMS);
export const isRoomId = (value: unknown): value is RoomId =>
  typeof value === 'string' && Object.hasOwn(ROOMS, value);
