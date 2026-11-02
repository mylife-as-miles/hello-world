/**
 * Interface between the runtime wrapper (src/runtime, coordinator-owned) and the
 * life simulation (src/simulation). Node-safe: no three/react/DOM imports.
 */
import type { ResidentProfile, Relationship, Weather, WorldEvent, WorldSnapshot } from '@hello-world/contracts';

export interface SimulationOptions {
  worldId: string;
  /** Restore everything from this snapshot (no duplicate seeds). */
  initialSnapshot?: WorldSnapshot;
  /** Add demonstration residents when the world is empty / new. */
  seedResidents: boolean;
  /** Wall clock in Unix ms at creation. Never used for decisions, only for timestamps. */
  now: number;
  /** Max population (contract: 50). */
  maxResidents: number;
}

export interface SimulationExport {
  residents: ResidentProfile[];
  relationships: Relationship[];
  weather: Weather;
  simulationTime: number;
}

export interface Simulation {
  /**
   * Apply an already validated + de-duplicated contract event.
   * Returns follow-up events produced by the world (source 'simulation'), e.g.
   * the target's reply to a greeting, which the runtime appends to history.
   */
  applyEvent(event: WorldEvent, now: number): WorldEvent[];
  /** Advance the simulation by a FIXED dt (seconds). Returns generated events. */
  step(dtSeconds: number, now: number): WorldEvent[];
  /** Fresh, plain-JSON copies of contract state (never shared references). */
  exportState(): SimulationExport;
  /** Number of residents currently in the world. */
  population(): number;
}

export type CreateSimulation = (options: SimulationOptions) => Simulation;
