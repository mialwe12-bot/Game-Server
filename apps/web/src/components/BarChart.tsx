import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface BarDatum {
  key: string;
  /** Achsenbeschriftung (kurz) */
  label: string;
  value: number;
  /** Zusätzlicher Inhalt für den Tooltip (z. B. Aufschlüsselung) */
  detail?: ReactNode;
}

/** Saubere Achsenschritte (1, 2, 5 × 10^n) */
function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Einreihiges Säulendiagramm (eine Farbe → keine Legende; der Titel benennt die Reihe).
 * Säulen max. 24 px, 4 px gerundetes Datenende, gerade an der Grundlinie; Haarlinien-Raster;
 * Tooltip pro Säule (ganze Spalte als Trefferfläche); Wert nur an der höchsten Säule; Tabellenansicht.
 */
export function BarChart({
  data,
  format,
  axisFormat = format,
  height = 220,
  minTop = 0,
  title,
}: {
  data: BarDatum[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  height?: number;
  /** Mindestwert für das obere Achsenende (verhindert winzige Skalen bei sehr kleinen Werten) */
  minTop?: number;
  title: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const max = Math.max(...data.map((d) => d.value), 0);
  const step = niceStep(Math.max(max, minTop) || 1, 4);
  const top = Math.max(step, Math.ceil(Math.max(max, minTop) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const pad = { l: 44, r: 8, t: 18, b: 24 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(4, band - 2));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const maxIdx = data.findIndex((d) => d.value === max && max > 0);
  // Beschriftungen der X-Achse ausdünnen, damit sie sich nicht überlappen
  const labelEvery = Math.max(1, Math.ceil(40 / band));

  /** Säule mit gerundetem Kopf (4 px) und gerader Basis */
  const barPath = (x: number, v: number) => {
    const h = Math.max(0, plotH - (y(v) - pad.t));
    if (h <= 0) return '';
    const r = Math.min(4, h, barW / 2);
    const x0 = x - barW / 2;
    const yb = pad.t + plotH;
    const yt = yb - h;
    return `M${x0},${yb} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x0 + barW - r} Q${x0 + barW},${yt} ${x0 + barW},${yt + r} V${yb} Z`;
  };

  const hovered = hover !== null ? data[hover] : null;

  return (
    <figure className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setTable((v) => !v)}>
          {table ? t('stats.showChart') : t('stats.showTable')}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {data.map((d) => (
              <tr key={d.key}>
                <td className="py-1 text-muted">{d.label}</td>
                <td className="py-1 text-right font-medium tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
          <svg width={width} height={height} role="img" aria-label={title} className="block">
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                  {axisFormat(v)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.l + band * i + band / 2;
              return (
                <g key={d.key}>
                  <path d={barPath(cx, d.value)} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.55} />
                  {i % labelEvery === 0 && (
                    <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
                      {d.label}
                    </text>
                  )}
                  {i === maxIdx && (
                    <text x={cx} y={y(d.value) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--fg)">
                      {format(d.value)}
                    </text>
                  )}
                  {/* Trefferfläche: die ganze Spalte */}
                  <rect x={pad.l + band * i} y={pad.t} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`} />
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg"
              style={{ left: Math.min(width - 160, Math.max(0, pad.l + band * hover + band / 2 - 72)), top: 0 }}
            >
              <p className="text-muted">{hovered.label}</p>
              <p className="flex items-center gap-1.5 font-semibold">
                <span className="inline-block size-2 rounded-sm" style={{ background: 'var(--chart-1)' }} />
                {format(hovered.value)}
              </p>
              {hovered.detail}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
