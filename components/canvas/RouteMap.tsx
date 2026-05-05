'use client';

// RouteMap — Mapbox-rendered trip route. Sits at the top of the canvas above
// the day-leg blocks. Shows the origin → all destinations as connected points
// on a dark Mapbox style. Auto-fits bounds when the trip changes.
//
// Requires NEXT_PUBLIC_MAPBOX_TOKEN. Falls back to a stylized SVG line when
// the token is missing or any leg can't be resolved to a coordinate.

import { useEffect, useMemo, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { resolveCoords } from '@/lib/canvas/airport-coords';
import { type CanvasState } from '@/lib/canvas/types';

interface Props {
  state: CanvasState;
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export function RouteMap({ state }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  // Track active markers across renders so we can remove them on the next
  // points-change effect. Without this, each render added new markers and
  // left the old ones orphaned on the map (visible as "stale pins after
  // reorder/remove").
  const markersRef   = useRef<mapboxgl.Marker[]>([]);

  // Build the ordered list of points. For every leg we use its destination,
  // and we prepend homeOrigin as the first point if known.
  const points = useMemo(() => {
    const out: Array<{ label: string; coord: [number, number]; kind: 'home' | 'dest' }> = [];

    if (state.homeOrigin) {
      const c = resolveCoords(state.homeOrigin);
      if (c) out.push({ label: state.homeOrigin, coord: c, kind: 'home' });
    }

    for (const leg of state.legs) {
      const c = resolveCoords(leg.iata || leg.city);
      if (c) out.push({ label: leg.iata || leg.city, coord: c, kind: 'dest' });
    }

    return out;
  }, [state.homeOrigin, state.legs]);

  // Init map once
  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container:   containerRef.current,
      style:       'mapbox://styles/mapbox/dark-v11',
      center:      [0, 25],
      zoom:        1.4,
      attributionControl: false,
      interactive: true,           // allow zoom + pan
      // cooperativeGestures keeps page-scroll working — Cmd/Ctrl+wheel zooms,
      // two-finger drag pans on touchpads. Avoids hijacking page scroll on mobile.
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // Source for the route line
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      });
      map.addLayer({
        id:    'route-line',
        type:  'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#33c093',
          'line-width': 2.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.9,
        },
      });
      // Glow under the line
      map.addLayer({
        id:    'route-glow',
        type:  'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#0fa876',
          'line-width': 8,
          'line-opacity': 0.18,
          'line-blur': 2,
        },
      }, 'route-line');
    });

    mapRef.current = map;

    return () => {
      // Remove markers first so their DOM nodes don't leak after the map
      // itself is destroyed
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers + route + bounds whenever points change.
  // Marker tracking lives in markersRef so we can REPLACE the previous set
  // every time the points list changes (reorder, remove, AI-driven swap…).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function apply() {
      if (!map) return;

      // Remove the previous marker set
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      // Add the new marker set
      const next: mapboxgl.Marker[] = [];
      for (const p of points) {
        const el = document.createElement('div');
        el.style.cssText = `
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: ${p.kind === 'home' ? '#fbad41' : '#33c093'};
          border: 2px solid #0b0e18;
          box-shadow: 0 0 0 2px ${p.kind === 'home' ? 'rgba(251, 173, 65, 0.35)' : 'rgba(51, 192, 147, 0.35)'};
        `;

        const label = document.createElement('div');
        label.textContent = p.label;
        label.style.cssText = `
          position: absolute;
          top: 18px;
          left: 50%;
          transform: translateX(-50%);
          font-family: ui-monospace, monospace;
          font-size: 10px;
          color: #c7d3e8;
          background: rgba(11, 14, 24, 0.85);
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
          letter-spacing: 0.05em;
          pointer-events: none;
        `;
        el.appendChild(label);

        next.push(new mapboxgl.Marker({ element: el }).setLngLat(p.coord).addTo(map!));
      }
      markersRef.current = next;

      // Update route line — empty geometry when no points so nothing lingers
      const src = map.getSource('route') as mapboxgl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: points.map(p => p.coord),
          },
        });
      }

      // Fit bounds (with padding) — only when there's something to fit
      if (points.length >= 2) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const p of points) bounds.extend(p.coord);
        map.fitBounds(bounds, {
          padding: { top: 50, bottom: 70, left: 60, right: 60 },
          duration: 800,
          maxZoom: 6,
        });
      } else if (points.length === 1) {
        map.flyTo({ center: points[0].coord, zoom: 5, duration: 800 });
      }
    }

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    // Style isn't loaded yet — defer apply, but make sure to clean up the
    // listener if this effect re-fires before load finishes (otherwise we'd
    // get N pending applies for N renders before the style settles).
    map.once('load', apply);
    return () => { map.off('load', apply); };
  }, [points]);

  // Empty state — no points, no token, or just placeholder
  if (!TOKEN) {
    return (
      <div className="rounded-xl bg-navy-900/40 p-5 relative overflow-hidden hairline">
        <p className="text-center text-xs uppercase tracking-[0.18em] text-navy-400 font-mono">
          Mapbox token not set — add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden hairline relative" style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.3)' }}>
      <div ref={containerRef} className="w-full h-48 md:h-56 bg-navy-900/40" aria-label="Trip route map" />
      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs uppercase tracking-[0.18em] text-navy-400 font-mono bg-navy-950/70 px-3 py-1.5 rounded">
            Add a stop to see the route
          </p>
        </div>
      )}
    </div>
  );
}
