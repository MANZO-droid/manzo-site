// [트리거 전용] GitHub Actions의 gainers-daily.yml(당일 상승률 Top10·거래대금 Top10 수집)을
// workflow_dispatch로 깨운다. 실제 수집·분석 로직은 그대로 GitHub Actions(collect_gainers.py)에서
// 돈다 - 이 함수는 "예약 실행 트리거"만 이원화한다.
//
// 2026-09-29 추가: GitHub Actions 자체 스케줄러(cron)가 이 세션에서만 여러 번(9/16, 9/28 등)
// 예정 시각을 지나도록 발동을 안 한 적이 있어(회장님 지적, GitHub 쪽 플랫폼 한계로 확인),
// 서로 다른 스케줄러(Vercel Cron)에서 5분 뒤 대신 깨우도록 이중화한다. 같은 날 GitHub 자체
// 스케줄도 정상 발동했다면 collect_gainers.py의 already_collected() 가드가 중복 실행을 막는다.
//
// Vercel Cron이 호출할 때 Authorization: Bearer <CRON_SECRET> 헤더를 자동으로 붙이므로
// (vercel.json에 등록된 cron만 이 값을 안다), 그 값으로 임의 호출을 막는다.
module.exports = async (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!process.env.GH_DISPATCH_TOKEN) {
    res.status(500).json({ error: 'GH_DISPATCH_TOKEN 환경변수가 없습니다' });
    return;
  }

  try {
    const r = await fetch(
      'https://api.github.com/repos/MANZO-droid/manzo-research-automation/actions/workflows/gainers-daily.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    if (r.status !== 204) {
      const text = await r.text();
      res.status(502).json({ error: `GitHub dispatch 실패 ${r.status}: ${text}` });
      return;
    }
    res.status(200).json({ ok: true, triggeredAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
