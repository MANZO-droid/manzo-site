const https = require('https');
const http = require('http');
const zlib = require('zlib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const rawUrl = (req.query && req.query.url) || '';
  if (!rawUrl) return res.status(400).json({ ok: false, error: 'url required' });

  const rssUrl = decodeURIComponent(rawUrl);

  try {
    const xml = await fetchWithRedirect(rssUrl, 3);
    const articles = parseRSS(xml);
    res.json({ ok: true, articles });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

function fetchWithRedirect(url, maxRedirects) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('too many redirects'));

    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(new Error('invalid url: ' + url)); }

    const client = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      timeout: 9000,
    };

    const req = client.request(options, (r) => {
      // 리다이렉트 처리 (절대/상대 URL 모두 지원)
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        let loc = r.headers.location;
        if (!loc.startsWith('http')) {
          loc = parsed.protocol + '//' + parsed.hostname + (loc.startsWith('/') ? '' : '/') + loc;
        }
        r.resume();
        return fetchWithRedirect(loc, maxRedirects - 1).then(resolve).catch(reject);
      }

      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = r.headers['content-encoding'] || '';

        const decode = (b) => {
          // EUC-KR 감지 후 디코딩
          const str = b.toString('utf8');
          if (str.includes('euc-kr') || str.includes('EUC-KR')) {
            try {
              const td = new TextDecoder('euc-kr');
              return td.decode(b);
            } catch (e) { return str; }
          }
          return str;
        };

        if (enc === 'gzip') {
          zlib.gunzip(buf, (err, result) => {
            resolve(decode(err ? buf : result));
          });
        } else if (enc === 'deflate') {
          zlib.inflate(buf, (err, result) => {
            resolve(decode(err ? buf : result));
          });
        } else {
          resolve(decode(buf));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function getTag(block, tag) {
  // CDATA 처리
  var re1 = new RegExp('<' + tag + '[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>', 'i');
  var m = block.match(re1);
  if (m) return m[1].trim();
  // 일반 텍스트
  var re2 = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  m = block.match(re2);
  if (m) return m[1].trim();
  // self-closing 뒤 텍스트 (일부 RSS 링크 형식)
  var re3 = new RegExp('<' + tag + '\\s*/?>\\s*([^<\\s][^<]*)', 'i');
  m = block.match(re3);
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
  const articles = [];
  // RSS <item> 또는 Atom <entry> 지원
  const itemRe = /<(?:item|entry)[>\s]([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && articles.length < 3) {
    const block = m[1];
    // 출처명 추출 (Google News RSS의 <source> 태그)
    const source = getTag(block, 'source');
    // 제목 끝 " - 출처명" 제거
    let title = stripHtml(getTag(block, 'title'));
    if (source) title = title.replace(new RegExp('\\s*-\\s*' + source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '').trim();
    const link =
      getTag(block, 'link') ||
      (block.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1] ||
      getTag(block, 'guid') ||
      '';
    // Google News description은 제목 반복 HTML이므로 실제 요약이 없으면 빈 문자열 처리
    const rawSummary = stripHtml(
      getTag(block, 'description') ||
      getTag(block, 'content') ||
      getTag(block, 'summary') || ''
    );
    const titleStart = title.replace(/\.\.\.$/,'').slice(0, 15);
    const summary = (!rawSummary || rawSummary.startsWith(titleStart)) ? '' : rawSummary.slice(0, 140);
    const pubDate =
      getTag(block, 'pubDate') ||
      getTag(block, 'published') ||
      getTag(block, 'dc:date') || '';

    if (title && link) articles.push({ title, link, summary, pubDate });
  }
  return articles;
}
