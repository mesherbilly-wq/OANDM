import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface CameraSymbolCount {
  internalDome: number;
  externalDome: number;
  externalBullet: number;
  legendExcluded: number;
  countedTotal: number;
}

interface OperatorPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  getOperatorList: () => Promise<{ fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }>;
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const RED = '#c8102e';
const BLUE = '#0000ff';

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof value !== 'object') return null;
  const list = Array.from(value as ArrayLike<number>).slice(0, 6).map(Number);
  if (list.length < 6 || list.some(item => !Number.isFinite(item))) return null;
  return list as Matrix;
}

function asColor(value: unknown): string | null {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].toLowerCase();
  return null;
}

interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  color: 'red' | 'blue';
  n: number;
}

function cluster(marks: Mark[], distance: number): Mark[] {
  const groups: Mark[] = [];
  for (const mark of marks) {
    const hit = groups.find(group => group.color === mark.color && Math.hypot(group.x - mark.x, group.y - mark.y) < distance);
    if (!hit) {
      groups.push({ ...mark, n: 1 });
      continue;
    }
    hit.n += 1;
    hit.w = Math.max(hit.w, mark.w);
    hit.h = Math.max(hit.h, mark.h);
  }
  return groups;
}

function symbolKind(mark: Mark): 'internalDome' | 'externalDome' | 'externalBullet' | null {
  const shortSide = Math.max(1, Math.min(mark.w, mark.h));
  const aspect = Math.max(mark.w, mark.h) / shortSide;
  if (mark.w < 8 || mark.h < 4) return null;
  if (mark.color === 'red') return aspect < 2 ? 'internalDome' : null;
  if (aspect >= 1.35) return 'externalBullet';
  return 'externalDome';
}

/** Count camera symbols from vector paths. Legend symbols on the right-hand panel are excluded. */
export async function countCameraSymbols(page: OperatorPage): Promise<CameraSymbolCount> {
  const empty = { internalDome: 0, externalDome: 0, externalBullet: 0, legendExcluded: 0, countedTotal: 0 };
  let list: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> };
  try {
    list = await page.getOperatorList();
  } catch {
    return empty;
  }
  const view = page.getViewport({ scale: 1 });
  let current = IDENTITY;
  const saves: Matrix[] = [];
  const annotations: { current: Matrix; depth: number }[] = [];
  let stroke: string | null = null;
  let fill: string | null = null;
  const marks: Mark[] = [];

  for (let index = 0; index < list.fnArray.length; index += 1) {
    const fn = list.fnArray[index];
    const args = list.argsArray[index] as unknown[] | undefined;
    if (fn === OPS.save) {
      saves.push(current);
    } else if (fn === OPS.restore) {
      current = saves.pop() ?? current;
    } else if (fn === OPS.transform) {
      const matrix = asMatrix(args);
      if (matrix) current = multiply(current, matrix);
    } else if (fn === OPS.beginAnnotation) {
      annotations.push({ current, depth: saves.length });
      const matrix = asMatrix(args?.[2]);
      if (matrix) current = multiply(current, matrix);
    } else if (fn === OPS.endAnnotation) {
      const saved = annotations.pop();
      if (saved) {
        saves.length = saved.depth;
        current = saved.current;
      }
    } else if (fn === OPS.setStrokeRGBColor) {
      stroke = asColor(args);
    } else if (fn === OPS.setFillRGBColor) {
      fill = asColor(args);
    } else if (fn === OPS.constructPath) {
      const color = stroke === RED || fill === RED ? 'red' : stroke === BLUE || fill === BLUE ? 'blue' : null;
      const bounds = args?.[2] as ArrayLike<number> | null | undefined;
      if (!color || !bounds || bounds.length < 4) continue;
      const first = apply(current, Number(bounds[0]), Number(bounds[1]));
      const second = apply(current, Number(bounds[2]), Number(bounds[3]));
      const x0 = Math.min(first[0], second[0]);
      const x1 = Math.max(first[0], second[0]);
      const y0 = Math.min(first[1], second[1]);
      const y1 = Math.max(first[1], second[1]);
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 4 || h < 4 || w > 50 || h > 50) continue;
      if (x1 < 0 || y1 < 0 || x0 > view.width || y0 > view.height) continue;
      marks.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w, h, color, n: 1 });
    }
  }

  const groups = cluster(marks, 18);
  const planTop = view.height * 0.92;
  const planBottom = view.height * 0.18;
  const legendX = view.width * 0.78;
  const result = { ...empty };
  for (const group of groups) {
    const kind = symbolKind(group);
    if (!kind) continue;
    const onPlan = group.x < legendX && group.y > planBottom && group.y < planTop;
    if (!onPlan) {
      result.legendExcluded += 1;
      continue;
    }
    result[kind] += 1;
  }
  result.countedTotal = result.internalDome + result.externalDome + result.externalBullet;
  return result;
}
