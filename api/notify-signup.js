const webpush = require('web-push');

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
// index.html의 VAPID_PUBLIC_KEY 상수와 반드시 같은 값이어야 함 (공개키라 여기 하드코딩해도 안전)
const VAPID_PUBLIC_KEY = 'BAgvcxMt5U0bB7Jv96ge_LKv5tvdc3UhN_J6PH9k3fLRM-c05Anzhj3d8J4p5ToZsMykUQIKrKdqZST41nPDyrg';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:hahaa127@gmail.com',
  VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const { nickname, memberSubscription } = req.body || {};

  try {
    const ownerRows = await fetchOwnerSubscriptions();
    const ownerPayload = JSON.stringify({
      title: '새 회원 가입',
      body: (nickname || '새 회원') + '님이 가입했습니다.',
    });
    await Promise.allSettled(
      ownerRows.map((row) => webpush.sendNotification(toPushSubscription(row), ownerPayload))
    );

    if (memberSubscription) {
      const welcomePayload = JSON.stringify({
        title: '만조에 오신 것을 환영해요',
        body: '가입이 완료됐어요. 새 리포트가 올라오면 알려드릴게요.',
      });
      await webpush.sendNotification(memberSubscription, welcomePayload).catch(() => {});
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

async function fetchOwnerSubscriptions() {
  const url = SUPABASE_URL + '/rest/v1/push_subscriptions?is_owner=eq.true&select=endpoint,p256dh,auth';
  const r = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!r.ok) throw new Error('failed to load owner subscriptions: ' + r.status);
  return r.json();
}

function toPushSubscription(row) {
  return { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
}
