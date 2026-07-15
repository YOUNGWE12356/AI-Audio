/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Polyfill for lamejs which assigns variables to the global scope without declaring them,
// causing ReferenceErrors in strict mode environments (like Vite).
const globals = [
  'Lame',
  'Presets',
  'GainAnalysis',
  'QuantizePVT',
  'Quantize',
  'Takehiro',
  'Reservoir',
  'MPEGMode',
  'BitStream'
];

globals.forEach(g => {
  if (typeof window !== 'undefined' && !(g in window)) {
    (window as any)[g] = undefined;
  }
  if (typeof globalThis !== 'undefined' && !(g in globalThis)) {
    (globalThis as any)[g] = undefined;
  }
});
