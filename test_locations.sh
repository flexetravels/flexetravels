#!/bin/bash

# Test script for dynamic featured tours with different locations
# Usage: ./test_locations.sh

BASE_URL="http://localhost:8000/api/featured-tours"

echo "🌍 Testing Dynamic Featured Tours with Different Locations"
echo "==========================================================="
echo ""

test_locations() {
    local cities=("London" "Tokyo" "Sydney" "Dubai" "Paris" "Barcelona")
    
    for city in "${cities[@]}"; do
        echo "📍 Testing location: $city"
        echo "   URL: $BASE_URL?test_city=$city"
        
        response=$(curl -s "$BASE_URL?test_city=$city")
        
        # Extract location IATA
        location=$(echo "$response" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['location']['iata_code'])")
        
        # Extract first 2 tour destinations
        tours=$(echo "$response" | python3 -c "
import sys, json
d=json.load(sys.stdin)
for i, tour in enumerate(d['tours'][:2], 1):
    print(f\"   {i}. {tour['title']} → {tour['destination']} (\${tour['price_from']})\")"
        )
        
        echo "   ✅ IATA Code: $location"
        echo "$tours"
        echo ""
    done
}

# Run tests
test_locations

echo "✅ Test complete!"
echo ""
echo "💡 How to use in the website:"
echo "   1. The frontend will use real IP geolocation in production"
echo "   2. For testing locally, add ?test_city=CityName to the API call"
echo "   3. Or modify app.js to send test_city parameter for debugging"
