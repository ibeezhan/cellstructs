/**
 * Stub entity types for structsd v0.20.0 ("Therovis").
 *
 * TODO(protos): replace with buf-generated protobuf types from
 * playstructs/structsd (as structs-webapp does: `buf generate` →
 * `structs.structs.*`). These hand-written stubs mirror the JSON shapes
 * returned by the Structs desktop app's `structs_intel` raw entity queries
 * (which themselves mirror the chain entities), captured live 2026-08-03.
 * Swapping in generated protos should only touch this module and the
 * normalizers in desktopSource.ts.
 */

export type Ambit = 'land' | 'water' | 'air' | 'space';
export const AMBITS: Ambit[] = ['land', 'water', 'air', 'space'];

/** Chain-side numeric strings stay strings in the raw layer. */
export interface RawPlanet {
  id: string;
  name: string;
  owner: string;
  owner_name?: string;
  owner_type?: string;
  status: string;
  creator: string;
  maxOre: string;
  land: string[];
  water: string[];
  air: string[];
  space: string[];
  landSlots: string;
  waterSlots: string;
  airSlots: string;
  spaceSlots: string;
}

export interface RawPlanetAttributes {
  planetaryShield: string;
  blockStartRaid: string;
  defensiveCannonQuantity: string;
  [key: string]: string;
}

export interface RawGridAttributes {
  ore: string;
  power: string;
  capacity: string;
  load: string;
  structsLoad: string;
  lastAction: string;
  [key: string]: string;
}

export interface RawStruct {
  id: string;
  index: string;
  type: string;
  type_name: string;
  locationId: string;
  locationType: string;
  operatingAmbit: Ambit;
  owner: string;
  slot: string;
  health_max: number;
}

export interface RawStructAttributes {
  health: string;
  isOnline: boolean;
  isBuilt: boolean;
  isDestroyed: boolean;
  isHidden: boolean;
  blockStartBuild: string;
  blockStartOreMine: string;
  blockStartOreRefine: string;
  status_decoded?: string;
  [key: string]: string | boolean | undefined;
}

export interface RawFleet {
  id: string;
  owner: string;
  commandStruct: string;
  locationId: string;
  locationType: string;
  status: string;
  land: string[];
  water: string[];
  air: string[];
  space: string[];
}

export interface RawPlayer {
  id: string;
  name: string;
  planetId: string;
  fleetId: string;
  guildId: string;
  primaryAddress: string;
  substationId: string;
}

/** Envelope returned by `structs_intel` raw queries. */
export interface PlanetQueryResult {
  Planet: RawPlanet;
  gridAttributes: RawGridAttributes;
  planetAttributes: RawPlanetAttributes;
}
export interface StructQueryResult {
  Struct: RawStruct;
  gridAttributes: RawGridAttributes;
  structAttributes: RawStructAttributes;
  structDefenders: unknown[];
}
export interface FleetQueryResult {
  Fleet: RawFleet;
}
export interface PlayerQueryResult {
  Player: RawPlayer;
  gridAttributes: RawGridAttributes;
  playerInventory?: Record<string, { amount: string; denom: string }>;
}

// ---------------------------------------------------------------------------
// Normalized snapshot consumed by the render layer.
// ---------------------------------------------------------------------------

export type SourceKind = 'desktop' | 'rpc' | 'mock';

export interface StructState {
  id: string;
  typeName: string;
  ambit: Ambit;
  slot: number;
  health: number;
  healthMax: number;
  online: boolean;
  built: boolean;
  destroyed: boolean;
  mining: boolean;
  refining: boolean;
  building: boolean;
}

export interface CellSnapshot {
  source: SourceKind;
  fetchedAt: number;
  blockHeight: number;
  planet: {
    id: string;
    name: string;
    shield: number;
    raidActive: boolean;
    maxOre: number;
    slots: Record<Ambit, number>;
  };
  player: {
    id: string;
    name: string;
    ore: number;
    /** µalpha */
    alphaU: number;
    /** blocks since last action — resets to 0 on any action */
    charge: number;
    capacity: number;
    load: number;
  } | null;
  structs: StructState[];
  /** Human-readable note, e.g. why we fell back to mock. */
  note?: string;
}

export interface CellEvent {
  ts: number;
  category: string;
  subject: string;
  data: Record<string, unknown>;
}
