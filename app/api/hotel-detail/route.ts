// ─── /api/hotel-detail ────────────────────────────────────────────────────────
// Returns full hotel detail from LiteAPI GET /data/hotel endpoint.
// Includes: description (HTML), all images, real facility list, check-in times,
// address, contact info.
//
// Used by the frontend to enrich hotel cards when user views details or proceeds
// to checkout — gives accurate amenities, images, check-in/out times.
//
// Results are cached in-process for 60 minutes (see liteApiGetHotelDetail).

import { NextResponse }          from 'next/server';
import { liteApiGetHotelDetail } from '@/lib/search/liteapi';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:hotel-detail:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const hotelId = searchParams.get('hotelId')?.trim();

  if (!hotelId) {
    return NextResponse.json({ error: 'hotelId query param required' }, { status: 400 });
  }

  // LiteAPI property IDs are alphanumeric (plus hyphens/underscores), 1-50 chars.
  // Reject anything else before forwarding to LiteAPI — prevents probing with
  // path-traversal sequences or oversized strings.
  const HOTEL_ID_RE = /^[a-zA-Z0-9_-]{1,50}$/;
  if (!HOTEL_ID_RE.test(hotelId)) {
    return NextResponse.json({ error: 'Invalid hotelId format' }, { status: 400 });
  }

  console.log('[hotel-detail] fetching', hotelId);

  const detail = await liteApiGetHotelDetail(hotelId);

  if (!detail) {
    return NextResponse.json(
      { error: 'Hotel detail not found or LiteAPI unavailable' },
      { status: 404 }
    );
  }

  // Return the full detail — images array sorted by order + defaultImage first
  return NextResponse.json({
    id:           detail.id,
    name:         detail.name,
    starRating:   detail.starRating,
    description:  detail.hotelDescription,   // HTML — sanitize on frontend if needed
    images:       (detail.hotelImages ?? []).map(img => ({
      url:          img.url,
      caption:      img.caption,
      isDefault:    img.defaultImage,
    })),
    amenities:    detail.hotelFacilities ?? [],   // real facility list from API
    checkinTime:  detail.checkinCheckoutTimes?.checkinStart ?? detail.checkinCheckoutTimes?.checkin,
    checkoutTime: detail.checkinCheckoutTimes?.checkout,
    address:      detail.location?.address,
    city:         detail.location?.city,
    countryCode:  detail.location?.countryCode,
    coordinates:  detail.location?.latitute != null ? {
      lat: detail.location.latitute,
      lon: detail.location.longitude,
    } : undefined,
    contact: {
      phone:   detail.contacts?.telephone,
      email:   detail.contacts?.email,
      website: detail.contacts?.website,
    },
  });
}
