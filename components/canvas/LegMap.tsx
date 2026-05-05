'use client';

// LegMap — Mapbox per-leg map. Renders one numbered pin per itinerary item
// that resolved to a Google Places lat/lon, plus an optional hotel pin.
// Click a pin → calls onSelectItem(idx). The parent ItineraryPanel uses that
// to scroll the matching item card into view (and vice versa: clicking a
// card flies the map to its pin).
//
// Mirrors RouteMap.tsx in style — same marker leak fix (markersRef +
// per-render replacement) and the same "load + apply" pattern so we never
// fitBounds before the style settles.

import { useEffect, useMemo, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { CanvasItinerary } from '@/lib/canvas/types';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface Props {
  itinerary:  CanvasItinerary;
  hotelLat?:  number;
  hotelLon?:  number;
  hotelName?: string;
  // Index of the currently focused item (across the flat day-major list).
  // The map highlights the matching pin when this changes.
  focusedIndex?: number | null;
  onSelectItem?: (flatIndex: number) => void;
}

interface FlatItem {
  flatIdx: number;        // index into the day-major flattened list
  dayNum:  number;
  itemIdx: number;        // index within the day
  name:    string;
  lat:     number;
  lon:     number;
}

export function LegMap({
  itinerary, hotelLat, hotelLon, hotelName,
  focusedIndex = null, onSelectItem,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const markersRef   = useRef<mapboxgl.Marker[]>([]);
  const hotelMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Flatten the day-major itinerary into a single ordered list of items
  // that have a resolved lat/lon. Any item missing coordinates is skipped —
  // it still renders in the panel, just without a pin.
  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    let flatIdx = 0;
    for (const day of itinerary.days) {
      for (let i = 0; i < day.items.length; i++) {
        const it = day.items[i];
        if (typeof it.lat === 'number' && typeof it.lon === 'number') {
          out.push({ flatIdx, dayNum: day.day, itemIdx: i, name: it.name, lat: it.lat, lon: it.lon });
        }
        flatIdx++;
      }
    }
    return out;
  }, [itinerary.days]);

  // Init map once
  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container:           containerRef.current,
      style:               'mapbox://styles/mapbox/dark-v11',
      center:              [0, 25],
      zoom:                10,
      attributionControl:  false,
      interactive:         true,
      cooperativeGestures: true,
      dragRotate:          false,
      pitchWithRotate:     false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      hotelMarkerRef.current?.remove();
      hotelMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Apply markers + bounds whenever points change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function apply() {
      if (!map) return;

      // Remove the previous set
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      hotelMarkerRef.current?.remove();
      hotelMarkerRef.current = null;

      // Add the new pin set — numbered to match the panel ordering
      const next: mapboxgl.Marker[] = [];
      flatItems.forEach((p, idx) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.setAttribute('aria-label', `${p.name} — day ${p.dayNum}`);
        const isFocused = focusedIndex === p.flatIdx;
        el.style.cssText = `
          width: 26px; height: 26px;
          border-radius: 50%;
          background: ${isFocused ? '#fbad41' : '#33c093'};
          border: 2px solid #0b0e18;
          box-shadow: 0 0 0 ${isFocused ? '4px' : '2px'} ${isFocused ? 'rgba(251, 173, 65, 0.4)' : 'rgba(51, 192, 147, 0.35)'};
          color: #0b0e18;
          font-family: ui-monospace, monospace;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          line-height: 1;
        `;
        el.textContent = String(idx + 1);
        if (onSelectItem) {
          el.addEventListener('click', (ev) => { ev.stopPropagation(); onSelectItem(p.flatIdx); });
        }
        next.push(new mapboxgl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map!));
      });
      markersRef.current = next;

      // Optional hotel pin (different colour so it's distinguishable)
      if (typeof hotelLat === 'number' && typeof hotelLon === 'number') {
        const el = document.createElement('div');
        el.title = hotelName ?? 'Hotel';
        el.style.cssText = `
          width: 14px; height: 14px;
          border-radius: 4px;
          background: #6c8cff;
          border: 2px solid #0b0e18;
          box-shadow: 0 0 0 2px rgba(108, 140, 255, 0.4);
        `;
        hotelMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([hotelLon, hotelLat]).addTo(map!);
      }

      // Fit bounds
      const all: Array<[number, number]> = flatItems.map(p => [p.lon, p.lat]);
      if (typeof hotelLat === 'number' && typeof hotelLon === 'number') all.push([hotelLon, hotelLat]);

      if (all.length >= 2) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const c of all) bounds.extend(c);
        map.fitBounds(bounds, { padding: { top: 40, bottom: 40, left: 40, right: 40 }, duration: 700, maxZoom: 14 });
      } else if (all.length === 1) {
        map.flyTo({ center: all[0], zoom: 13, duration: 700 });
      }
    }

    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once('load', apply);
    return () => { map.off('load', apply); };
  }, [flatItems, focusedIndex, hotelLat, hotelLon, hotelName, onSelectItem]);

  // When focusedIndex changes, fly to the matching pin without resetting bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusedIndex == null) return;
    const target = flatItems.find(p => p.flatIdx === focusedIndex);
    if (!target) return;
    map.flyTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }, [focusedIndex, flatItems]);

  if (!TOKEN) {
    // Mapbox not configured — render nothing rather than a noisy fallback.
    // The panel still shows the day-by-day cards.
    return null;
  }

  if (flatItems.length === 0) {
    // No item resolved to coordinates (Google Places disabled or all queries
    // failed) — skip the map silently.
    return null;
  }

  return (
    <div className="rounded-xl overflow-hidden hairline relative" style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.3)' }}>
      <div ref={containerRef} className="w-full h-44 md:h-52 bg-navy-900/40" aria-label="Itinerary map" />
    </div>
  );
}
