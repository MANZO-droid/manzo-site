const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const query = (req.query && req.query.query) || '';
  if (!query) return res.status(400).json({ ok: false, error: 'query required' });

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ ok: false, error: 'API key not configured' });
  }

  try {
    const articles = await fetchNaverNews(query, clientId, clientSecret);
    res.json({ ok: true, articles });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

function fetchNaverNews(query, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const path = '/v1/search/news.json?query=' + encodeURIComponent(query) + '&display=3&sort=date';
    const req = https.request({
      hostname: 'openapi.naver.com',
      path,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 8000,
    }, (r) => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!data.items) return resolve([]);
          const articles = data.items.map(item => ({
            title: stripHtml(item.title),
            link: item.originallink || item.link,
            summary: stripHtml(item.description).slice(0, 140),
            pubDate: item.pubDate,
          }));
          resolve(articles);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
