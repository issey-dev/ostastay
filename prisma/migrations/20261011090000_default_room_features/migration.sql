-- Default room features (owner-approved list, 2026-10-11): give every EXISTING property the
-- starter bed types, room views and amenities that new properties now get at creation
-- (src/lib/properties/default-room-features.ts — keep the two lists in step).
--
-- Additive only: a (property, category, code) the property already has — renamed, deactivated
-- or not — is left untouched, and new rows sort after whatever the property already has in
-- that category. Safe to re-run.
INSERT INTO "SystemCode" ("id", "enterpriseId", "propertyId", "category", "code", "value", "sortOrder", "isActive")
SELECT
  gen_random_uuid()::text,
  p."enterpriseId",
  p."id",
  d."category",
  d."code",
  d."value",
  COALESCE((SELECT MAX(s."sortOrder") + 1 FROM "SystemCode" s WHERE s."propertyId" = p."id" AND s."category" = d."category"), 0) + d."ord",
  true
FROM "Property" p
CROSS JOIN (VALUES
    ('BED_TYPE', 'SINGLE', 'Single bed', 0),
    ('BED_TYPE', 'TWIN', 'Twin beds', 1),
    ('BED_TYPE', 'DOUBLE', 'Double bed', 2),
    ('BED_TYPE', 'QUEEN', 'Queen bed', 3),
    ('BED_TYPE', 'KING', 'King bed', 4),
    ('BED_TYPE', 'SOFA_BED', 'Sofa bed', 5),
    ('BED_TYPE', 'BUNK', 'Bunk beds', 6),
    ('ROOM_VIEW', 'OCEAN', 'Ocean view', 0),
    ('ROOM_VIEW', 'BEACH', 'Beach view', 1),
    ('ROOM_VIEW', 'LAGOON', 'Lagoon view', 2),
    ('ROOM_VIEW', 'GARDEN', 'Garden view', 3),
    ('ROOM_VIEW', 'POOL', 'Pool view', 4),
    ('ROOM_VIEW', 'CITY', 'City view', 5),
    ('ROOM_VIEW', 'MOUNTAIN', 'Mountain view', 6),
    ('ROOM_VIEW', 'NO_VIEW', 'Standard / no view', 7),
    ('ROOM_AMENITY', 'AC', 'Air conditioning', 0),
    ('ROOM_AMENITY', 'FAN', 'Ceiling fan', 1),
    ('ROOM_AMENITY', 'HEATING', 'Heating', 2),
    ('ROOM_AMENITY', 'WIFI', 'Wi-Fi', 3),
    ('ROOM_AMENITY', 'TV', 'Flat-screen TV', 4),
    ('ROOM_AMENITY', 'SMART_TV', 'Smart TV', 5),
    ('ROOM_AMENITY', 'PHONE', 'Telephone', 6),
    ('ROOM_AMENITY', 'USB_PORTS', 'USB charging ports', 7),
    ('ROOM_AMENITY', 'SAFE', 'In-room safe', 8),
    ('ROOM_AMENITY', 'MINIBAR', 'Minibar', 9),
    ('ROOM_AMENITY', 'FRIDGE', 'Refrigerator', 10),
    ('ROOM_AMENITY', 'KETTLE', 'Tea / coffee maker', 11),
    ('ROOM_AMENITY', 'COFFEE_MACHINE', 'Coffee machine', 12),
    ('ROOM_AMENITY', 'KITCHENETTE', 'Kitchenette', 13),
    ('ROOM_AMENITY', 'SHOWER', 'Shower', 14),
    ('ROOM_AMENITY', 'BATHTUB', 'Bathtub', 15),
    ('ROOM_AMENITY', 'RAIN_SHOWER', 'Rain shower', 16),
    ('ROOM_AMENITY', 'HAIRDRYER', 'Hairdryer', 17),
    ('ROOM_AMENITY', 'TOILETRIES', 'Toiletries', 18),
    ('ROOM_AMENITY', 'BATHROBE', 'Bathrobe and slippers', 19),
    ('ROOM_AMENITY', 'BALCONY', 'Balcony', 20),
    ('ROOM_AMENITY', 'TERRACE', 'Private terrace', 21),
    ('ROOM_AMENITY', 'PRIVATE_POOL', 'Private pool', 22),
    ('ROOM_AMENITY', 'PLUNGE_POOL', 'Plunge pool', 23),
    ('ROOM_AMENITY', 'SEATING', 'Seating area', 24),
    ('ROOM_AMENITY', 'DESK', 'Work desk', 25),
    ('ROOM_AMENITY', 'IRON', 'Iron and board', 26),
    ('ROOM_AMENITY', 'WARDROBE', 'Wardrobe', 27),
    ('ROOM_AMENITY', 'BLACKOUT', 'Blackout curtains', 28),
    ('ROOM_AMENITY', 'SOUNDPROOF', 'Soundproofing', 29),
    ('ROOM_AMENITY', 'ACCESSIBLE', 'Accessible room', 30),
    ('ROOM_AMENITY', 'CONNECTING', 'Connecting room', 31),
    ('ROOM_AMENITY', 'NON_SMOKING', 'Non-smoking', 32)
) AS d("category", "code", "value", "ord")
WHERE NOT EXISTS (
  SELECT 1 FROM "SystemCode" e
  WHERE e."propertyId" = p."id" AND e."category" = d."category" AND e."code" = d."code"
);
