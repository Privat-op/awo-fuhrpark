import http from 'k6/http';
import { check } from 'k6';

const target = __ENV.TARGET_URL || '';
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(target)) {
  throw new Error('TARGET_URL muss auf localhost/127.0.0.1/::1 zeigen. Nicht gegen Produktion ausführen.');
}

export const options = {
  vus: Math.max(1, Number(__ENV.VUS || 10)),
  duration: __ENV.DURATION || '30s'
};

export default function () {
  const response = http.get(target);
  check(response, { 'status is 2xx/3xx': (result) => result.status >= 200 && result.status < 400 });
}
