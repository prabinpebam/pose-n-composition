export interface PerfMetricsSnapshot {
  fps: number;
  frameMs: number;
  frameMsP95: number;
  raycastMs: number;
  drawCalls: number;
  triangles: number;
  shadowUpdates: number;
  idlePaused: boolean;
  pixelRatio: number;
  totalFrames: number;
}

export interface FrameRenderStats {
  drawCalls?: number;
  triangles?: number;
  shadowUpdates?: number;
  timestampMs?: number;
}

/**
 * Zero-allocation rolling ring-buffer performance monitor for live Studio telemetry
 * and quantitative DoD verification.
 */
export class PerfMonitor {
  private readonly capacity: number;
  private readonly frameMsRing: Float64Array;
  private readonly frameTsRing: Float64Array;
  private readonly sortScratch: Float64Array;
  private readonly raycastMsRing: Float64Array;

  private frameHead = 0;
  private frameCount = 0;
  private totalFrames = 0;

  private raycastHead = 0;
  private raycastCount = 0;

  private drawCalls = 0;
  private triangles = 0;
  private shadowUpdates = 0;
  private idlePaused = false;
  private pixelRatio = 1;

  private readonly snapshotCache: PerfMetricsSnapshot = {
    fps: 0,
    frameMs: 0,
    frameMsP95: 0,
    raycastMs: 0,
    drawCalls: 0,
    triangles: 0,
    shadowUpdates: 0,
    idlePaused: false,
    pixelRatio: 1,
    totalFrames: 0,
  };

  constructor(windowSize = 120) {
    const cap = Math.max(8, Math.floor(windowSize));
    this.capacity = cap;
    this.frameMsRing = new Float64Array(cap);
    this.frameTsRing = new Float64Array(cap);
    this.sortScratch = new Float64Array(cap);
    this.raycastMsRing = new Float64Array(cap);
  }

  beginFrame(nowMs = performance.now()): number {
    return nowMs;
  }

  endFrame(startMs: number, stats?: FrameRenderStats, nowMs = performance.now()): void {
    const elapsed = Math.max(0, nowMs - startMs);
    this.recordFrame(elapsed, {
      drawCalls: stats?.drawCalls,
      triangles: stats?.triangles,
      shadowUpdates: stats?.shadowUpdates,
      timestampMs: stats?.timestampMs ?? nowMs,
    });
  }

  recordFrame(frameMs: number, stats?: FrameRenderStats): void {
    const safeFrameMs = Number.isFinite(frameMs) && frameMs >= 0 ? frameMs : 0;
    const ts = stats?.timestampMs ?? performance.now();

    this.frameMsRing[this.frameHead] = safeFrameMs;
    this.frameTsRing[this.frameHead] = ts;
    this.frameHead = (this.frameHead + 1) % this.capacity;
    if (this.frameCount < this.capacity) {
      this.frameCount++;
    }
    this.totalFrames++;
    this.idlePaused = false;

    if (stats?.drawCalls !== undefined) {
      this.drawCalls = stats.drawCalls;
    }
    if (stats?.triangles !== undefined) {
      this.triangles = stats.triangles;
    }
    if (stats?.shadowUpdates !== undefined && stats.shadowUpdates > 0) {
      this.shadowUpdates += stats.shadowUpdates;
    }
  }

  recordRaycast(durationMs: number): void {
    const safeMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    this.raycastMsRing[this.raycastHead] = safeMs;
    this.raycastHead = (this.raycastHead + 1) % this.capacity;
    if (this.raycastCount < this.capacity) {
      this.raycastCount++;
    }
  }

  recordShadowUpdate(count = 1): void {
    if (count > 0) {
      this.shadowUpdates += count;
    }
  }

  setIdlePaused(paused: boolean): void {
    this.idlePaused = paused;
  }

  setPixelRatio(dpr: number): void {
    if (Number.isFinite(dpr) && dpr > 0) {
      this.pixelRatio = dpr;
    }
  }

  getRollingAverageFrameMs(sampleLimit = this.frameCount): number {
    const n = Math.min(this.frameCount, Math.max(0, sampleLimit));
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = (this.frameHead - 1 - i + this.capacity) % this.capacity;
      sum += this.frameMsRing[idx]!;
    }
    return sum / n;
  }

  getP95FrameMs(): number {
    const n = this.frameCount;
    if (n === 0) return 0;
    for (let i = 0; i < n; i++) {
      this.sortScratch[i] = this.frameMsRing[i]!;
    }
    const sub = this.sortScratch.subarray(0, n);
    sub.sort();
    const p95Idx = Math.min(n - 1, Math.floor(n * 0.95));
    return sub[p95Idx]!;
  }

  getRollingRaycastMs(): number {
    const n = this.raycastCount;
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += this.raycastMsRing[i]!;
    }
    return sum / n;
  }

  private computeFps(): number {
    if (this.idlePaused) return 0;
    const n = this.frameCount;
    if (n === 0) return 0;
    if (n >= 2) {
      const newestIdx = (this.frameHead - 1 + this.capacity) % this.capacity;
      const oldestIdx = (this.frameHead - n + this.capacity) % this.capacity;
      const spanMs = this.frameTsRing[newestIdx]! - this.frameTsRing[oldestIdx]!;
      if (spanMs > 1) {
        return ((n - 1) * 1000) / spanMs;
      }
    }
    const avgMs = this.getRollingAverageFrameMs();
    return avgMs > 0.001 ? Math.min(240, 1000 / avgMs) : 0;
  }

  getSnapshot(out?: PerfMetricsSnapshot): PerfMetricsSnapshot {
    const target = out ?? this.snapshotCache;
    target.fps = this.computeFps();
    target.frameMs = this.getRollingAverageFrameMs();
    target.frameMsP95 = this.getP95FrameMs();
    target.raycastMs = this.getRollingRaycastMs();
    target.drawCalls = this.drawCalls;
    target.triangles = this.triangles;
    target.shadowUpdates = this.shadowUpdates;
    target.idlePaused = this.idlePaused;
    target.pixelRatio = this.pixelRatio;
    target.totalFrames = this.totalFrames;
    return target;
  }

  reset(): void {
    this.frameHead = 0;
    this.frameCount = 0;
    this.totalFrames = 0;
    this.raycastHead = 0;
    this.raycastCount = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.shadowUpdates = 0;
    this.idlePaused = false;
  }
}
