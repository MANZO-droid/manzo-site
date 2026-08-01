// .env.local 파일을 읽어 process.env 에 넣어주는 작은 도우미 (외부 라이브러리 없음)
const fs = require('fs');
const path = require('path');

module.exports = function loadEnvLocal() {
  // scripts/ 에서 한 단계 위가 저장소 루트다(.env.local이 여기 있다).
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
};
