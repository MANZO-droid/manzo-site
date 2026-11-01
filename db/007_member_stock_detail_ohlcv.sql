-- 007: My page 종목 상세에 봉차트(ohlcv)·이동평균선(ma_lines) 열 추가
-- ohlcv: [{date,open,high,low,close,volume}] 최근 60거래일 / ma_lines: {ma5,ma20,ma60,ma120} 각 ohlcv와 같은 길이(부족 구간 null)
-- 기존 closes 열은 호환을 위해 유지. RLS·권한은 변경하지 않는다.
alter table public.member_stock_detail
  add column if not exists ohlcv jsonb not null default '[]'::jsonb,
  add column if not exists ma_lines jsonb not null default '{}'::jsonb;
