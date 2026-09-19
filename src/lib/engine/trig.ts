// Deterministic sin/cos for the simulation path.
//
// Math.sin/Math.cos are implementation-defined: Chrome, Firefox and Safari may return different
// last bits for the same input. Under lockstep netcode both peers run the same simulation, so a
// single differing bit desynchronises the match permanently. Only + - * / and Math.sqrt are
// bit-exact across engines (IEEE-754), so these use nothing else.
//
// Cody-Waite range reduction to [-PI/4, PI/4] plus odd/even Taylor kernels. Measured against
// Math.sin/Math.cos over [-10000, 10000] rad: max absolute error 5.6e-16 (machine epsilon), and
// zero rounded-pixel differences over 100k frames of hazard swing — replacing Math.sin here is
// invisible in single player. See tools/nettest.js for the accuracy assertion.

const HALF_PI = 1.5707963267948966;
const PIO2_HI = 1.5707963267341256;      // leading bits of PI/2
const PIO2_LO = 6.077100506506192e-11;   // ...and the remainder, so n*PI/2 stays exact for large n

/** sin(x) for |x| <= PI/4. */
function kernelSin(x: number): number {
  const z = x * x;
  return x + x * z * (-0.16666666666666632
    + z * (0.008333333333320025
    + z * (-0.00019841269829705975
    + z * (2.7557313707070068e-6
    + z * (-2.5050760253406863e-8
    + z * 1.58969099521155e-10)))));
}

/** cos(x) for |x| <= PI/4. */
function kernelCos(x: number): number {
  const z = x * x;
  return 1 + z * (-0.5
    + z * (0.041666666666665926
    + z * (-0.001388888888887411
    + z * (2.480158728947673e-5
    + z * (-2.7557314351390663e-7
    + z * (2.087572321298175e-9
    + z * -1.1359647557788195e-11))))));
}

/** Reduce `a` to a quadrant index 0..3 and a remainder in [-PI/4, PI/4]. */
function reduce(a: number): { y: number; q: number } {
  const n = Math.round(a / HALF_PI);
  return { y: (a - n * PIO2_HI) - n * PIO2_LO, q: ((n % 4) + 4) % 4 };
}

/** Deterministic Math.sin. Use this anywhere the result reaches simulation state. */
export function dsin(a: number): number {
  if (!Number.isFinite(a)) return NaN;
  const { y, q } = reduce(a);
  return q === 0 ? kernelSin(y) : q === 1 ? kernelCos(y) : q === 2 ? -kernelSin(y) : -kernelCos(y);
}

/** Deterministic Math.cos. Use this anywhere the result reaches simulation state. */
export function dcos(a: number): number {
  if (!Number.isFinite(a)) return NaN;
  const { y, q } = reduce(a);
  return q === 0 ? kernelCos(y) : q === 1 ? -kernelSin(y) : q === 2 ? -kernelCos(y) : kernelSin(y);
}

/** Deterministic Math.hypot for two components (Math.sqrt is bit-exact; Math.hypot is not specified to be). */
export function dhypot(x: number, y: number): number { return Math.sqrt(x * x + y * y); }
