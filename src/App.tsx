/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import FireSimulation from './components/FireSimulation';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 py-8">
      <header className="max-w-6xl mx-auto px-6 mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Wildfire Spread Simulator</h1>
        <p className="text-slate-500 mt-2">Interactive cellular automaton simulation based on image fuel density.</p>
      </header>
      <main>
        <FireSimulation />
      </main>
    </div>
  );
}
