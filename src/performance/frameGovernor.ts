import { PerfMonitor, type FrameRenderStats, type PerfMetricsSnapshot } from './perfMetrics';

export type DirtyReason =
  | 'scene'
  | 'camera'
  | 'gizmo'
  | 'hover'
  | 'loading'
  | 'giSettle'
  | 'continuousInteraction';

const REASON_BITS: Record<DirtyReason, number> = {
  scene: 1 << 0,
  camera: 1 << 1,
  gizmo: 1 << 2,
  hover: 1 << 3,
  loading: 1 << 4,
  giSettle: 1 << 5,
  continuousInteraction: 1 << 6,
};

const INTERACTION_HEAVY_MASK =
  REASON_BITS.camera | REASON_BITS.gizmo | REASON_BITS.continuousInteraction;

export interface HoverPointerCoords {
  x: number;
  y: number;
}

export interface FrameGovernorContext {
  nowMs: number;
  dirtyReasonsMask: number;
  isInteracting: boolean;
  isSettling: boolean;
  pixelRatio: number;
  hoverPointer: Readonly<HoverPointerCoords> | null;
}

export interface FrameGovernorOptions {
  /** Callback invoked when a frame should actually render. May optionally return render stats. */
  onRender: (ctx: FrameGovernorContext) => FrameRenderStats | void;
  /** Optional callback invoked when adaptive DPR changes the target pixel ratio. */
  onPixelRatioChange?: (pixelRatio: number) => void;
  /** Optional callback invoked when governor enters or wakes from idle pause. */
  onIdleStateChange?: (idlePaused: boolean) => void;
  /** Optional PerfMonitor instance (created automatically if omitted). */
  perfMonitor?: PerfMonitor;
  /** Number of trailing frames to render after last invalidation so damping/GI transitions settle. Default: 12. */
  settleFrames?: number;
  /** Minimum trailing settle window in milliseconds after last invalidation. Default: 250. */
  settleMs?: number;
  /** Enable dynamic DPR step-down during heavy interaction when rolling frame time > frameBudgetMs. Default: true. */
  adaptiveDpr?: boolean;
  /** Rolling frame-time threshold (ms) that triggers interaction DPR step-down. Default: 20. */
  frameBudgetMs?: number;
  /** Maximum native pixel ratio cap when crisp/settled. Default: 2. */
  maxNativePixelRatio?: number;
  /** Minimum pixel ratio allowed during heavy interaction step-down. Default: 1. */
  minInteractionPixelRatio?: number;
  /** Multiplier applied when stepping down DPR during heavy interaction. Default: 0.75. */
  interactionDprScale?: number;
  /** Custom devicePixelRatio provider (useful in headless tests). */
  getDevicePixelRatio?: () => number;
  /** Custom RAF scheduler (defaults to global requestAnimationFrame / cancelAnimationFrame). */
  requestFrame?: (cb: (nowMs: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Custom clock (defaults to performance.now). */
  now?: () => number;
}

const POINTER_EPSILON = 1e-5;

/**
 * Demand-driven + dirty-window render governor for Studio:
 * - Renders immediately while dirty or during active interaction.
 * - Renders a short settle tail (default 12 frames / 250ms) for damped camera/GI transitions,
 *   snapping adaptive DPR back to crisp native resolution before pausing at 0 renders/sec!
 * - Rate-limits pointer-hover raycasts to at most 1 per animation frame (and 0 if pointer
 *   coordinates haven't moved or during active gizmo/camera drag).
 */
export class FrameGovernor {
  readonly perf: PerfMonitor;

  private readonly onRender: (ctx: FrameGovernorContext) => FrameRenderStats | void;
  private readonly onPixelRatioChange?: (pixelRatio: number) => void;
  private readonly onIdleStateChange?: (idlePaused: boolean) => void;
  private readonly settleFramesTarget: number;
  private readonly settleMsTarget: number;
  private readonly adaptiveDprEnabled: boolean;
  private readonly frameBudgetMs: number;
  private readonly maxNativePixelRatio: number;
  private readonly minInteractionPixelRatio: number;
  private readonly interactionDprScale: number;
  private readonly getDpr: () => number;
  private readonly reqFrame: (cb: (nowMs: number) => void) => number;
  private readonly cancelFrameFn: (handle: number) => void;
  private readonly nowFn: () => number;

  private running = false;
  private disposed = false;
  private rafHandle: number | null = null;

  private dirtyMask = REASON_BITS.scene;
  private activeInteractionMask = 0;
  private remainingSettleFrames = 0;
  private settleDeadlineMs = 0;
  private idlePaused = false;

  private currentPixelRatio = 1;
  private steppedDown = false;

  // Hover raycast rate-limiter state (zero allocations)
  private pendingHover = false;
  private pendingHoverX = NaN;
  private pendingHoverY = NaN;
  private lastEvaluatedHoverX = NaN;
  private lastEvaluatedHoverY = NaN;
  private hoverConsumedInCurrentFrame = false;
  private readonly hoverOut: HoverPointerCoords = { x: 0, y: 0 };

  private readonly renderCtx: FrameGovernorContext = {
    nowMs: 0,
    dirtyReasonsMask: 0,
    isInteracting: false,
    isSettling: false,
    pixelRatio: 1,
    hoverPointer: null,
  };

  constructor(options: FrameGovernorOptions) {
    this.onRender = options.onRender;
    this.onPixelRatioChange = options.onPixelRatioChange;
    this.onIdleStateChange = options.onIdleStateChange;
    this.perf = options.perfMonitor ?? new PerfMonitor(120);
    this.settleFramesTarget = Math.max(0, options.settleFrames ?? 12);
    this.settleMsTarget = Math.max(0, options.settleMs ?? 250);
    this.adaptiveDprEnabled = options.adaptiveDpr ?? true;
    this.frameBudgetMs = Math.max(4, options.frameBudgetMs ?? 20);
    this.maxNativePixelRatio = Math.max(1, options.maxNativePixelRatio ?? 2);
    this.minInteractionPixelRatio = Math.max(0.5, options.minInteractionPixelRatio ?? 1);
    this.interactionDprScale = Math.min(0.95, Math.max(0.5, options.interactionDprScale ?? 0.75));

    this.getDpr =
      options.getDevicePixelRatio ??
      (() => (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1));
    this.reqFrame =
      options.requestFrame ??
      ((cb) =>
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(cb)
          : (setTimeout(() => cb(this.nowFn()), 16) as unknown as number));
    this.cancelFrameFn =
      options.cancelFrame ??
      ((handle) => {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
        else clearTimeout(handle);
      });
    this.nowFn = options.now ?? (() => performance.now());

    this.currentPixelRatio = this.getNativePixelRatio();
    this.perf.setPixelRatio(this.currentPixelRatio);
    this.remainingSettleFrames = this.settleFramesTarget;
    this.settleDeadlineMs = this.nowFn() + this.settleMsTarget;
  }

  getNativePixelRatio(): number {
    const raw = this.getDpr();
    const safe = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return Math.min(safe, this.maxNativePixelRatio);
  }

  getPixelRatio(): number {
    return this.currentPixelRatio;
  }

  refreshNativePixelRatio(): void {
    if (!this.steppedDown) {
      const native = this.getNativePixelRatio();
      if (Math.abs(native - this.currentPixelRatio) > 1e-4) {
        this.currentPixelRatio = native;
        this.perf.setPixelRatio(native);
        this.onPixelRatioChange?.(native);
      }
    }
  }

  isIdlePaused(): boolean {
    return this.idlePaused;
  }

  isInteracting(): boolean {
    return this.activeInteractionMask !== 0;
  }

  hasDirtyReason(reason: DirtyReason): boolean {
    return (this.dirtyMask & REASON_BITS[reason]) !== 0;
  }

  /**
   * Marks the viewport dirty for `reason` and wakes the render loop immediately (< 1 frame)
   * if currently paused at 0 renders/sec.
   */
  invalidate(reason: DirtyReason = 'scene', nowMs = this.nowFn()): void {
    if (this.disposed) return;
    this.dirtyMask |= REASON_BITS[reason];

    if (reason === 'hover') {
      // Hover checks need only 1 immediate frame unless hover highlight subsequently invalidates 'scene'.
      this.remainingSettleFrames = Math.max(this.remainingSettleFrames, 1);
      this.settleDeadlineMs = Math.max(this.settleDeadlineMs, nowMs + 16);
    } else {
      this.remainingSettleFrames = Math.max(this.remainingSettleFrames, this.settleFramesTarget);
      this.settleDeadlineMs = Math.max(this.settleDeadlineMs, nowMs + this.settleMsTarget);
    }

    if (this.idlePaused) {
      this.idlePaused = false;
      this.perf.setIdlePaused(false);
      this.onIdleStateChange?.(false);
    }
    this.ensureScheduled();
  }

  /**
   * Begins a continuous interaction (e.g. orbit drag, gizmo transform, pose slider drag).
   * Suppresses hover raycasts and keeps rendering active until `endInteraction` + settle window.
   */
  beginInteraction(reason: DirtyReason = 'continuousInteraction', nowMs = this.nowFn()): void {
    if (this.disposed) return;
    this.activeInteractionMask |= REASON_BITS[reason];
    this.pendingHover = false;
    this.invalidate(reason, nowMs);
  }

  /**
   * Ends a continuous interaction and starts the settle tail (12 frames / 250ms),
   * restoring full native DPR before entering idle pause.
   */
  endInteraction(reason?: DirtyReason, nowMs = this.nowFn()): void {
    if (this.disposed) return;
    if (reason) {
      this.activeInteractionMask &= ~REASON_BITS[reason];
    } else {
      this.activeInteractionMask = 0;
    }

    if (this.activeInteractionMask === 0) {
      this.remainingSettleFrames = Math.max(this.remainingSettleFrames, this.settleFramesTarget);
      this.settleDeadlineMs = Math.max(this.settleDeadlineMs, nowMs + this.settleMsTarget);
      this.restoreNativePixelRatio();
      this.dirtyMask |= REASON_BITS.scene;
      this.ensureScheduled();
    }
  }

  /**
   * Queues a pointermove coordinate for hover raycasting.
   * Ignores redundant identical coordinates and suppresses hover work during active drag/orbit.
   * Returns true if a new hover sample was queued.
   */
  queueHoverPointer(x: number, y: number, isDragging = false, nowMs = this.nowFn()): boolean {
    if (this.disposed || isDragging || this.activeInteractionMask !== 0) {
      this.pendingHover = false;
      return false;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }

    const sameAsLastEvaluated =
      !this.pendingHover &&
      Math.abs(x - this.lastEvaluatedHoverX) <= POINTER_EPSILON &&
      Math.abs(y - this.lastEvaluatedHoverY) <= POINTER_EPSILON;
    if (sameAsLastEvaluated) {
      return false;
    }

    const sameAsPending =
      this.pendingHover &&
      Math.abs(x - this.pendingHoverX) <= POINTER_EPSILON &&
      Math.abs(y - this.pendingHoverY) <= POINTER_EPSILON;
    if (sameAsPending) {
      return false;
    }

    this.pendingHoverX = x;
    this.pendingHoverY = y;
    this.pendingHover = true;
    this.invalidate('hover', nowMs);
    return true;
  }

  /**
   * Consumes at most 1 queued hover pointer coordinate in the current animation frame.
   * Returns `null` if pointer hasn't moved, drag is active, or hover already ran this frame.
   */
  consumeHoverRaycast(isDragging = false): Readonly<HoverPointerCoords> | null {
    if (
      !this.pendingHover ||
      this.hoverConsumedInCurrentFrame ||
      isDragging ||
      this.activeInteractionMask !== 0
    ) {
      return null;
    }
    if (
      Math.abs(this.pendingHoverX - this.lastEvaluatedHoverX) <= POINTER_EPSILON &&
      Math.abs(this.pendingHoverY - this.lastEvaluatedHoverY) <= POINTER_EPSILON
    ) {
      this.pendingHover = false;
      return null;
    }

    this.pendingHover = false;
    this.hoverConsumedInCurrentFrame = true;
    this.lastEvaluatedHoverX = this.pendingHoverX;
    this.lastEvaluatedHoverY = this.pendingHoverY;
    this.hoverOut.x = this.pendingHoverX;
    this.hoverOut.y = this.pendingHoverY;
    return this.hoverOut;
  }

  resetHoverState(): void {
    this.pendingHover = false;
    this.lastEvaluatedHoverX = NaN;
    this.lastEvaluatedHoverY = NaN;
    this.hoverConsumedInCurrentFrame = false;
  }

  /**
   * Starts automatic RAF scheduling. Immediately schedules a frame if currently dirty.
   */
  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.ensureScheduled();
  }

  /**
   * Stops automatic RAF scheduling without disposing state.
   */
  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      this.cancelFrameFn(this.rafHandle);
      this.rafHandle = null;
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  /**
   * Executes a single governed tick at `nowMs`.
   * Returns `true` if a frame was rendered, or `false` if the governor is idle-paused (`0` GPU work).
   */
  step(nowMs = this.nowFn()): boolean {
    if (this.disposed) return false;
    this.hoverConsumedInCurrentFrame = false;

    const interacting = this.activeInteractionMask !== 0;
    const explicitlyDirty = this.dirtyMask !== 0;
    const withinSettleWindow =
      this.remainingSettleFrames > 0 || nowMs < this.settleDeadlineMs;

    if (!interacting && !explicitlyDirty && !withinSettleWindow) {
      // Ensure native crisp DPR was restored before sleeping.
      if (this.steppedDown) {
        this.restoreNativePixelRatio();
      } else {
        this.enterIdlePause();
        return false;
      }
    }

    // Update adaptive DPR before rendering this frame.
    const heavyFrame =
      interacting || (this.dirtyMask & INTERACTION_HEAVY_MASK) !== 0;
    this.updateAdaptivePixelRatio(heavyFrame);

    const hoverCoords = this.consumeHoverRaycast(interacting);

    this.renderCtx.nowMs = nowMs;
    this.renderCtx.dirtyReasonsMask = this.dirtyMask | this.activeInteractionMask;
    this.renderCtx.isInteracting = interacting;
    this.renderCtx.isSettling = !interacting && !explicitlyDirty && withinSettleWindow;
    this.renderCtx.pixelRatio = this.currentPixelRatio;
    this.renderCtx.hoverPointer = hoverCoords;

    // Clear one-shot dirty flags prior to render so re-entrant invalidations during onRender are preserved.
    this.dirtyMask = 0;

    const t0 = this.nowFn();
    const renderStats = this.onRender(this.renderCtx);
    const t1 = this.nowFn();
    const elapsedMs = Math.max(0, t1 - t0);

    this.perf.recordFrame(elapsedMs, {
      drawCalls: renderStats?.drawCalls,
      triangles: renderStats?.triangles,
      shadowUpdates: renderStats?.shadowUpdates,
      timestampMs: t1,
    });

    // Re-evaluate adaptive DPR immediately after measuring this frame so the next drag frame benefits.
    if (heavyFrame && this.adaptiveDprEnabled && elapsedMs > this.frameBudgetMs) {
      const rollingAvg = this.perf.getRollingAverageFrameMs(4);
      if (rollingAvg > this.frameBudgetMs) {
        this.stepDownPixelRatio();
      }
    }

    if (!interacting && this.dirtyMask === 0) {
      if (this.remainingSettleFrames > 0) {
        this.remainingSettleFrames--;
        if (
          t1 >= this.settleDeadlineMs + this.settleMsTarget &&
          this.remainingSettleFrames <= this.settleFramesTarget - 2
        ) {
          this.remainingSettleFrames = 0;
        }
      }
      // On the final settle frame if we had stepped down DPR, restore crisp native DPR for one final crisp frame!
      const settleDone =
        this.remainingSettleFrames <= 0 && t1 >= this.settleDeadlineMs;
      if (settleDone) {
        if (this.steppedDown) {
          this.restoreNativePixelRatio();
          this.remainingSettleFrames = 1;
        } else {
          this.enterIdlePause();
        }
      }
    }

    return true;
  }

  getMetricsSnapshot(out?: PerfMetricsSnapshot): PerfMetricsSnapshot {
    return this.perf.getSnapshot(out);
  }

  private enterIdlePause(): void {
    const wasIdle = this.idlePaused;
    this.idlePaused = true;
    this.perf.setIdlePaused(true);
    if (this.rafHandle !== null) {
      this.cancelFrameFn(this.rafHandle);
      this.rafHandle = null;
    }
    if (!wasIdle) {
      this.onIdleStateChange?.(true);
    }
  }

  private ensureScheduled(): void {
    if (!this.running || this.disposed || this.rafHandle !== null) return;
    this.rafHandle = this.reqFrame(this.onAnimationFrame);
  }

  private readonly onAnimationFrame = (rafNowMs: number): void => {
    this.rafHandle = null;
    if (!this.running || this.disposed) return;

    const nowMs = Number.isFinite(rafNowMs) ? rafNowMs : this.nowFn();
    this.step(nowMs);

    if (this.running && !this.disposed && !this.idlePaused) {
      this.ensureScheduled();
    }
  };

  private updateAdaptivePixelRatio(heavyInteraction: boolean): void {
    const nativeDpr = this.getNativePixelRatio();
    if (!this.adaptiveDprEnabled) {
      this.applyPixelRatio(nativeDpr, false);
      return;
    }

    if (heavyInteraction) {
      const rollingMs = this.perf.getRollingAverageFrameMs(4);
      if (rollingMs > this.frameBudgetMs) {
        this.stepDownPixelRatio();
      }
    } else if (this.steppedDown && this.activeInteractionMask === 0) {
      this.restoreNativePixelRatio();
    } else if (!this.steppedDown && Math.abs(this.currentPixelRatio - nativeDpr) > 1e-3) {
      this.applyPixelRatio(nativeDpr, false);
    }
  }

  private stepDownPixelRatio(): void {
    const nativeDpr = this.getNativePixelRatio();
    const minDpr = Math.min(nativeDpr, this.minInteractionPixelRatio);
    const target = Math.max(minDpr, Number((nativeDpr * this.interactionDprScale).toFixed(3)));
    if (target < this.currentPixelRatio - 1e-3) {
      this.applyPixelRatio(target, true);
    }
  }

  private restoreNativePixelRatio(): void {
    const nativeDpr = this.getNativePixelRatio();
    this.applyPixelRatio(nativeDpr, false);
  }

  private applyPixelRatio(nextDpr: number, isSteppedDown: boolean): void {
    this.steppedDown = isSteppedDown;
    if (Math.abs(nextDpr - this.currentPixelRatio) <= 1e-3) return;
    this.currentPixelRatio = nextDpr;
    this.perf.setPixelRatio(nextDpr);
    this.onPixelRatioChange?.(nextDpr);
  }
}
