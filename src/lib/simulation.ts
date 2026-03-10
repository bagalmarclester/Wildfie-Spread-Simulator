export const STATE_UNBURNT = 0;
export const STATE_BURNING = 1;
export const STATE_BURNT = 2;
export const STATE_NON_FLAMMABLE = 3;

export class FireSimulator {
  public width: number;
  public height: number;
  public state: Uint8Array;
  public fuel: Float32Array;
  public activeCells: Set<number>;
  
  public initialState: Uint8Array;
  public initialFuel: Float32Array;
  
  public windX: number = 0;
  public windY: number = 0;
  public windSpeed: number = 0;
  public humidity: number = 0.2;
  public baseIgnitionProb: number = 0.03;
  public fuelBurnRate: number = 0.01;

  public totalBurnt: number = 0;
  public newlyBurntAccumulator: number = 0;
  public burnRateHistory: number[] = [];
  public lastTickTime: number = 0;
  
  public elapsedTicks: number = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.state = new Uint8Array(width * height);
    this.fuel = new Float32Array(width * height);
    this.initialState = new Uint8Array(width * height);
    this.initialFuel = new Float32Array(width * height);
    this.activeCells = new Set();
  }

  public loadFromImageData(imageData: ImageData) {
    const data = imageData.data;
    this.activeCells.clear();
    this.totalBurnt = 0;
    this.newlyBurntAccumulator = 0;
    this.burnRateHistory = [];
    this.elapsedTicks = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const idx = i / 4;

      // Use Excess Green (ExG) index to detect vegetation in satellite imagery
      // ExG = 2G - R - B. It highlights green areas and suppresses reds/blues/grays.
      const exG = 2 * g - r - b;
      
      // If ExG is positive and significant, it's likely vegetation (trees, grass)
      if (exG > 15) {
        this.state[idx] = STATE_UNBURNT;
        // Normalize fuel based on how "green" it is. 
        // Darker/denser greens get more fuel.
        this.fuel[idx] = Math.min(1.0, 0.3 + (exG / 150));
      } else {
        // Buildings, roads, water, dirt, and UI elements become non-flammable barriers
        this.state[idx] = STATE_NON_FLAMMABLE;
        this.fuel[idx] = 0;
      }
    }
    
    // Save initial state for fast resets
    this.initialState.set(this.state);
    this.initialFuel.set(this.fuel);
  }

  public reset() {
    this.state.set(this.initialState);
    this.fuel.set(this.initialFuel);
    this.activeCells.clear();
    this.totalBurnt = 0;
    this.newlyBurntAccumulator = 0;
    this.burnRateHistory = [];
    this.elapsedTicks = 0;
  }

  public getRandomFlammablePoint(): { x: number, y: number } | null {
    // Try random points until we find a flammable one
    // Cap at 1000 tries to avoid infinite loops on non-flammable maps
    for (let i = 0; i < 1000; i++) {
      const x = Math.floor(Math.random() * this.width);
      const y = Math.floor(Math.random() * this.height);
      if (this.initialState[y * this.width + x] === STATE_UNBURNT) {
        return { x, y };
      }
    }
    return null;
  }

  public ignite(x: number, y: number, radius: number = 2) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const idx = ny * this.width + nx;
          if (this.state[idx] === STATE_UNBURNT) {
            this.state[idx] = STATE_BURNING;
            this.activeCells.add(idx);
          }
        }
      }
    }
  }

  public tick() {
    if (this.activeCells.size > 0) {
      this.elapsedTicks++;
    }

    const newActiveCells = new Set<number>();
    const neighbors = [
      [-1, -1], [0, -1], [1, -1],
      [-1,  0],          [1,  0],
      [-1,  1], [0,  1], [1,  1]
    ];

    let newlyBurntThisTick = 0;

    for (const idx of this.activeCells) {
      // Burn fuel
      this.fuel[idx] -= this.fuelBurnRate;
      
      if (this.fuel[idx] <= 0) {
        this.state[idx] = STATE_BURNT;
        this.totalBurnt++;
        newlyBurntThisTick++;
      } else {
        newActiveCells.add(idx);
        
        const x = idx % this.width;
        const y = Math.floor(idx / this.width);

        // Try to ignite neighbors
        for (const [dx, dy] of neighbors) {
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            const nIdx = ny * this.width + nx;
            
            if (this.state[nIdx] === STATE_UNBURNT) {
              // Calculate wind factor
              // Dot product of wind vector and neighbor direction
              // Normalize neighbor direction
              const dist = Math.sqrt(dx * dx + dy * dy);
              const dirX = dx / dist;
              const dirY = dy / dist;
              
              const dot = (dirX * this.windX + dirY * this.windY);
              // Exponential wind effect: wind blowing towards neighbor increases prob significantly
              const windFactor = Math.exp(dot * this.windSpeed);
              
              const prob = this.baseIgnitionProb * this.fuel[nIdx] * windFactor * (1 - this.humidity);
              
              if (Math.random() < prob) {
                this.state[nIdx] = STATE_BURNING;
                newActiveCells.add(nIdx);
              }
            }
          }
        }
      }
    }

    this.activeCells = newActiveCells;
    this.newlyBurntAccumulator += newlyBurntThisTick;
    
    const now = performance.now();
    if (now - this.lastTickTime > 1000) {
      this.burnRateHistory.push(this.newlyBurntAccumulator);
      this.newlyBurntAccumulator = 0;
      if (this.burnRateHistory.length > 10) {
        this.burnRateHistory.shift();
      }
      this.lastTickTime = now;
    }
  }

  public getBurnRate(): number {
    if (this.burnRateHistory.length === 0) return 0;
    const sum = this.burnRateHistory.reduce((a, b) => a + b, 0);
    return sum / this.burnRateHistory.length;
  }

  public renderToImageData(imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < this.state.length; i++) {
      const state = this.state[i];
      const idx = i * 4;
      
      if (state === STATE_BURNING) {
        // Fire colors based on remaining fuel
        const fuel = this.fuel[i];
        if (fuel > 0.6) {
          data[idx] = 255;     // R
          data[idx+1] = 255;   // G (Yellow/White hot)
          data[idx+2] = 0;     // B
          data[idx+3] = 255;   // A
        } else if (fuel > 0.3) {
          data[idx] = 255;     // R
          data[idx+1] = 100;   // G (Orange)
          data[idx+2] = 0;     // B
          data[idx+3] = 255;   // A
        } else {
          data[idx] = 200;     // R
          data[idx+1] = 0;     // G (Red)
          data[idx+2] = 0;     // B
          data[idx+3] = 255;   // A
        }
      } else if (state === STATE_BURNT) {
        data[idx] = 30;      // R
        data[idx+1] = 30;    // G
        data[idx+2] = 30;    // B
        data[idx+3] = 200;   // A (Dark gray, slightly transparent)
      } else {
        // Transparent for unburnt or non-flammable to show background image
        data[idx+3] = 0;
      }
    }
  }
}
