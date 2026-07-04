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

  add(config: CustomCalcConfig) {
    this.configs.set(config.id, config);
  }

  get(id: string): CustomCalcConfig | undefined {
    return this.configs.get(id);
  }

  list(): CustomCalcConfig[] {
    return Array.from(this.configs.values());
  }

  clear() {
    this.configs.clear();
  }
}

export const customCalcRegistry = new CustomCalcRegistry();
