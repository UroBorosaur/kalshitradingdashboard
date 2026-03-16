export function clipProbability(value: number, epsilon = 1e-6) {
  return Math.min(1 - epsilon, Math.max(epsilon, value));
}

export function sigmoid(x: number) {
  if (x >= 0) {
    const expNeg = Math.exp(-x);
    return 1 / (1 + expNeg);
  }
  const expPos = Math.exp(x);
  return expPos / (1 + expPos);
}

export function logit(p: number) {
  const clipped = clipProbability(p);
  return Math.log(clipped / (1 - clipped));
}

export function softmax(logits: number[], temperature = 1) {
  if (!logits.length) return [];
  const tau = Math.max(1e-6, temperature);
  const scaled = logits.map((value) => value / tau);
  const maxValue = Math.max(...scaled);
  const exps = scaled.map((value) => Math.exp(value - maxValue));
  const denom = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / Math.max(1e-12, denom));
}

export function sparsemax(logits: number[], temperature = 1) {
  if (!logits.length) return [];
  const tau = Math.max(1e-6, temperature);
  const scaled = logits.map((value) => value / tau);
  const sorted = [...scaled].sort((a, b) => b - a);
  let partial = 0;
  let k = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    partial += sorted[index];
    const threshold = (partial - 1) / (index + 1);
    if (sorted[index] > threshold) k = index + 1;
  }

  const tauStar = (sorted.slice(0, k).reduce((sum, value) => sum + value, 0) - 1) / Math.max(1, k);
  const projected = scaled.map((value) => Math.max(0, value - tauStar));
  const sum = projected.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return new Array(logits.length).fill(1 / logits.length);
  return projected.map((value) => value / sum);
}

export function entmaxBisect(logits: number[], alpha = 1.5, temperature = 1, iterations = 50) {
  if (!logits.length) return [];
  if (alpha <= 1 + 1e-6) return softmax(logits, temperature);
  if (alpha >= 2 - 1e-6) return sparsemax(logits, temperature);

  const tau = Math.max(1e-6, temperature);
  const scaled = logits.map((value) => value / tau);
  const d = alpha - 1;
  const power = 1 / d;
  let lower = Math.min(...scaled) - 1;
  let upper = Math.max(...scaled);

  const project = (threshold: number) =>
    scaled.map((value) => Math.max(d * (value - threshold), 0) ** power);

  for (let index = 0; index < iterations; index += 1) {
    const mid = (lower + upper) / 2;
    const projected = project(mid);
    const sum = projected.reduce((acc, value) => acc + value, 0);
    if (sum > 1) {
      lower = mid;
    } else {
      upper = mid;
    }
  }

  const projected = project(upper);
  const sum = projected.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return new Array(logits.length).fill(1 / logits.length);
  return projected.map((value) => value / sum);
}

export function temperatureScaleProbability(probability: number, temperature: number) {
  return sigmoid(logit(probability) / Math.max(1e-6, temperature));
}
