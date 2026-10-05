import { useCallback, useEffect, useRef, type PointerEvent } from 'react';

function cssSize(canvas: HTMLCanvasElement) {
  return {
    width: Math.max(1, Math.round(canvas.clientWidth)),
    height: Math.max(1, Math.round(canvas.clientHeight)),
  };
}

function prepare(ctx: CanvasRenderingContext2D, width: number, height: number, ratio: number) {
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
}

function paintImage(ctx: CanvasRenderingContext2D, value: string, width: number, height: number) {
  if (!value) return;
  const image = new Image();
  image.onload = () => ctx.drawImage(image, 0, 0, width, height);
  image.src = value;
}

export function SignaturePad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastEmitted = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  const fit = useCallback((restore: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = cssSize(canvas);
    const nextW = Math.round(width * ratio);
    const nextH = Math.round(height * ratio);
    const sizeChanged = canvas.width !== nextW || canvas.height !== nextH;
    if (!sizeChanged) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
      return;
    }
    const snapshot = restore || (canvas.width > 1 && canvas.height > 1 ? canvas.toDataURL('image/png') : '');
    canvas.width = nextW;
    canvas.height = nextH;
    prepare(ctx, width, height, ratio);
    paintImage(ctx, snapshot, width, height);
  }, []);

  useEffect(() => {
    lastEmitted.current = valueRef.current;
    fit(valueRef.current);
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit(lastEmitted.current || valueRef.current));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = cssSize(canvas);
    prepare(ctx, width, height, ratio);
    paintImage(ctx, value, width, height);
  }, [value]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    event.preventDefault();
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    try {
      canvas?.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (!canvas || disabled) return;
    const dataUrl = canvas.toDataURL('image/png');
    lastEmitted.current = dataUrl;
    onChange(dataUrl);
  };

  const clear = () => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = cssSize(canvas);
    prepare(ctx, width, height, ratio);
    lastEmitted.current = '';
    onChange('');
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        aria-label="Signature"
        className={`w-full h-40 border border-slate-800 bg-white touch-none ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-crosshair'}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button type="button" disabled={disabled} onClick={clear} className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50">
        Clear and redraw
      </button>
    </div>
  );
}
