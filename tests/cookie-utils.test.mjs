import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvent, extractCookie, getSessionCookie} from '../src/utils/cookie-utils.mjs';

test('createEvent 会将对象序列化为 SSE 数据段', () => {
    const payload = {ok: true, value: 1};
    const event = createEvent('data', payload);
    assert.equal(event, 'event: data\ndata: {"ok":true,"value":1}\n\n');
});

test('extractCookie 能提取关键 cookie 字段与邮箱', () => {
    const ld = encodeURIComponent(JSON.stringify({email: 'test@example.com'}));
    const raw = [
        'DS=ds-token',
        'DSR=dsr-token',
        'gst=gst-token',
        'gid=gid-token',
        'you_subscription=pro',
        'youpro_subscription=true',
        `ld_context=${ld}`,
    ].join('; ');

    const parsed = extractCookie(raw);
    assert.equal(parsed.ds, 'ds-token');
    assert.equal(parsed.dsr, 'dsr-token');
    assert.equal(parsed.gst, 'gst-token');
    assert.equal(parsed.gid, 'gid-token');
    assert.equal(parsed.email, 'test@example.com');
});

test('getSessionCookie 会合并 rawCookieString 并覆盖关键字段', () => {
    const cookies = getSessionCookie(
        null,
        null,
        'new-ds',
        'new-dsr',
        'youpro_standard_year',
        'true',
        'gst-value',
        'gid-value',
        'DS=old-ds; foo=bar'
    );

    const map = new Map(cookies.map((item) => [item.name, item.value]));
    assert.equal(map.get('DS'), 'new-ds');
    assert.equal(map.get('DSR'), 'new-dsr');
    assert.equal(map.get('foo'), 'bar');
    assert.equal(map.get('youpro_subscription'), 'true');
});
