import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FireSimulator, STATE_BURNT } from '../lib/simulation';
import { Play, Pause, RotateCcw, Upload, Wind, Droplets, Flame, AlertTriangle, Layers, X, TrendingUp, TrendingDown, Activity, Map } from 'lucide-react';
import mapImage from './map.png';

const SIM_WIDTH = 500;
const SIM_HEIGHT = 500;

type BatchResult = {
  id: number;
  conditionName: string;
  windSpeed: number;
  windDir: number;
  humidity: number;
  totalBurnt: number;
  duration: number;
};

export default function FireSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<FireSimulator | null>(null);
  const requestRef = useRef<number>();
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [windDir, setWindDir] = useState(0); // degrees
  const [windSpeed, setWindSpeed] = useState(1);
  const [humidity, setHumidity] = useState(0.2);
  const [numSimulations, setNumSimulations] = useState(10);
  
  // Metrics
  const [activeFires, setActiveFires] = useState(0);
  const [totalBurnt, setTotalBurnt] = useState(0);
  const [burnRate, setBurnRate] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResultsModal, setShowResultsModal] = useState(false);

  // Batch Simulation State
  const [ignitionPoints, setIgnitionPoints] = useState<{x: number, y: number}[]>([]);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [heatmapUrl, setHeatmapUrl] = useState<string | null>(null);
  const [batchEnv, setBatchEnv] = useState({ windDir: 0, windSpeed: 0, humidity: 0 });

  const prevActiveFires = useRef(0);

  const maxBurnt = batchResults.length > 0 ? Math.max(...batchResults.map(r => r.totalBurnt)) : 0;
  const minBurnt = batchResults.length > 0 ? Math.min(...batchResults.map(r => r.totalBurnt)) : 0;
  const avgBurnt = batchResults.length > 0 ? batchResults.reduce((acc, curr) => acc + curr.totalBurnt, 0) / batchResults.length : 0;
  const avgDuration = batchResults.length > 0 ? batchResults.reduce((acc, curr) => acc + curr.duration, 0) / batchResults.length : 0;

  useEffect(() => {
    if (prevActiveFires.current > 0 && activeFires === 0 && totalBurnt > 0) {
      setShowResultsModal(true);
      setIsPlaying(false);
    }
    prevActiveFires.current = activeFires;
  }, [activeFires, totalBurnt]);

  const formatTime = (ticks: number) => {
    // 1 tick = 10 seconds of simulated time
    const totalSeconds = ticks * 10;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
  };

  const formatArea = (pixels: number) => {
    // Assume 1 pixel = 10m x 10m = 100 sq meters = ~0.0247 acres
    const acres = pixels * 0.0247105;
    if (acres < 0.1 && pixels > 0) return '< 0.1 Acres';
    return `${Math.round(acres).toLocaleString()} Acres`;
  };

  // Initialize simulation
  useEffect(() => {
    simRef.current = new FireSimulator(SIM_WIDTH, SIM_HEIGHT);
    
    // Load default image (top-down aerial view of a city park)
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = mapImage;
    img.onload = () => {
      if (bgCanvasRef.current && simRef.current) {
        const ctx = bgCanvasRef.current.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, SIM_WIDTH, SIM_HEIGHT);
          const imageData = ctx.getImageData(0, 0, SIM_WIDTH, SIM_HEIGHT);
          simRef.current.loadFromImageData(imageData);
          drawFrame(); // Initial draw
        }
      }
    };
  }, []);

  // Update simulation parameters when state changes
  useEffect(() => {
    if (simRef.current) {
      const rad = (windDir * Math.PI) / 180;
      simRef.current.windX = Math.cos(rad);
      simRef.current.windY = Math.sin(rad);
      simRef.current.windSpeed = windSpeed;
      simRef.current.humidity = humidity;
    }
  }, [windDir, windSpeed, humidity]);

  const drawFrame = useCallback(() => {
    if (!simRef.current || !canvasRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // We need an ImageData object to render the fire
    const imageData = ctx.createImageData(SIM_WIDTH, SIM_HEIGHT);
    simRef.current.renderToImageData(imageData);
    ctx.putImageData(imageData, 0, 0);

    // Update metrics
    setActiveFires(simRef.current.activeCells.size);
    setTotalBurnt(simRef.current.totalBurnt);
    setBurnRate(simRef.current.getBurnRate());
    setElapsedTime(simRef.current.elapsedTicks);
  }, []);

  const tick = useCallback(() => {
    if (!simRef.current) return;
    
    // Run multiple ticks per frame for faster simulation
    for (let i = 0; i < 3; i++) {
      simRef.current.tick();
    }
    
    drawFrame();
    
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(tick);
    }
  }, [isPlaying, drawFrame]);

  useEffect(() => {
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, tick]);

  const runHeadlessSimulation = (
    imageData: ImageData, 
    points: {x: number, y: number}[],
    simWindDir: number,
    simWindSpeed: number,
    simHumidity: number
  ) => {
    return new Promise<{totalBurnt: number, duration: number, finalState: Uint8Array}>(resolve => {
      const sim = new FireSimulator(SIM_WIDTH, SIM_HEIGHT);
      sim.loadFromImageData(imageData);
      
      const rad = (simWindDir * Math.PI) / 180;
      sim.windX = Math.cos(rad);
      sim.windY = Math.sin(rad);
      sim.windSpeed = simWindSpeed;
      sim.humidity = simHumidity;

      points.forEach(p => sim.ignite(p.x, p.y, 5));

      const tickBatch = () => {
        let active = true;
        for (let i = 0; i < 500; i++) {
          sim.tick();
          if (sim.activeCells.size === 0) {
            active = false;
            break;
          }
        }
        
        if (active) {
          setTimeout(tickBatch, 0);
        } else {
          resolve({
            totalBurnt: sim.totalBurnt,
            duration: sim.elapsedTicks,
            finalState: new Uint8Array(sim.state)
          });
        }
      };
      
      tickBatch();
    });
  };

  const runBatch = async () => {
    if (ignitionPoints.length === 0) {
      alert("Please click on the map to set at least one ignition point first.");
      return;
    }
    
    setIsPlaying(false);
    setIsBatchRunning(true);
    setShowBatchModal(true);
    setBatchResults([]);
    setHeatmapUrl(null);
    setBatchEnv({ windDir, windSpeed, humidity });

    const baseScenarios = [
      { name: "Current Settings", windDir, windSpeed, humidity },
      { name: "High Wind", windDir, windSpeed: Math.min(5, windSpeed * 2 + 1), humidity },
      { name: "Low Wind", windDir, windSpeed: Math.max(0, windSpeed * 0.5), humidity },
      { name: "Dry Conditions", windDir, windSpeed, humidity: Math.max(0, humidity - 0.2) },
      { name: "Humid Conditions", windDir, windSpeed, humidity: Math.min(0.8, humidity + 0.3) },
      { name: "Wind Shift (+90°)", windDir: (windDir + 90) % 360, windSpeed, humidity },
      { name: "Wind Shift (-90°)", windDir: (windDir + 270) % 360, windSpeed, humidity },
      { name: "Opposite Wind", windDir: (windDir + 180) % 360, windSpeed, humidity },
      { name: "Worst Case (Extreme)", windDir, windSpeed: 5, humidity: 0 },
      { name: "Best Case (Mild)", windDir, windSpeed: 0, humidity: 0.8 },
      { name: "High Wind + Dry", windDir, windSpeed: Math.min(5, windSpeed * 2 + 1), humidity: Math.max(0, humidity - 0.2) },
      { name: "Low Wind + Humid", windDir, windSpeed: Math.max(0, windSpeed * 0.5), humidity: Math.min(0.8, humidity + 0.3) },
      { name: "Gale Force", windDir, windSpeed: 5, humidity },
      { name: "Bone Dry", windDir, windSpeed, humidity: 0 },
      { name: "Saturated", windDir, windSpeed, humidity: 0.8 },
      { name: "Wind Shift (+45°)", windDir: (windDir + 45) % 360, windSpeed, humidity },
      { name: "Wind Shift (-45°)", windDir: (windDir + 315) % 360, windSpeed, humidity },
      { name: "High Wind + Humid", windDir, windSpeed: Math.min(5, windSpeed * 2 + 1), humidity: Math.min(0.8, humidity + 0.3) },
      { name: "Low Wind + Dry", windDir, windSpeed: Math.max(0, windSpeed * 0.5), humidity: Math.max(0, humidity - 0.2) },
      { name: "Chaotic Wind", windDir: (windDir + 135) % 360, windSpeed: Math.min(5, windSpeed * 1.5), humidity: Math.max(0, humidity - 0.1) },
    ];

    const scenarios = [];
    for (let i = 0; i < numSimulations; i++) {
      if (i < baseScenarios.length) {
        scenarios.push(baseScenarios[i]);
      } else {
        const vWindDir = (windDir + (Math.random() * 120 - 60) + 360) % 360;
        const vWindSpeed = Math.max(0, Math.min(5, windSpeed + (Math.random() * 2 - 1)));
        const vHumidity = Math.max(0, Math.min(0.8, humidity + (Math.random() * 0.4 - 0.2)));
        scenarios.push({
          name: `Random Variation #${i + 1 - baseScenarios.length}`,
          windDir: Math.round(vWindDir),
          windSpeed: Number(vWindSpeed.toFixed(1)),
          humidity: Number(vHumidity.toFixed(2))
        });
      }
    }

    const numRuns = scenarios.length;
    setBatchProgress({ current: 0, total: numRuns });

    const ctx = bgCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, SIM_WIDTH, SIM_HEIGHT);

    const results: BatchResult[] = [];
    const burnCounts = new Uint16Array(SIM_WIDTH * SIM_HEIGHT);

    for (let i = 0; i < numRuns; i++) {
      setBatchProgress({ current: i + 1, total: numRuns });
      const scenario = scenarios[i];
      const result = await runHeadlessSimulation(imageData, ignitionPoints, scenario.windDir, scenario.windSpeed, scenario.humidity);
      
      for (let j = 0; j < result.finalState.length; j++) {
        if (result.finalState[j] === STATE_BURNT) {
          burnCounts[j]++;
        }
      }
      
      results.push({ 
        id: i + 1, 
        conditionName: scenario.name,
        windDir: scenario.windDir,
        windSpeed: scenario.windSpeed,
        humidity: scenario.humidity,
        totalBurnt: result.totalBurnt, 
        duration: result.duration 
      });
      setBatchResults([...results]);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Generate heatmap
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = SIM_WIDTH;
    tempCanvas.height = SIM_HEIGHT;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(imageData, 0, 0);
      tempCtx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      tempCtx.fillRect(0, 0, SIM_WIDTH, SIM_HEIGHT);
      
      const heatData = tempCtx.getImageData(0, 0, SIM_WIDTH, SIM_HEIGHT);
      for (let i = 0; i < burnCounts.length; i++) {
        if (burnCounts[i] > 0) {
          const intensity = burnCounts[i] / numRuns;
          const idx = i * 4;
          heatData.data[idx] = 255;
          heatData.data[idx+1] = Math.floor(255 * (1 - intensity));
          heatData.data[idx+2] = 0;
          heatData.data[idx+3] = Math.floor(100 + 155 * intensity);
        }
      }
      tempCtx.putImageData(heatData, 0, 0);
      setHeatmapUrl(tempCanvas.toDataURL());
    }
    
    setIsBatchRunning(false);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!simRef.current || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    
    setIgnitionPoints(prev => [...prev, {x, y}]);
    simRef.current.ignite(x, y, 5);
    drawFrame();
  };

  const handleReset = () => {
    setIsPlaying(false);
    setShowResultsModal(false);
    setIgnitionPoints([]);
    if (simRef.current && bgCanvasRef.current) {
      const ctx = bgCanvasRef.current.getContext('2d');
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, SIM_WIDTH, SIM_HEIGHT);
        simRef.current.loadFromImageData(imageData);
        drawFrame();
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setShowResultsModal(false);
    setIsPlaying(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        if (bgCanvasRef.current && simRef.current) {
          const ctx = bgCanvasRef.current.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, SIM_WIDTH, SIM_HEIGHT);
            const imageData = ctx.getImageData(0, 0, SIM_WIDTH, SIM_HEIGHT);
            simRef.current.loadFromImageData(imageData);
            drawFrame();
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6 max-w-6xl mx-auto font-sans">
      {/* Simulation Area */}
      <div className="flex-1 flex flex-col items-center">
        <div className="relative rounded-xl overflow-hidden shadow-2xl border border-slate-200 bg-slate-100">
          {/* Background Image Canvas */}
          <canvas
            ref={bgCanvasRef}
            width={SIM_WIDTH}
            height={SIM_HEIGHT}
            className="block w-full max-w-[500px] h-auto object-contain"
          />
          {/* Fire Overlay Canvas */}
          <canvas
            ref={canvasRef}
            width={SIM_WIDTH}
            height={SIM_HEIGHT}
            onClick={handleCanvasClick}
            className="absolute top-0 left-0 w-full h-full cursor-crosshair mix-blend-normal"
          />
          
          {/* Instructions Overlay */}
          {!isPlaying && activeFires === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
              <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg text-sm font-medium text-slate-700 flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                Click anywhere to ignite
              </div>
            </div>
          )}
        </div>

        {/* Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-[500px] mt-6">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Time</span>
            <span className="text-2xl font-bold text-slate-700 font-mono">{formatTime(elapsedTime)}</span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Active Fires</span>
            <span className="text-2xl font-bold text-orange-500">{activeFires.toLocaleString()}</span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Burnt</span>
            <span className="text-2xl font-bold text-slate-700">{formatArea(totalBurnt).replace(' Acres', '')} <span className="text-xs text-slate-400">Acres</span></span>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Burn Rate</span>
            <span className="text-2xl font-bold text-red-500">{Math.round(burnRate * 0.0247105)} <span className="text-xs text-slate-400">Acres/s</span></span>
          </div>
        </div>
      </div>

      {/* Controls Sidebar */}
      <div className="w-full lg:w-80 bg-white p-6 rounded-2xl shadow-lg border border-slate-100 flex flex-col gap-8">
        <div>
          <h2 className="text-xl font-bold text-slate-800 mb-1">Simulation Controls</h2>
          <p className="text-sm text-slate-500">Adjust parameters to see how fire spreads.</p>
        </div>

        {/* Playback Controls */}
        <div className="flex gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-colors ${
              isPlaying 
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                : 'bg-emerald-500 text-white hover:bg-emerald-600'
            }`}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            {isPlaying ? 'Pause' : 'Start'}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center justify-center p-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            title="Reset Simulation"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-500" />
                Number of Simulations
              </label>
              <span className="text-xs font-mono text-slate-500">{numSimulations}</span>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={numSimulations}
              onChange={(e) => setNumSimulations(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          <button
            onClick={() => runBatch()}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors w-full"
          >
            <Activity className="w-5 h-5" />
            Run {numSimulations} Simulations
          </button>
        </div>

        <div className="h-px bg-slate-100 w-full" />

        {/* Environmental Controls */}
        <div className="flex flex-col gap-6">
          {/* Wind Direction */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Wind className="w-4 h-4 text-blue-500" />
                Wind Direction
              </label>
              <span className="text-xs font-mono text-slate-500">{windDir}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              value={windDir}
              onChange={(e) => setWindDir(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-400 font-medium px-1">
              <span>E</span>
              <span>S</span>
              <span>W</span>
              <span>N</span>
              <span>E</span>
            </div>
          </div>

          {/* Wind Speed */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Wind className="w-4 h-4 text-blue-500" />
                Wind Speed
              </label>
              <span className="text-xs font-mono text-slate-500">{windSpeed.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={windSpeed}
              onChange={(e) => setWindSpeed(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Humidity */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Droplets className="w-4 h-4 text-cyan-500" />
                Humidity
              </label>
              <span className="text-xs font-mono text-slate-500">{Math.round(humidity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.05"
              value={humidity}
              onChange={(e) => setHumidity(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>

        <div className="h-px bg-slate-100 w-full" />

        {/* Custom Map Upload */}
        <div className="space-y-3">
          <label className="text-sm font-semibold text-slate-700">Custom Terrain Map</label>
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              id="map-upload"
            />
            <div className="flex items-center justify-center gap-2 w-full py-3 px-4 border-2 border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors">
              <Upload className="w-4 h-4" />
              Upload Image
            </div>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Upload a Google Maps satellite screenshot. Green areas (trees/grass) act as fuel, while buildings, roads, and water act as barriers.
          </p>
        </div>
      </div>

      {/* Results Modal */}
      {showResultsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Simulation Complete</h2>
              <p className="text-slate-500 mb-6">The fire has completely burned out.</p>
              
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Burnt</div>
                  <div className="text-xl font-bold text-slate-800">{formatArea(totalBurnt)}</div>
                  <div className="text-xs text-slate-400 mt-1">{((totalBurnt / (SIM_WIDTH * SIM_HEIGHT)) * 100).toFixed(1)}% of area</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Simulated Time</div>
                  <div className="text-xl font-bold text-slate-800 font-mono">{formatTime(elapsedTime)}</div>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowResultsModal(false)}
                  className="flex-1 py-3 px-4 rounded-xl font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleReset}
                  className="flex-1 py-3 px-4 rounded-xl font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors"
                >
                  Reset Map
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Batch Results Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-800">Batch Simulation Results</h2>
              {!isBatchRunning && (
                <button onClick={() => setShowBatchModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-6 h-6" />
                </button>
              )}
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {isBatchRunning ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <h3 className="text-lg font-semibold text-slate-700 mb-2">Running Simulations...</h3>
                  <p className="text-slate-500 mb-4">Simulation {batchProgress.current} of {batchProgress.total}</p>
                  <div className="w-full bg-slate-100 rounded-full h-2.5">
                    <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}></div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 shrink-0">
                    {/* Left Col: Stats */}
                    <div className="space-y-4">
                      {/* Env Snapshot */}
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Wind className="w-4 h-4"/> Conditions</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-slate-500">Wind Speed:</span> <span className="font-medium text-slate-800">{batchEnv.windSpeed}x</span></div>
                          <div><span className="text-slate-500">Wind Dir:</span> <span className="font-medium text-slate-800">{batchEnv.windDir}°</span></div>
                          <div><span className="text-slate-500">Humidity:</span> <span className="font-medium text-slate-800">{Math.round(batchEnv.humidity * 100)}%</span></div>
                          <div><span className="text-slate-500">Runs:</span> <span className="font-medium text-slate-800">{batchProgress.total}</span></div>
                        </div>
                      </div>

                      {/* Extremes */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                          <div className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3"/> Worst Case</div>
                          <div className="text-xl font-bold text-slate-800">{formatArea(maxBurnt)}</div>
                          <div className="text-xs text-slate-500 mt-1">{((maxBurnt / (SIM_WIDTH*SIM_HEIGHT)) * 100).toFixed(1)}% of area</div>
                        </div>
                        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                          <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1 flex items-center gap-1"><TrendingDown className="w-3 h-3"/> Best Case</div>
                          <div className="text-xl font-bold text-slate-800">{formatArea(minBurnt)}</div>
                          <div className="text-xs text-slate-500 mt-1">{((minBurnt / (SIM_WIDTH*SIM_HEIGHT)) * 100).toFixed(1)}% of area</div>
                        </div>
                      </div>
                      
                      {/* Average */}
                      <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                        <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1 flex items-center gap-1"><Activity className="w-3 h-3"/> Average Impact</div>
                        <div className="flex items-end justify-between">
                          <div>
                            <div className="text-2xl font-bold text-slate-800">{formatArea(avgBurnt)}</div>
                            <div className="text-sm text-slate-500">{((avgBurnt / (SIM_WIDTH*SIM_HEIGHT)) * 100).toFixed(1)}% of area</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">Avg Duration</div>
                            <div className="text-lg font-bold text-slate-800 font-mono">{formatTime(Math.round(avgDuration))}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Col: Heatmap */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col">
                      <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Map className="w-4 h-4"/> Burn Probability Heatmap</h3>
                      <div className="flex-1 relative rounded-lg overflow-hidden border border-slate-200 bg-white flex items-center justify-center min-h-[200px]">
                        {heatmapUrl ? (
                          <img src={heatmapUrl} alt="Burn Probability Heatmap" className="w-full h-full object-contain" />
                        ) : (
                          <div className="text-slate-400 text-sm">Generating heatmap...</div>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-yellow-400"></div> Low Risk</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-red-600"></div> High Risk</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Individual Results Table */}
                  <h3 className="text-lg font-semibold text-slate-800 mb-4 shrink-0">Scenario Results</h3>
                  <div className="overflow-auto rounded-xl border border-slate-200 flex-1 min-h-0">
                    <table className="w-full text-left text-sm text-slate-600">
                      <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3">Scenario</th>
                          <th className="px-4 py-3">Conditions</th>
                          <th className="px-4 py-3">Total Burnt</th>
                          <th className="px-4 py-3">% of Area</th>
                          <th className="px-4 py-3">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {batchResults.map((result) => (
                          <tr key={result.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900">{result.conditionName}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-0.5 text-xs">
                                <span>Wind: {result.windSpeed.toFixed(1)}x at {result.windDir}°</span>
                                <span>Hum: {Math.round(result.humidity * 100)}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">{formatArea(result.totalBurnt)}</td>
                            <td className="px-4 py-3">{((result.totalBurnt / (SIM_WIDTH*SIM_HEIGHT)) * 100).toFixed(1)}%</td>
                            <td className="px-4 py-3 font-mono">{formatTime(result.duration)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            
            {!isBatchRunning && (
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                <button
                  onClick={() => setShowBatchModal(false)}
                  className="py-2 px-6 rounded-lg font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
