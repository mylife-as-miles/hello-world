import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorldSnapshot } from "@hello-world/contracts";
import { parseSnapshot } from "./validation.js";

export class SnapshotStore {
  readonly path: string;
  private latest: WorldSnapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> = Promise.resolve();
  lastSavedAt: number | null = null;
  error: string | null = null;
  constructor(
    private dataDir: string,
    private worldId: string,
  ) {
    this.path = join(dataDir, "world.json");
  }
  async load(): Promise<WorldSnapshot | undefined> {
    try {
      const snapshot = parseSnapshot(
        JSON.parse(await readFile(this.path, "utf8")),
      );
      if (snapshot.worldId !== this.worldId)
        throw new Error("Saved world ID differs from configured WORLD_ID");
      return snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(
        "Saved world is invalid; preserve .data/world.json and recover it before restarting",
        { cause: error },
      );
    }
  }
  schedule(snapshot: WorldSnapshot) {
    this.latest = snapshot;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 750);
    this.timer.unref();
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const snapshot = this.latest;
    this.latest = undefined;
    if (!snapshot) return this.pending;
    this.pending = this.pending.then(async () => {
      try {
        await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
        const temp = `${this.path}.tmp`;
        await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
        await rename(temp, this.path);
        this.lastSavedAt = Date.now();
        this.error = null;
      } catch {
        this.error =
          "World save failed; check DATA_DIR permissions and free space";
      }
    });
    return this.pending;
  }
}
