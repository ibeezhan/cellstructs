/**
 * The Phase 1 scene: one planet as one living cell. Consumes normalized
 * snapshots + events from the data layer and drives the motion language
 * (spec §7): idle breathing, mine pulses, ER refine flow, phage raids,
 * low-charge pallor (desaturate + slow down).
 */

import { Application, ColorMatrixFilter, Container, FederatedPointerEvent, Graphics } from 'pixi.js';
import { organelleFor, OrganelleKind, OrganellePick } from '../mapping/organelles';
import type { CellEvent, CellSnapshot } from '../data/types';
import { Membrane } from './membrane';
import { ParticleSystem } from './particles';
import {
  ErRefinery,
  ExtractorVacuole,
  Lysosome,
  Mitochondrion,
  Nucleus,
  Organelle,
  Phage,
  RibosomeGolgi,
  ShieldArc,
  Vesicle,
} from './organelleSprites';
import { approach, clamp01, hash01, Motion, PALETTE, TAU } from './util';

/** Charge (blocks since last action) at which the cell reads as fully vivid. */
const CHARGE_VIVID = 600;

/** Ambit → base placement angle (radians): water low, land lower-left, air high, space upper-right. */
const AMBIT_ANGLE: Record<string, number> = {
  land: Math.PI * 1.15,
  water: Math.PI * 0.72,
  air: Math.PI * 1.62,
  space: Math.PI * 1.85,
};

export class CellApp {
  private app = new Application();
  private cell = new Container();
  private dustG = new Graphics();
  private membrane = new Membrane();
  private organelleLayer = new Container();
  private phageLayer = new Container();
  private particles = new ParticleSystem();
  private filter = new ColorMatrixFilter();

  private fxG = new Graphics();

  private organelles = new Map<string, Organelle>();
  private phages: Phage[] = [];
  private snapshot: CellSnapshot | null = null;
  private stressUntil = 0;

  /** camera over the cell container: pan/zoom targets eased per frame */
  private cam = { x: 0, y: 0, zoom: 1, tX: 0, tY: 0, tZoom: 1 };
  private drag: { sx: number; sy: number; tX: number; tY: number } | null = null;
  /** transient menu feedback: SCAN sweep ring / VIEW CELL framing ring */
  private scanT = -1;
  private focusT = -1;

  /** hover payload + client coords; null = pointer left the organelle */
  onHover: ((pick: OrganellePick | null, x: number, y: number) => void) | null = null;
  onSelect: ((pick: OrganellePick) => void) | null = null;

  private motion: Motion = {
    time: 0,
    pale: 0.3,
    stress: 0,
    mining: false,
    refining: false,
    minePulse: 0,
    refinePulse: 0,
    buildPulse: 0,
    shieldPulse: 0,
  };
  private paleTarget = 0.3;
  private stressTarget = 0;
  private refineSpawnAcc = 0;
  private mineSpawnAcc = 0;

  async mount(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: window,
      background: PALETTE.background,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    parent.appendChild(this.app.canvas);

    this.cell.addChild(this.membrane, this.organelleLayer, this.particles.g, this.phageLayer, this.fxG);
    this.cell.filters = [this.filter];
    this.app.stage.addChild(this.dustG, this.cell);

    this.setupPointer();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    this.app.ticker.add(() => this.update(this.app.ticker.deltaMS / 1000));
  }

  /** Stage-level pan (drag on empty space) + wheel zoom toward the cursor. */
  private setupPointer(): void {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;
    stage.on('pointerdown', (e) => {
      if (e.target === stage) {
        this.drag = { sx: e.global.x, sy: e.global.y, tX: this.cam.tX, tY: this.cam.tY };
      }
    });
    stage.on('pointermove', (e) => {
      if (!this.drag) return;
      this.cam.tX = this.drag.tX + (e.global.x - this.drag.sx);
      this.cam.tY = this.drag.tY + (e.global.y - this.drag.sy);
    });
    const endDrag = (): void => {
      this.drag = null;
    };
    stage.on('pointerup', endDrag);
    stage.on('pointerupoutside', endDrag);
    this.app.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const cam = this.cam;
        const next = Math.min(3, Math.max(0.4, cam.tZoom * Math.exp(-e.deltaY * 0.0012)));
        // keep the world point under the cursor fixed while zooming
        const px = e.clientX - this.app.screen.width / 2;
        const py = e.clientY - this.app.screen.height / 2;
        cam.tX = px - ((px - cam.tX) / cam.tZoom) * next;
        cam.tY = py - ((py - cam.tY) / cam.tZoom) * next;
        cam.tZoom = next;
      },
      { passive: false },
    );
  }

  /** Menu SCAN: sweep-ring feedback for a manual chain re-read. */
  scanPulse(): void {
    this.scanT = 0;
  }

  /** Menu VIEW CELL: reset the camera to the default framed view. */
  viewCell(): void {
    this.cam.tX = 0;
    this.cam.tY = 0;
    this.cam.tZoom = 1;
    this.focusT = 0;
  }

  private cellRadius(): number {
    return Math.min(this.app.screen.width, this.app.screen.height) * 0.36;
  }

  private layout(): void {
    const R = this.cellRadius();
    this.cell.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
    this.membrane.setRadius(R);
    for (const org of this.organelles.values()) this.place(org, R);
  }

  // -- data ingestion -------------------------------------------------------

  applySnapshot(snap: CellSnapshot): void {
    this.snapshot = snap;
    const R = this.cellRadius();

    const seen = new Set<string>();
    let mining = false;
    let refining = false;
    for (const s of snap.structs) {
      if (s.destroyed) continue;
      seen.add(s.id);
      mining ||= s.mining;
      refining ||= s.refining;
      let org = this.organelles.get(s.id);
      const kind = organelleFor(s.typeName);
      if (org && org.kind !== kind) {
        org.destroy();
        this.organelles.delete(s.id);
        org = undefined;
      }
      if (!org) {
        org = this.createOrganelle(s.id, kind);
        this.organelles.set(s.id, org);
        this.place(org, R);
      }
      org.setStruct(s);
    }

    // ambient mitochondria: charge/energy production is real player state even
    // when no reactor struct sits on the planet (spec §4 mitochondria=charge)
    for (let i = 0; i < 3; i++) {
      const id = `ambient-mito-${i}`;
      seen.add(id);
      if (!this.organelles.has(id)) {
        const mito = this.createOrganelle(id, 'mitochondrion');
        this.organelles.set(id, mito);
        this.place(mito, R);
      }
    }

    for (const [id, org] of this.organelles) {
      if (!seen.has(id)) {
        org.destroy();
        this.organelles.delete(id);
      }
    }

    const charge = snap.player?.charge ?? CHARGE_VIVID;
    this.paleTarget = 1 - clamp01(charge / CHARGE_VIVID);
    const energy = clamp01(charge / CHARGE_VIVID);
    for (const org of this.organelles.values()) {
      if (org instanceof Mitochondrion) org.energy = energy;
    }

    this.motion.mining = mining;
    this.motion.refining = refining;
    this.membrane.shieldGlow = clamp01(snap.planet.shield / 250);
    if (snap.planet.raidActive) this.stressUntil = performance.now() + 30_000;
  }

  pushEvents(events: CellEvent[]): void {
    for (const ev of events) {
      switch (ev.category) {
        case 'mined':
          this.motion.minePulse = 1;
          this.burstOre();
          break;
        case 'struct_block_ore_mine_start':
          this.motion.minePulse = 1;
          break;
        case 'refined':
          this.motion.refinePulse = 1;
          break;
        case 'struct_block_ore_refine_start':
          this.motion.refinePulse = 1;
          break;
        case 'struct_block_build_start':
        case 'struct_block_build_complete':
          this.motion.buildPulse = 1;
          break;
        case 'shield_change':
          this.motion.shieldPulse = 1;
          break;
        case 'raid_status':
        case 'struct_defense_add':
          this.stressUntil = performance.now() + 30_000;
          break;
        case 'struct_health': {
          const id = String(ev.data.struct_id ?? '');
          const org = this.organelles.get(id);
          if (org) org.flash = 1;
          break;
        }
      }
    }
  }

  /**
   * Animation response for a player action accepted by the signing surface
   * (and again when its tx settles): the acted-on organelle reacts in its
   * own motion language.
   */
  actionEffect(action: string, structId: string): void {
    const org = this.organelles.get(structId);
    switch (action) {
      case 'mine':
        this.motion.minePulse = 1;
        this.burstOre();
        break;
      case 'refine':
        this.motion.refinePulse = 1;
        break;
      case 'build':
        this.motion.buildPulse = 1;
        break;
      case 'defend':
        this.motion.shieldPulse = 1;
        if (org) org.flash = 1;
        break;
      case 'attack':
        if (org) {
          org.flash = 1;
          this.particles.spawnAlphaSparks({ x: org.x, y: org.y }, 12);
        }
        break;
      case 'activate':
      case 'deactivate':
        if (org) org.flash = 1;
        break;
    }
  }

  // -- construction / placement --------------------------------------------

  private createOrganelle(id: string, kind: OrganelleKind): Organelle {
    let org: Organelle;
    switch (kind) {
      case 'nucleus':
        org = new Nucleus(id, kind);
        break;
      case 'mitochondrion':
        org = new Mitochondrion(id, kind);
        break;
      case 'extractor-vacuole':
        org = new ExtractorVacuole(id, kind);
        break;
      case 'er-refinery':
        org = new ErRefinery(id, kind);
        break;
      case 'ribosome-golgi':
        org = new RibosomeGolgi(id, kind);
        break;
      case 'lysosome':
        org = new Lysosome(id, kind);
        break;
      case 'membrane-shield':
        org = new ShieldArc(id, kind);
        break;
      default:
        org = new Vesicle(id, kind);
    }
    org.eventMode = 'static';
    org.cursor = 'pointer';
    const hover = (e: FederatedPointerEvent): void => this.onHover?.(this.pickOf(org), e.clientX, e.clientY);
    org.on('pointerover', hover);
    org.on('pointermove', hover);
    org.on('pointerout', () => this.onHover?.(null, 0, 0));
    org.on('pointertap', () => this.onSelect?.(this.pickOf(org)));
    this.organelleLayer.addChild(org);
    return org;
  }

  /** Pick payload for a struct/organelle id — selection by id (debug + UI). */
  pickById(id: string): OrganellePick | null {
    const org = this.organelles.get(id);
    return org ? this.pickOf(org) : null;
  }

  private pickOf(org: Organelle): OrganellePick {
    return {
      id: org.id,
      kind: org.kind,
      struct: org.struct,
      energy: org instanceof Mitochondrion ? org.energy : undefined,
    };
  }

  private place(org: Organelle, R: number): void {
    const jitter = (hash01(org.id) - 0.5) * 0.35;
    const s = org.struct;
    const ambitAngle = (s ? AMBIT_ANGLE[s.ambit] ?? 0 : 0) + (s ? s.slot * 0.22 : 0) + jitter;
    switch (org.kind) {
      case 'nucleus':
        org.position.set(R * 0.05, -R * 0.03);
        org.redraw(R * 0.28);
        break;
      case 'er-refinery': {
        const er = org as ErRefinery;
        org.position.set(R * 0.05, -R * 0.03); // wraps the nucleus
        er.layoutAroundNucleus(R * 0.28, Math.floor(hash01(org.id) * 3));
        org.redraw(R * 0.28);
        break;
      }
      case 'extractor-vacuole': {
        const a = Math.PI * 0.75 + jitter;
        org.position.set(Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66);
        org.redraw(R * 0.115);
        break;
      }
      case 'ribosome-golgi': {
        const a = Math.PI * 1.72 + jitter;
        org.position.set(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
        org.redraw(R * 0.09);
        break;
      }
      case 'mitochondrion': {
        const idx = hash01(org.id + 'm');
        const a = idx * TAU;
        org.position.set(Math.cos(a) * R * 0.52, Math.sin(a) * R * 0.5);
        org.redraw(R * 0.085);
        break;
      }
      case 'lysosome': {
        const lys = org as Lysosome;
        lys.home = { x: Math.cos(ambitAngle) * R * 0.74, y: Math.sin(ambitAngle) * R * 0.72 };
        org.position.set(lys.home.x, lys.home.y);
        org.redraw(R * 0.038);
        break;
      }
      case 'membrane-shield': {
        (org as ShieldArc).attach(this.membrane, ambitAngle);
        org.redraw(R * 0.05);
        break;
      }
      default: {
        org.position.set(Math.cos(ambitAngle) * R * 0.58, Math.sin(ambitAngle) * R * 0.58);
        org.redraw(R * 0.05);
      }
    }
    org.refreshHitArea();
  }

  // -- per-frame ------------------------------------------------------------

  private update(dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.1);
    const m = this.motion;

    m.pale = approach(m.pale, this.paleTarget, 1.2, dt);
    this.stressTarget = performance.now() < this.stressUntil ? 1 : 0;
    m.stress = approach(m.stress, this.stressTarget, 1.5, dt);
    m.minePulse = Math.max(0, m.minePulse - dt * 0.8);
    m.refinePulse = Math.max(0, m.refinePulse - dt * 0.8);
    m.buildPulse = Math.max(0, m.buildPulse - dt * 0.5);
    m.shieldPulse = Math.max(0, m.shieldPulse - dt * 0.9);

    // low charge: the whole cell literally slows down
    const timeScale = 1 - 0.45 * m.pale;
    m.time += dt * timeScale;

    // camera ease toward pan/zoom targets
    const cam = this.cam;
    cam.zoom = approach(cam.zoom, cam.tZoom, 8, dt);
    cam.x = approach(cam.x, cam.tX, 12, dt);
    cam.y = approach(cam.y, cam.tY, 12, dt);
    this.cell.position.set(this.app.screen.width / 2 + cam.x, this.app.screen.height / 2 + cam.y);
    this.cell.scale.set(cam.zoom);
    this.updateFx(dt);

    this.membrane.update(m);
    for (const org of this.organelles.values()) org.animate(m, dt);
    this.updatePhages(m, dt);
    this.emitContinuousParticles(dt);
    this.particles.update(dt);
    this.updateDust(m);

    // pallor: desaturate + dim, redden slightly under stress
    this.filter.reset();
    this.filter.saturate(-0.7 * m.pale, false);
    this.filter.brightness(1 - 0.18 * m.pale, true);
  }

  /** SCAN sweep ring (expanding) + VIEW CELL framing ring (contracting). */
  private updateFx(dt: number): void {
    const R = this.cellRadius();
    const g = this.fxG;
    g.clear();
    if (this.scanT >= 0) {
      this.scanT += dt * 1.1;
      if (this.scanT >= 1) this.scanT = -1;
      else {
        const t = this.scanT;
        const r = R * (0.1 + 1.3 * t);
        g.circle(0, 0, r).stroke({ width: R * 0.02, color: PALETTE.shield, alpha: 0.55 * (1 - t) });
        g.circle(0, 0, r * 0.85).stroke({ width: R * 0.008, color: PALETTE.alphaSpark, alpha: 0.4 * (1 - t) });
      }
    }
    if (this.focusT >= 0) {
      this.focusT += dt * 1.4;
      if (this.focusT >= 1) this.focusT = -1;
      else {
        const t = this.focusT;
        const r = R * (1.5 - 0.44 * t);
        g.circle(0, 0, r).stroke({ width: R * 0.014, color: PALETTE.membraneInner, alpha: 0.5 * (1 - t * 0.6) });
      }
    }
  }

  private updatePhages(m: Motion, dt: number): void {
    const want = m.stress > 0.05 ? 4 : 0;
    if (want > 0 && this.phages.length === 0) {
      const seed = this.snapshot?.planet.id ?? 'raid';
      for (let i = 0; i < want; i++) {
        const angle = hash01(`${seed}-phage-${i}`) * TAU;
        const phage = new Phage(angle, this.membrane, this.cellRadius() * 0.07);
        this.phages.push(phage);
        this.phageLayer.addChild(phage);
      }
    }
    const dying = want === 0;
    this.phages = this.phages.filter((p) => {
      if (p.update(m, dt, dying)) {
        p.destroy();
        return false;
      }
      return true;
    });
  }

  /** Continuous flows while mining/refining is in progress on-chain. */
  private emitContinuousParticles(dt: number): void {
    const m = this.motion;
    const extractor = [...this.organelles.values()].find((o) => o.kind === 'extractor-vacuole');
    if (extractor && (m.mining || m.minePulse > 0)) {
      this.mineSpawnAcc += dt * (m.mining ? 0.9 : 0) + m.minePulse * dt * 3;
      if (this.mineSpawnAcc > 1) {
        this.mineSpawnAcc = 0;
        this.burstOre();
      }
    }
    const er = [...this.organelleValuesOf(ErRefinery)][0];
    if (er && (er.refining || m.refinePulse > 0)) {
      this.refineSpawnAcc += dt * (er.refining ? 1.6 : 0) + m.refinePulse * dt * 4;
      if (this.refineSpawnAcc > 1) {
        this.refineSpawnAcc = 0;
        this.particles.spawnRefineFlow(
          (s) => er.pathPoint(s),
          (end) => this.particles.spawnAlphaSparks(end, 5),
        );
      }
    }
  }

  private *organelleValuesOf<T extends Organelle>(cls: new (...a: never[]) => T): Generator<T> {
    for (const org of this.organelles.values()) if (org instanceof cls) yield org;
  }

  private burstOre(): void {
    const extractor = [...this.organelles.values()].find((o) => o.kind === 'extractor-vacuole');
    if (!extractor) return;
    const angle = Math.atan2(extractor.y, extractor.x);
    const r = this.membrane.radiusAt(angle, this.motion);
    this.particles.spawnOreIntake(
      { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
      { x: extractor.x, y: extractor.y },
    );
  }

  /** Background dust floating outside the cell — microscopy field depth. */
  private updateDust(m: Motion): void {
    const { width, height } = this.app.screen;
    this.dustG.clear();
    for (let i = 0; i < 42; i++) {
      const sx = hash01(`dust-${i}`) * width;
      const sy = hash01(`dust-y-${i}`) * height;
      const x = (sx + Math.sin(m.time * 0.1 + i) * 24 + m.time * 3 * ((i % 3) - 1)) % width;
      const y = (sy + Math.cos(m.time * 0.08 + i * 2) * 18) % height;
      const size = 0.8 + hash01(`dust-s-${i}`) * 1.8;
      this.dustG.circle((x + width) % width, (y + height) % height, size).fill({
        color: PALETTE.dust,
        alpha: 0.25 + 0.15 * Math.sin(m.time * 0.5 + i),
      });
    }
  }
}
