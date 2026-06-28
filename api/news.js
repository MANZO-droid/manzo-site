const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });

  try {
    const xml = await fetchUrl(decodeURIComponent(url));
    const articles = parseRSS(xml);
    res.json({ ok: true, articles });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 10000,
    }, (r) => {
      // 리다이렉트 처리
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return fetchUrl(r.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { data += c; });
      r.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function getTag(block, tag) {
  // CDATA
  var m = block.match(new RegExp('<' + tag + '[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>', 'i'));
  if (m) return m[1].trim();
  // 일반 텍스트
  m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  if (m) return m[1].trim();
  // RSS <link /> 다음 텍스트 노드 패턴
  m = block.match(new RegExp('<' + tag + '\\s*/>([^<]+)', 'i'));
  if (m) return m[1].trim();
  return '';
}

function stripHtml(html) {
  return (html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parseRSS(xml) {
  var articles = [];
  var itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  var m;
  while ((m = itemRe.exec(xml)) !== null && articles.length < 3) {
    var block = m[1];
    var title = stripHtml(getTag(block, 'title'));
    var link = getTag(block, 'link') || getTag(block, 'guid') || getTag(block, 'origLink');
    var summary = stripHtml(getTag(block, 'description') || getTag(block, 'content:encoded') || '').slice(0, 140);
    var pubDate = getTag(block, 'pubDate') || getTag(block, 'dc:date') || '';
    if (title && link) articles.push({ title, link, summary, pubDate });
  }
  return articles;
}
