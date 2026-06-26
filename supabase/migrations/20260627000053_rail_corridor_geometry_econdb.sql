update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-118.267,33.7199],[-117.55,34.0494],[-117.313,34.1049],[-117.058,34.8967],[-114.602,34.8395],[-110.713,35.0281],[-106.769,34.6472],[-103.209,34.3973],[-101.674,35.2444],[-98.7917,36.6995],[-97.363,37.6649],[-94.9594,38.7902],[-94.4307,39.1815],[-91.3483,40.6205],[-88.0817,41.525],[-87.6616,41.5728]]}'::jsonb
where corridor_code = 'LALB_CHI_BNSF';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-118.267,33.7199],[-117.058,34.8967],[-111.991,40.7801],[-104.808,41.1309],[-95.9345,41.2565],[-87.6616,41.5728]]}'::jsonb
where corridor_code = 'LALB_CHI_UP';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-118.215,33.7514],[-114.615,32.7115],[-110.967,32.223],[-108.704,32.3494],[-106.748,31.906],[-106.749,31.9054],[-100.408,32.4688],[-97.3497,32.9901],[-96.806,32.783]]}'::jsonb
where corridor_code = 'LALB_DAL_UP';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-123.117,49.2833],[-120.325,50.6776],[-113.943,50.9572],[-105.558,50.3864],[-104.644,50.4705],[-97.1385,49.8954],[-89.2471,48.3775],[-83.4002,47.8383],[-79.3833,43.6167]]}'::jsonb
where corridor_code = 'VAN_TOR_CN';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-130.333,54.3167],[-122.693,53.9174],[-113.481,53.534],[-106.67,52.1579],[-97.1385,49.8954],[-93.4051,48.6139],[-93.248,45.0186],[-93.1907,44.9724],[-87.6616,41.5728]]}'::jsonb
where corridor_code = 'PRR_CHI_CN';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-102.167,17.9333],[-101.22,19.6964],[-100.196,20.5825],[-100.985,22.1714],[-100.316,25.6866],[-99.5167,27.5055]]}'::jsonb
where corridor_code = 'LAZ_LAR_CPKC';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-99.5167,27.5055],[-98.4325,29.4368],[-97.3497,32.9901],[-94.4307,39.1815],[-87.6616,41.5728]]}'::jsonb
where corridor_code = 'LAR_CHI_CPKC';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-74.0167,40.7],[-75.1333,39.95],[-76.5833,39.2667],[-78.7464,39.6283],[-82.7449,41.0642],[-83.6783,41.1828],[-86.7224,41.6138],[-87.6616,41.5728]]}'::jsonb
where corridor_code = 'NYNJ_CHI_NS';

update rail_corridors
set geometry = '{"type":"LineString","coordinates":[[-81.0833,32.0833],[-84.388,33.749],[-85.3376,35.0763],[-86.7554,36.0906],[-85.734,38.1176],[-86.1581,39.7684],[-87.6616,41.5728]]}'::jsonb
where corridor_code = 'SAV_CHI_CSX';
