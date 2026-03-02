# Amadeus Python SDK v9 Reference

Complete reference for Amadeus Python SDK v9+ usage. Terminal commands for expert travel deal discovery.

---

## Flight Search: `amadeus.shopping.flight_offers_search.get()`

### Basic Usage
```python
response = amadeus.shopping.flight_offers_search.get(
    originLocationCode='YVR',
    destinationLocationCode='LAS',
    departureDate='2026-03-15'
)
```

### All Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `originLocationCode` | str (IATA) | Departure airport code | `YVR` (Vancouver) |
| `destinationLocationCode` | str (IATA) | Arrival airport code | `LAS` (Las Vegas) |
| `departureDate` | str (YYYY-MM-DD) | Outbound date (required) | `2026-03-15` |
| `returnDate` | str (YYYY-MM-DD) | Return date (optional, makes round-trip) | `2026-03-20` |
| `adults` | int | Number of adult passengers (default: 1) | `2` |
| `children` | int | Number of child passengers (2-11) | `1` |
| `infants` | int | Number of infant passengers (<2) | `1` |
| `travelClass` | str | ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST | `ECONOMY` |
| `nonStop` | bool | Direct flights only | `True` |
| `currencyCode` | str | ISO 4217 currency code | `USD` |
| `maxPrice` | int | Maximum total price (per person or total) | `5000` |
| `max` | int | Max number of offers (1-250, default 10) | `10` |

### Best Practice: Get Direct Flights Under Budget
```python
response = amadeus.shopping.flight_offers_search.get(
    originLocationCode='YVR',
    destinationLocationCode='LAS',
    departureDate='2026-03-15',
    returnDate='2026-03-20',
    adults=2,
    nonStop=True,
    currencyCode='USD',
    maxPrice=3000,  # Total budget for all passengers
    max=10
)
```

### Response Structure
```python
response.data[0] = {
    "type": "flight-offer",
    "id": "1",
    "source": "GDS",
    "instantTicketingRequired": False,
    "nonHomogeneous": False,
    "oneWay": False,
    "lastTicketingDate": "2026-03-15",
    "numberOfBookableSeats": 9,
    "itineraries": [
        {
            "duration": "PT15H30M",  # ISO 8601 format
            "segments": [
                {
                    "departure": {
                        "iataCode": "YVR",
                        "terminal": "2",
                        "at": "2026-03-15T08:00:00"
                    },
                    "arrival": {
                        "iataCode": "LAX",
                        "terminal": "1",
                        "at": "2026-03-15T10:30:00"
                    },
                    "operatingAirline": {"name": "Air Canada"},
                    "carrierCode": "AC",
                    "number": "109",
                    "aircraft": {"code": "73J"},
                    "operating": "AC",
                    "stops": [],
                    "class": "ECONOMY"
                },
                {
                    # Connecting flight to final destination
                    "departure": {...},
                    "arrival": {...},
                    ...
                }
            ]
        },
        {
            # Return itinerary (if returnDate provided)
            "duration": "PT14H00M",
            "segments": [...]
        }
    ],
    "price": {
        "currency": "USD",
        "total": "4200.00",      # Total for all passengers
        "base": "3800.00",
        "fee": "0.00",
        "grandTotal": "4200.00"
    },
    "pricingOptions": {
        "fareType": ["PUBLISHED"],
        "includedCheckedBagsOnly": True
    },
    "validatingAirlineCodes": ["AC", "AS"],
    "travelerPricings": [
        {
            "travelerId": "1",
            "fareOption": "PUBLISHED",
            "travelerType": "ADULT",
            "price": {
                "currency": "USD",
                "total": "2100.00",  # Per person
                "base": "1900.00"
            }
        },
        {
            "travelerId": "2",
            "fareOption": "PUBLISHED",
            "travelerType": "ADULT",
            "price": {
                "currency": "USD",
                "total": "2100.00",
                "base": "1900.00"
            }
        }
    ]
}
```

---

## Hotel Search: Two-Step Process

### Step 1: Get Hotel IDs by City
```python
response = amadeus.reference_data.locations.hotels.by_city.get(cityCode='LAS')
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `cityCode` | str (IATA) | City code (not airport) |
| `radius` | int | Search radius in km (1-500, default 42) |
| `radiusUnit` | str | KM or MILES |
| `pageLimit` | int | Results per page (1-100) |
| `page` | int | Page number for pagination |

**Response:**
```python
response.data[0] = {
    "hotelId": "MCLASXLA",
    "name": "The Venetian Resort Las Vegas",
    "type": "HOTEL",
    "geoCode": {"latitude": 36.12, "longitude": -115.17},
    "address": {"cityName": "Las Vegas", "countryCode": "US"},
    "distance": {"value": 2.5, "unit": "KM"},
    "relevance": 100.0
}
```

### Step 2: Get Pricing for Hotels
```python
response = amadeus.shopping.hotel_offers_search.get(
    hotelIds=['MCLASXLA', 'IOWPALXL'],  # Up to 250 hotel IDs
    checkInDate='2026-03-15',
    checkOutDate='2026-03-20',
    adults=2,
    roomQuantity=1,
    currency='USD',
    bestRateOnly=True  # Only best available rate per hotel
)
```

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `hotelIds` | list[str] | Hotel IDs from Step 1 | `['MCLASXLA']` |
| `checkInDate` | str (YYYY-MM-DD) | Check-in date | `2026-03-15` |
| `checkOutDate` | str (YYYY-MM-DD) | Check-out date | `2026-03-20` |
| `adults` | int | Adults per room | `2` |
| `children` | int | Children per room | `0` |
| `roomQuantity` | int | Number of rooms | `1` |
| `priceRange` | str | Min-max price per night | `"1-500"` |
| `currency` | str | ISO 4217 currency | `USD` |
| `bestRateOnly` | bool | Only best rate per hotel | `True` |
| `view` | str | FULL or LIGHT (default FULL) | `FULL` |

**Response:**
```python
response.data[0] = {
    "type": "hotel-offer",
    "hotel": {
        "type": "HOTEL",
        "hotelId": "MCLASXLA",
        "chainCode": "VE",
        "brandCode": "VENETIAN",
        "name": "The Venetian Resort Las Vegas",
        "rating": 5,
        "cityName": "Las Vegas",
        "latitude": 36.12,
        "longitude": -115.17
    },
    "available": True,
    "offers": [
        {
            "id": "1",
            "checkInDate": "2026-03-15",
            "checkOutDate": "2026-03-20",
            "rateCode": "RACK",
            "room": {
                "type": "DBL",
                "typeEstimated": {
                    "category": "SUITE",
                    "beds": 1,
                    "bedType": "KING"
                },
                "description": {
                    "text": "Suite, 1 King Bed"
                }
            },
            "guests": 2,
            "price": {
                "currency": "USD",
                "base": "3000.00",
                "total": "3450.00",  # Total for stay
                "variations": {
                    "average": {
                        "base": "600.00"  # Per night
                    },
                    "changes": [
                        {
                            "startDate": "2026-03-15",
                            "endDate": "2026-03-20",
                            "base": "600.00"
                        }
                    ]
                }
            },
            "policies": {
                "cancellation": {
                    "deadline": "2026-03-14T23:59:59",
                    "instructions": "Free cancellation"
                }
            }
        }
    ]
}
```

---

## Experiences/Activities Search: Two-Step Process

### Step 1: Get City Coordinates
```python
response = amadeus.reference_data.locations.get(
    keyword='Las Vegas',
    subType='CITY'
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `keyword` | str | City name (e.g., "Las Vegas", "Paris") |
| `subType` | str | CITY, AIRPORT, or POINT_OF_INTEREST |
| `countryCode` | str | Filter by country (ISO 3166-1) |
| `pageLimit` | int | Results per page |
| `page` | int | Page number |

**Response:**
```python
response.data[0] = {
    "id": "N01/123456",
    "self": {...},
    "type": "location",
    "subType": "CITY",
    "name": "Las Vegas",
    "detailedName": "Las Vegas, Nevada, United States",
    "timeZoneOffset": "-08:00",
    "iataCode": "LAS",
    "geoCode": {
        "latitude": 36.1699,
        "longitude": -115.1398
    },
    "address": {
        "cityName": "Las Vegas",
        "stateCode": "NV",
        "countryName": "United States",
        "countryCode": "US"
    },
    "distance": None
}
```

### Step 2: Get Activities by Coordinates
```python
response = amadeus.shopping.activities.get(
    latitude=36.1699,
    longitude=-115.1398,
    radius=20  # km
)
```

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `latitude` | float | Latitude from Step 1 | `36.1699` |
| `longitude` | float | Longitude from Step 1 | `-115.1398` |
| `radius` | int | Search radius in km (1-50, default 20) | `20` |

**Response:**
```python
response.data[0] = {
    "id": "16753",
    "self": {...},
    "type": "activity",
    "name": "Helicopter Panorama Tour of Grand Canyon",
    "shortDescription": "Experience breathtaking views",
    "duration": "PT4H",
    "minimumDuration": "PT4H",
    "bookingLink": "http://...",
    "rating": 4.5,
    "pictures": ["http://..."],
    "description": "Full description...",
    "reviews": {
        "rating": 4.5,
        "count": 233
    },
    "price": {
        "amount": "199.99",
        "currencyCode": "USD"
    },
    "startingPoint": "Downtown Las Vegas",
    "endPoint": "Downtown Las Vegas",
    "geoCode": {
        "latitude": 36.18,
        "longitude": -115.15
    },
    "contactInformation": {...},
    "cancellationPolicy": "Free cancellation up to 48 hours",
    "location": "Grand Canyon, Arizona"
}
```

---

## IATA City Codes vs Airport Codes

Not all city codes match airport codes. When using hotel search, use city codes. Examples:

| City | IATA City Code | Main Airport | Notes |
|------|---|---|---|
| Paris | PAR | CDG, ORY | Paris-Charles de Gaulle (CDG), Paris-Orly (ORY) |
| London | LON | LHR, LGW | London Heathrow (LHR), Gatwick (LGW) |
| Tokyo | TYO | NRT, HND | Narita (NRT), Haneda (HND) |
| Las Vegas | LAS | LAS | City code = airport code |
| New York | NYC | JFK, EWR, LGA | Three major airports |
| Los Angeles | LAX | LAX | City code = airport code |
| Barcelona | BCN | BCN | City code = airport code |
| Rome | ROM | FCO, CIA | Fiumicino (FCO), Ciampino (CIA) |
| Sydney | SYD | SYD | City code = airport code |
| Dubai | DXB | DXB | City code = airport code |

---

## Best Practices for Getting Best Deals

### Flights
1. **Set `nonStop=True`** if you want only direct flights (often cheaper)
2. **Use `max=10`** to limit results (faster, saves API credits)
3. **Set `maxPrice`** to filter within budget
4. **Check multiple `travelClass` options** (ECONOMY vs PREMIUM_ECONOMY can be close)
5. **Compare `currencyCode`** — USD is standard but local currencies may show better deals
6. **Look at `lastTicketingDate`** — book before this date or price changes

### Hotels
1. **Always use `bestRateOnly=True`** to get single best price per hotel
2. **Set `priceRange`** to narrow results (e.g., `"1-300"` for per-night budget)
3. **Limit requests** — start with first 20 hotel IDs from Step 1
4. **Check `cancellation` policy** — free cancellation usually indicates more competitive pricing
5. **Compare across `roomQuantity`** — sometimes 2 rooms cheaper than 1 suite

### Activities
1. **Start with `radius=20`** (20 km) for city-center experiences
2. **Filter by `price`** — look for `amount` field, ignore if empty
3. **Check `rating`** — filter for rating > 4.0 for best experiences
4. **Verify `bookingLink`** exists and is active
5. **Read `cancellationPolicy`** for flexibility

---

## Python SDK Installation & Setup

```bash
pip install amadeus>=9.0.0
```

### Initialize Client
```python
from amadeus import Client, ResponseError

amadeus = Client(
    client_id='YOUR_CLIENT_ID',
    client_secret='YOUR_CLIENT_SECRET'
)

# Test connection
try:
    response = amadeus.reference_data.locations.get(keyword='London', subType='CITY')
    print(f"Connected! Found {len(response.data)} locations")
except ResponseError as error:
    print(f"API Error: {error}")
```

### Handle Errors
```python
from amadeus import ResponseError

try:
    response = amadeus.shopping.flight_offers_search.get(...)
except ResponseError as error:
    print(f"Error: {error.response.status_code}")
    print(f"Message: {error.response.data}")
    # Log error, return fallback, etc.
except Exception as e:
    print(f"Unexpected error: {e}")
```

---

## Caching Strategy for FlexeTravels

| Resource | TTL | Reason |
|----------|-----|--------|
| **Flight offers** | 30 min | Prices change frequently |
| **Hotel IDs** | 24 hours | Hotel lists rarely change |
| **Hotel offers** | 30 min | Room availability & pricing change |
| **City coordinates** | 7 days | City locations don't change |
| **Activities** | 1 hour | Activity availability may change |

Cache key format: `prefix:json.dumps(params, sort_keys=True)`

---

## Terminal Expert Tips

### Terminal 1: Test Flight Search
```bash
python3 << 'EOF'
from amadeus import Client
amadeus = Client(client_id='...', client_secret='...')
r = amadeus.shopping.flight_offers_search.get(
    originLocationCode='YVR',
    destinationLocationCode='LAS',
    departureDate='2026-03-15',
    nonStop=True,
    maxPrice=3000
)
for offer in r.data[:3]:
    print(f"${offer['price']['total']} - {offer['itineraries'][0]['duration']}")
EOF
```

### Terminal 2: Test Hotel Search (Full Flow)
```bash
python3 << 'EOF'
from amadeus import Client
amadeus = Client(client_id='...', client_secret='...')

# Step 1: Get hotel IDs
hotels_ref = amadeus.reference_data.locations.hotels.by_city.get(cityCode='LAS')
hotel_ids = [h['hotelId'] for h in hotels_ref.data[:10]]

# Step 2: Get offers
offers = amadeus.shopping.hotel_offers_search.get(
    hotelIds=hotel_ids,
    checkInDate='2026-03-15',
    checkOutDate='2026-03-20',
    adults=2,
    bestRateOnly=True
)

for offer in offers.data[:5]:
    name = offer['hotel']['name']
    price = offer['offers'][0]['price']['total']
    print(f"{name}: ${price}")
EOF
```

### Terminal 3: Test Activities Search
```bash
python3 << 'EOF'
from amadeus import Client
amadeus = Client(client_id='...', client_secret='...')

# Step 1: Get city coordinates
city = amadeus.reference_data.locations.get(keyword='Las Vegas', subType='CITY')
geo = city.data[0]['geoCode']

# Step 2: Get activities
activities = amadeus.shopping.activities.get(
    latitude=geo['latitude'],
    longitude=geo['longitude'],
    radius=20
)

for activity in activities.data[:5]:
    name = activity.get('name', 'Unnamed')
    price = activity.get('price', {}).get('amount', 'TBD')
    rating = activity.get('rating', 'N/A')
    print(f"{name} - ${price} - ⭐{rating}")
EOF
```

---

## Common Issues & Solutions

### Issue: 400 Bad Request
- Check IATA codes (YVR not YYJ, LAS not LAX)
- Ensure dates are in YYYY-MM-DD format
- Verify `departureDate` is in future

### Issue: 401 Unauthorized
- Verify client_id and client_secret
- Check if credentials are for test sandbox (not production)
- Regenerate keys if expired

### Issue: 404 Not Found
- Hotel IDs from Step 1 may be invalid for Step 2
- Try limiting to first 10-20 hotel IDs
- Some cities may have limited hotel data

### Issue: 429 Too Many Requests
- Implement caching (don't repeat same search)
- Add 1-2 second delay between requests
- Use `max=10` for flights, not 100+

### Issue: Empty Results
- Test sandbox may have limited data
- Try major cities (NYC, LAX, PAR, LON)
- Activities especially may be empty in sandbox
- Use production keys for real data

---

## References

- [Amadeus Python SDK GitHub](https://github.com/amadeus4dev/amadeus-python)
- [Amadeus API Documentation](https://developers.amadeus.com/docs)
- [IATA Airport Codes](https://en.wikipedia.org/wiki/IATA_airport_code)
