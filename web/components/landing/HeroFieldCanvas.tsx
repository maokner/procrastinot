'use client';

import { useEffect, useRef } from 'react';

type Strip = {
  x: number;
  width: number;
  speed: number;
  offset: number;
  lines: number[];
};

const STRIPS: Strip[] = [
  { x: 0.12, width: 0.18, speed: 0.018, offset: 0.1, lines: [0.92, 0.74, 0.88, 0.63, 0.8, 0.56] },
  { x: 0.38, width: 0.16, speed: 0.015, offset: 0.34, lines: [0.84, 0.7, 0.9, 0.76, 0.62, 0.86] },
  { x: 0.58, width: 0.2, speed: 0.02, offset: 0.58, lines: [0.9, 0.61, 0.82, 0.73, 0.89, 0.67] },
];

export function HeroFieldCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = bounds.width * dpr;
      canvas.height = bounds.height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width;
      const height = bounds.height;
      const t = time * 0.001;

      context.clearRect(0, 0, width, height);

      for (let y = 0; y < height; y += 14) {
        for (let x = width * 0.02; x < width; x += 14) {
          const wave = (Math.sin(x * 0.015 + t * 1.4) + Math.cos(y * 0.022 - t * 1.1)) * 0.5;
          const alpha = 0.05 + ((wave + 1) / 2) * 0.12;
          const radius = 0.7 + ((wave + 1) / 2) * 1.2;

          context.fillStyle = `rgba(17, 17, 17, ${alpha})`;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }

      STRIPS.forEach((strip, stripIndex) => {
        const stripX = width * strip.x;
        const stripWidth = width * strip.width;
        const paragraphHeight = 116;
        const progress = (t * strip.speed + strip.offset) % 1;
        const startY = -paragraphHeight + progress * (height + paragraphHeight * 2);

        for (let repeat = -1; repeat < 6; repeat += 1) {
          const y = startY + repeat * (paragraphHeight + 26);

          context.strokeStyle = 'rgba(17, 17, 17, 0.18)';
          context.strokeRect(stripX, y, stripWidth, paragraphHeight);

          strip.lines.forEach((ratio, lineIndex) => {
            context.fillStyle = `rgba(17, 17, 17, ${0.14 + lineIndex * 0.02})`;
            context.fillRect(
              stripX + 10,
              y + 14 + lineIndex * 14,
              (stripWidth - 20) * ratio,
              4,
            );
          });

          context.fillStyle = stripIndex === 1 ? 'rgba(204, 0, 0, 0.78)' : 'rgba(17, 17, 17, 0.78)';
          context.fillRect(stripX + 10, y + paragraphHeight - 16, stripWidth * 0.18, 6);
        }
      });

      const markX = width * 0.78;
      const markY = height * 0.28;
      const angle = t * 0.22;

      context.save();
      context.translate(markX, markY);
      context.rotate(angle);
      context.strokeStyle = 'rgba(17, 17, 17, 0.22)';
      context.lineWidth = 1;

      [56, 82, 108].forEach((radius) => {
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.stroke();
      });

      context.beginPath();
      context.moveTo(-124, 0);
      context.lineTo(124, 0);
      context.moveTo(0, -124);
      context.lineTo(0, 124);
      context.stroke();

      context.fillStyle = 'rgba(204, 0, 0, 0.9)';
      context.fillRect(-6, -6, 12, 12);
      context.fillRect(98, -2, 22, 4);
      context.fillRect(-120, -2, 18, 4);
      context.restore();

      context.fillStyle = 'rgba(17, 17, 17, 0.1)';
      context.fillRect(width * 0.02, height * 0.76, width * 0.56, 2);
      context.fillRect(width * 0.02, height * 0.82, width * 0.44, 2);

      if (!prefersReducedMotion.matches) {
        frame.current = window.requestAnimationFrame(draw);
      }
    };

    resize();
    draw(0);
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  return <canvas ref={ref} className="h-full w-full" aria-hidden="true" />;
}
