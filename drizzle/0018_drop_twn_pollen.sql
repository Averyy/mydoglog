-- Remove TWN pollen rows after pollen-sparr's TWN provider sunset.
-- Aerobiology Hamilton is the only provider going forward; legacy rows are
-- no longer surfaced by any query (all filter on provider = 'aerobiology')
-- but persisting them risks them being misinterpreted if a future query
-- ever forgets the provider filter.
DELETE FROM daily_pollen WHERE provider = 'twn';
