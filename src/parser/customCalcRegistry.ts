import droneRoll from '../../json/drone_roll.json';
import dronePitch from '../../json/drone_pitch.json';
import droneYaw from '../../json/drone_yaw.json';
import droneYaw360 from '../../json/drone_yaw_360.json';

export interface CustomCalcConfig {
  id: string;
  name: string;
  expression?: string;
  operations?: any[];
  targetChart: {
    title: string;
    yLabel: string;
    color: string;
  };
}

class CustomCalcRegistry {
  private configs = new Map<string, CustomCalcConfig>();

  constructor() {
    this.add(droneRoll as any);
    this.add(dronePitch as any);
    this.add(droneYaw as any);
    this.add(droneYaw360 as any);
  }

  add(config: CustomCalcConfig) {
    this.configs.set(config.id, config);
  }

  get(id: string): CustomCalcConfig | undefined {
    return this.configs.get(id);
  }

  remove(id: string) {
    this.configs.delete(id);
  }

  list(): CustomCalcConfig[] {
    return Array.from(this.configs.values());
  }

  clear() {
    this.configs.clear();
  }
}

export const customCalcRegistry = new CustomCalcRegistry();
