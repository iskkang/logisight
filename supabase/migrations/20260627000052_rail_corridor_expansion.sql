insert into rail_corridors (
  corridor_code,
  name,
  origin_area,
  destination_area,
  railroad,
  geometry
) values
  (
    'NYNJ_CHI_NS',
    'New York/NJ -> Chicago (NS)',
    'New York/New Jersey',
    'Chicago',
    'NS',
    '{"type":"LineString","coordinates":[[-74.01,40.71],[-76.88,40.27],[-79.99,40.44],[-81.69,41.50],[-87.65,41.85]]}'::jsonb
  ),
  (
    'SAV_CHI_CSX',
    'Savannah -> Chicago (CSX)',
    'Savannah',
    'Chicago',
    'CSX',
    '{"type":"LineString","coordinates":[[-81.09,32.08],[-84.39,33.75],[-86.78,36.16],[-86.16,39.77],[-87.65,41.85]]}'::jsonb
  ),
  (
    'LAZ_LAR_CPKC',
    'Lazaro Cardenas -> Laredo (CPKC)',
    'Lazaro Cardenas',
    'Laredo',
    'CPKC',
    '{"type":"LineString","coordinates":[[-102.20,17.96],[-101.19,19.70],[-100.98,22.15],[-100.32,25.69],[-99.51,27.50]]}'::jsonb
  ),
  (
    'LAR_CHI_CPKC',
    'Laredo -> Chicago (CPKC MMX)',
    'Laredo',
    'Chicago',
    'CPKC',
    '{"type":"LineString","coordinates":[[-99.51,27.50],[-98.49,29.42],[-96.80,32.78],[-94.58,39.10],[-87.65,41.85]]}'::jsonb
  )
on conflict (corridor_code) do update set
  name = excluded.name,
  origin_area = excluded.origin_area,
  destination_area = excluded.destination_area,
  railroad = excluded.railroad,
  geometry = excluded.geometry;
