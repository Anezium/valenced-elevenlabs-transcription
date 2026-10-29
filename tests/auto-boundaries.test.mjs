import test from 'node:test';
import assert from 'node:assert/strict';
import { clientHost, tick } from './client-host.mjs';

// Invoke the real synchronous dispatcher subscriber, before its deferred store read.
function dispatchNow(h, type, record) {
 if (record) h.records.set(`${record.channel_id}/${record.id}`, record);
 for (const fn of h.callbacks.get(type) ?? []) fn({type, ...(record ? {message: record} : {})});
}

test('deferred pre-boundary voice events cannot cross foreground, channel or reconnect barriers', async () => {
 for (const boundary of ['foreground', 'channel', 'reconnect', 'edit', 'delete']) {
  const h = clientHost(); const rt = await h.ready();
  await rt.auto.configure({incoming: true, ownReplies: true});
  // Even the same millisecond (or allowed clock skew) must not turn an old
  // dispatch into a new event after a synchronous invalidation/resume.
  dispatchNow(h, 'MESSAGE_CREATE', h.voice(1, true));
  if (boundary === 'foreground') { rt.auto.pause(); rt.auto.resume(); }
  if (boundary === 'channel') dispatchNow(h, 'CHANNEL_SELECT');
  if (boundary === 'reconnect') { dispatchNow(h, 'CONNECTION_CLOSED'); dispatchNow(h, 'CONNECTION_RESUMED'); }
  if (boundary === 'edit') dispatchNow(h, 'MESSAGE_UPDATE', {...h.voice(1, true), content: 'edited'});
  if (boundary === 'delete') dispatchNow(h, 'MESSAGE_DELETE');
  await tick(); await rt.auto.idle();
  assert.equal(h.calls.filter(x => x === 'stt').length, 0, boundary);
  assert.equal(h.posts.length, 0, boundary);
  // Positive control: a genuinely subsequent event still works.
  await h.emit(h.voice(2, true)); assert.equal(h.posts.length, 1, boundary);
  h.stop(); await tick(); assert.equal(h.network, 0);
 }
});

test('events observed while disabled cannot gain consent during deferred dispatch', async () => {
 const h = clientHost(); const rt = await h.ready();
 // A synchronous configure schedules the preference write before the deferred
 // event; an already-resolved storage operation is still not consent at ingress.
 const enabling = rt.auto.configure({incoming: true, ownReplies: true});
 dispatchNow(h, 'MESSAGE_CREATE', h.voice(1, true));
 await enabling; await tick(); await rt.auto.idle();
 assert.equal(h.calls.filter(x => x === 'stt').length, 0);
 assert.equal(h.posts.length, 0);
 await h.emit(h.voice(2, true)); assert.equal(h.posts.length, 1);
 h.stop(); await tick();
});

test('channel isolation: no local bleed and own replies always reference their original channel', async () => {
 const h = clientHost(); const rt = await h.ready();
 await rt.auto.configure({incoming: true, ownReplies: true});
 const incoming = h.voice(1); await h.emit(incoming);
 assert.equal(new h.RowManager().generate({message: incoming}).message.content.length, 2);
 h.channel('2'); await h.emit(null, 'CHANNEL_SELECT');
 const inOtherChannel = {...incoming, channel_id: '2'};
 assert.equal(new h.RowManager().generate({message: inOtherChannel}).message.content.length, 1);
 const own = {...h.voice(2, true), channel_id: '2'};
 own.attachments = [{...own.attachments[0], url: 'https://cdn.discordapp.com/attachments/2/3/a.ogg'}];
 await h.emit(own, 'MESSAGE_SEND_SUCCESS'); assert.equal(h.posts.length, 1);
 assert.equal(h.posts[0].url, '/channels/2/messages');
 assert.deepEqual(h.posts[0].body.message_reference, {channel_id: '2', message_id: own.id, fail_if_not_exists: true});
 // A subsequent voice in the no-longer-selected channel is not a catch-up job.
 await h.emit(h.voice(3, true)); assert.equal(h.posts.length, 1);
 assert.equal(h.network, 0); h.stop(); await tick();
});
