"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Fragment, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polygon, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import { Focus, MED_NAMES, Snap, rsColor } from "./types";

function Controller({ focus }: { focus: Focus | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom, { duration: 1.1 });
  }, [focus, map]);
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [map]);
  return null;
}

function arc(a: [number, number], b: [number, number], n = 28): [number, number][] {
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  const c: [number, number] = [(a[0] + b[0]) / 2 - dx * 0.2, (a[1] + b[1]) / 2 + dy * 0.2];
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]);
  }
  return pts;
}

function ShipLayer({ ships }: { ships: Snap["ships"] }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!ships.length) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 33) { last = t; setPhase((t / 2400) % 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ships.length]);
  const arcs = useMemo(() => ships.map((s) => ({ s, pts: arc(s.fromLL as [number, number], s.toLL as [number, number]) })), [ships]);
  return (
    <>
      {arcs.map(({ s, pts }) => (
        <Fragment key={s.id}>
          <Polyline positions={pts} pathOptions={{ color: "#3a86c8", weight: 3, opacity: 0.75, className: "ship-line" }} />
          {[0, 0.33, 0.66].map((o) => {
            const p = pts[Math.min(pts.length - 1, Math.floor(((phase + o) % 1) * pts.length))];
            return <CircleMarker key={o} center={p} radius={5} pathOptions={{ color: "#fff", fillColor: "#3a86c8", fillOpacity: 1, weight: 2 }} interactive={false} />;
          })}
        </Fragment>
      ))}
    </>
  );
}

export default function MapView({ snap, med, focus, onPhc, height = "100%" }: {
  snap: Snap; med: number; focus: Focus | null; onPhc: (id: string) => void; height?: string;
}) {
  const bounds = useMemo(() => {
    const lats = snap.districts.flatMap((d) => d.poly.map((p) => p[0]));
    const lngs = snap.districts.flatMap((d) => d.poly.map((p) => p[1]));
    return L.latLngBounds([Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]);
  }, [snap.districts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const phcs = snap.phcs;
  return (
    <MapContainer bounds={bounds} boundsOptions={{ padding: [10, 10] }} zoomSnap={0.25} scrollWheelZoom attributionControl={false} style={{ height, width: "100%" }}>
      <Controller focus={focus} />
      {snap.districts.map((d) => {
        const rs = med < 0 ? d.worstRs : d.rs[med];
        const c = rsColor(rs);
        return (
          <Polygon key={d.id} positions={d.poly as [number, number][]} pathOptions={{ color: "#fffdf8", weight: 3, fillColor: c, fillOpacity: rs > 1 ? 0.6 : 0.42, opacity: 1 }}>
            <Tooltip permanent direction="center">
              <div className="pointer-events-none text-center leading-tight" style={{ textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 0 6px #fff" }}>
                <div className="text-[12px] font-bold">{d.name}</div>
                <div className="text-[10.5px] font-semibold" style={{ color: "#3d4a43" }}>score {rs.toFixed(2)}</div>
              </div>
            </Tooltip>
          </Polygon>
        );
      })}
      {snap.edges.map(([a, b], i) => (
        <Polyline key={i} positions={[[phcs[a].lat, phcs[a].lng], [phcs[b].lat, phcs[b].lng]]} pathOptions={{ color: "#1d2b24", weight: 1, opacity: 0.18 }} interactive={false} />
      ))}
      {snap.flows.map((f) => (
        <Polyline key={f.a + "-" + f.b} positions={[[phcs[f.a].lat, phcs[f.a].lng], [phcs[f.b].lat, phcs[f.b].lng]]} pathOptions={{ color: "#e5484d", weight: 3, opacity: 0.95, className: "flow-line" }} interactive={false} />
      ))}
      <ShipLayer ships={snap.ships} />
      {phcs.map((p) => {
        const out = med < 0 ? p.so.some(Boolean) : p.so[med];
        const dos = med < 0 ? Math.min(...p.dos) : p.dos[med];
        const health = Math.max(0, Math.min(1, dos / 14));
        const color = out ? "#e5484d" : dos < 7 ? "#f0803c" : "#0f6b4f";
        return (
          <CircleMarker key={p.id + (out ? "-out" : "")} center={[p.lat, p.lng]} radius={4.5 + health * 5} pathOptions={{ color: out ? "#e5484d" : "#fffdf8", fillColor: color, weight: 1.5, opacity: 0.4 + 0.6 * (p.obs / 100), fillOpacity: 0.3 + 0.7 * (p.obs / 100), className: out ? "pulse-node" : "" }}>
            <Popup minWidth={270}>
              <div className="space-y-2">
                <div className="font-serif text-lg font-bold leading-tight">{p.name}</div>
                <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                  <span className="chip bg-sky-soft text-[#1f5f96]">Beds full: {p.beds}%</span>
                  <span className="chip bg-lilac-soft text-[#5a3ea0]">Nurses on duty: {p.nurses}</span>
                  <span className="chip bg-sun-soft text-[#8a5f00]">How well we see it: {p.obs}/100</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead><tr className="text-left text-[10.5px] text-muted"><th>Medicine</th><th className="text-right">Days left</th><th className="text-right">Our estimate</th></tr></thead>
                  <tbody>
                    {MED_NAMES.map((n, m) => (
                      <tr key={n} className={p.so[m] ? "font-semibold text-alert" : ""}>
                        <td className="py-0.5 pr-2">{n}</td>
                        <td className="text-right font-mono">{p.so[m] ? "ran out" : `${p.dos[m].toFixed(1)}`}</td>
                        <td className="text-right font-mono text-muted">{p.ci[m].lo.toFixed(0)}–{p.ci[m].hi.toFixed(0)} d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn btn-primary btn-sm w-full" onClick={() => onPhc(p.id)}>Report stock count for this clinic →</button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
