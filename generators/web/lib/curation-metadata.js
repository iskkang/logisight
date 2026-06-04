'use strict';

function attachSourceMetadata(curated, sourceItems) {
  const byUrl = new Map((sourceItems || []).filter((item) => item.url).map((item) => [item.url, item]));
  const copy = (item) => {
    if (!item?.url) return item;
    const source = byUrl.get(item.url);
    if (!source) return item;
    return {
      ...item,
      published_at: source.published_at || null,
      image_url: source.og_image || source.image_url || null,
      image_source: source.image_source || null,
      image_credit: source.image_credit || null,
    };
  };
  return {
    ...curated,
    main: copy(curated.main),
    links: (curated.links || []).map(copy),
  };
}

module.exports = { attachSourceMetadata };
