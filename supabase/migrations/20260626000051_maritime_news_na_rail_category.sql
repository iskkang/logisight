alter table maritime_news
  drop constraint if exists maritime_news_category_check;

alter table maritime_news
  add constraint maritime_news_category_check
  check (
    category is null
    or category in (
      '해상',
      '항공',
      '철도',
      '철도-북미',
      '물류',
      '무역',
      '기업',
      '브리핑',
      '트렌드분석'
    )
  );
